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
  const tracked = await trackBeats(o.ort, pcm, sr, { providers: gpu ? ['webgpu', 'wasm'] : ['wasm'] });
  const grid = gridFromBeats(tracked);
  const result = automap(pcm, sr, { grid });
  const sameBeat = (a: number, b: number) => [1, 2, 0.5].some((k) => Math.abs(a / b / k - 1) < 0.04);
  let on: Grid = { bpm: result.bpm, offset: result.offset };
  let model: number | null = null;
  // The model's own long notes (its first chart): how many, and how long their sounds ring.
  let raw = { notes: 0, long: 0 };
  const out = await trainedCharts(o.ort, pcm, sr, {
    onRaw: (star, objects) => { if (star === 2) raw = { notes: objects.length, long: objects.filter((x) => x.end_ms != null && x.end_ms - x.start_ms >= 120).length }; },
    base: ENSOMI_BASE, title, bpm: result.bpm, offset: result.offset, events: result.events, onGrid: result.onBeatGrid, meter: result.meter, beats: tracked.beats, gpu,
    regrid: (g) => {
      model = g.bpm;
      if (result.gridUsed && (sameBeat(result.bpm, g.bpm) || result.onBeatGrid)) return null;
      const again = automap(pcm, sr, { grid: { ...g, confidence: 1, fit: 1 } });
      on = { bpm: again.bpm, offset: again.offset };
      return { bpm: again.bpm, offset: again.offset, events: again.events, onGrid: again.onBeatGrid, meter: again.meter };
    },
  });
  return { charts: out.charts, grid: on, tracker: grid?.bpm ?? null, fit: grid?.fit ?? null, beat: result.report.beat ?? '', onset: result.bpm, model: model as number | null, gridUsed: result.gridUsed, gpu, rawLong: raw.notes ? raw.long / raw.notes : 0 };
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

/**
 * Any audio file (tools/map-human.mjs serves the Creative Commons songs it compares with their
 * human charts): each difficulty's tiles as seconds into the audio, with holds and chords.
 */
export async function benchAudio(url: string, title: string) {
  const buf = await (await fetch(url)).arrayBuffer();
  const decoded = await new OfflineAudioContext(1, 1, SR).decodeAudioData(buf);
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * SR), SR);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0).slice();
  const m = await mapAudio(pcm, SR, title);
  const spb = 60 / m.grid.bpm;
  const charts = Object.fromEntries(DIFFICULTIES.map((d) => [d, m.charts[d].notes.map((n) => ({
    sec: Math.round((m.grid.offset + n.t * spb) * 1000) / 1000, lane: n.lane, hold: !!n.hold, len: n.hold ? Math.round(n.len * spb * 1000) / 1000 : 0, pitch: n.pitch, t: n.t,
  }))]));
  return { title, seconds: pcm.length / SR, read: m.grid.bpm, tracker: m.tracker, fit: m.fit, beat: m.beat, model: m.model, rawLong: m.rawLong, charts };
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
