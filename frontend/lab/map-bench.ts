// The whole mapper's benchmark (tools/map-bench.mjs runs it in a headless browser): maps audio the
// way the mapping worker does (beat tracker, onset mapper, trained mapper with its regrid rule)
// and scores what comes out.
//
// On the synthetic band (tests/bench/band.ts), every note's true time is known, so it measures:
// whether the tempo came out right (or half, or double), how many of each difficulty's tiles land
// on a real note, how many of the strong notes (kick, snare, bass, the melody's attacks) each
// difficulty catches, and the step from each difficulty to the next. On a bundled track (no truth)
// it reports the tempo and the ladder.

import type { Chart, Difficulty } from '../src/api/types';
import { DIFFICULTIES } from '../src/api/types';
import { automap } from '../src/mapping/automap';
import { trainedCharts } from '../src/mapping/ensomi';
import { ENSOMI_BASE } from '../src/mapping/ensomiModel';
import { SR, band, score } from '../tests/bench/band';

type Grid = { bpm: number; offset: number };

/** The pipeline on mono audio, as listen.worker.ts runs it. */
async function mapAudio(pcm: Float32Array, sr: number, title: string) {
  const o = await import('../src/mapping/ort');
  const gpu = await o.hasWebGpu();
  const { trackBeats, gridFromBeats } = await import('../src/mapping/beats');
  const grid = gridFromBeats(await trackBeats(o.ort, pcm, sr, { providers: gpu ? ['webgpu', 'wasm'] : ['wasm'] }));
  const result = automap(pcm, sr, { grid });
  const sameBeat = (a: number, b: number) => [1, 2, 0.5].some((k) => Math.abs(a / b / k - 1) < 0.04);
  let on: Grid = { bpm: result.bpm, offset: result.offset };
  let model: number | null = null;
  const out = await trainedCharts(o.ort, pcm, sr, {
    base: ENSOMI_BASE, title, bpm: result.bpm, offset: result.offset, events: result.events, onGrid: result.onBeatGrid, gpu,
    regrid: (g) => {
      model = g.bpm;
      if (result.gridUsed && (sameBeat(result.bpm, g.bpm) || result.onBeatGrid)) return null;
      const again = automap(pcm, sr, { grid: { ...g, confidence: 1, fit: 1 } });
      on = { bpm: again.bpm, offset: again.offset };
      return { bpm: again.bpm, offset: again.offset, events: again.events, onGrid: again.onBeatGrid };
    },
  });
  return { charts: out.charts, grid: on, tracker: grid?.bpm ?? null, onset: result.bpm, model: model as number | null, gridUsed: result.gridUsed, gpu };
}

const tilesAt = (c: Chart, g: Grid) => [...new Set(c.notes.map((n) => Math.round((g.offset + (n.t * 60) / g.bpm) * 1000) / 1000))].sort((a, b) => a - b);

function ladder(charts: Record<Difficulty, Chart>, seconds: number) {
  const n = DIFFICULTIES.map((d) => charts[d].notes.length);
  return {
    perSecond: n.map((k) => Math.round((k / seconds) * 100) / 100),
    steps: n.slice(1).map((k, i) => Math.round((k / Math.max(1, n[i])) * 100) / 100),
  };
}

/** How the tempo read compares to the true one. */
function tempoCall(read: number, truth: number) {
  const k = read / truth;
  return Math.abs(k - 1) < 0.02 ? 'right' : Math.abs(k - 0.5) < 0.01 ? 'half' : Math.abs(k - 2) < 0.04 ? 'double' : Math.abs(k - 2 / 3) < 0.02 ? '2/3' : Math.abs(k - 1.5) < 0.03 ? '3/2' : `x${k.toFixed(2)}`;
}

/** The band at `bpm` (`rough`: a room, noise and human timing), mapped and scored. */
export async function benchBand(bpm: number, rough: boolean, bars = 24) {
  const { x, truth, times: all } = band(bpm, bars, 11 + Math.round(bpm), rough);
  const m = await mapAudio(x, SR, `Band ${bpm}${rough ? ' rough' : ''}`);
  // Notes heard together (within 35 ms) are one moment, as the band's own onset list has them.
  const strong: number[] = [];
  for (const t of truth.filter((u) => u.kind === 'kick' || u.kind === 'snare' || u.kind === 'bass' || u.kind === 'melody').map((u) => u.at).sort((a, b) => a - b)) {
    if (!strong.length || t - strong[strong.length - 1] > 0.035) strong.push(t);
  }
  const seconds = x.length / SR;
  const per = Object.fromEntries(DIFFICULTIES.map((d) => {
    const at = tilesAt(m.charts[d], m.grid);
    return [d, {
      tiles: m.charts[d].notes.length,
      // On a real note: a moment's tiles within 50 ms of a true onset.
      onNote: Math.round(score(at, all).p * 100),
      // The strong notes it catches.
      strong: Math.round(score(at, strong).r * 100),
      holds: Math.round((m.charts[d].notes.filter((n) => n.hold).length / Math.max(1, m.charts[d].notes.length)) * 100),
    }];
  }));
  return { bpm, rough, read: m.grid.bpm, call: tempoCall(m.grid.bpm, bpm), tracker: m.tracker, onset: m.onset, model: m.model, gridUsed: m.gridUsed, gpu: m.gpu, per, ...ladder(m.charts, seconds) };
}

/** A bundled track (public/audio/<id>.mp3): no truth, its tempo and ladder. */
export async function benchTrack(id: string) {
  const buf = await (await fetch(`/audio/${id}.mp3`)).arrayBuffer();
  const decoded = await new OfflineAudioContext(1, 1, SR).decodeAudioData(buf);
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * SR), SR);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0).slice();
  const m = await mapAudio(pcm, SR, id);
  return { id, read: m.grid.bpm, tracker: m.tracker, onset: m.onset, model: m.model, gridUsed: m.gridUsed, ...ladder(m.charts, pcm.length / SR) };
}
