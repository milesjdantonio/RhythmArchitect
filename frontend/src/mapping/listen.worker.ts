// Maps what the listening pass heard (src/mapping/listen.ts) off the page's main thread: the beat,
// every note, three charts, and the loudness curve the visuals use. The audio itself ends here.
//
//   1. The beat grid from the trained beat tracker (beats.ts, Beat This!): used by the mapper when
//      it's confident; on the graphics chip where there is one.
//   2. With WebGPU (and when the page asks): the song split into drums, bass, vocals and other
//      (stems.ts, Demucs), so each part's sounds are found on their own. Not with the trained
//      mapper, which listens to the whole mix itself.
//   3. The onset mapper (automap.ts) with both: the grid, every sound, sections, the on-device charts.
//   4. When the page asks: the trained mapper (ensomi.ts, Ensomi R2) charts the song from the audio,
//      after the onset mapper's result has gone to the page (it shows the sounds meanwhile). With
//      WebGPU the vocal is split off first (stems.ts) and its syllables heard (notes.ts, voice.ts):
//      the charts go with the lyrics.
// Each step that fails is left out, and the mapper does what it did without it.

import { automap, type PartName } from './automap';
import { computeLevels } from './levels';
import type { ChartProgress } from '../api/types';
import type { Trained, TrainedStage } from './ensomi';
import type { Syllable } from './voice';

export type ToMapper = {
  pcm: Float32Array;
  sr: number;
  split: boolean;
  /** The recording's two channels, for the song splitter. */
  stereo?: [Float32Array, Float32Array];
  /** Chart with the trained mapper, its files read from `base`. */
  trained?: { base: string; title?: string; artist?: string; study?: boolean };
};
export type FromMapper =
  | { progress: string; p?: number }
  /** The onset mapper's result; with `trained`, the trained mapper's charts follow. */
  | { result: ReturnType<typeof automap>; levels: ReturnType<typeof computeLevels>; trained: boolean }
  | { chart: ChartProgress }
  | { stage: TrainedStage; p?: number }
  | { trained: Trained }
  | { trainedFailed: string }
  | { error: string };

const post = (m: FromMapper) => (self as unknown as Worker).postMessage(m);

/**
 * Each sound found in the whole mix labelled with the part it came from: the part whose level
 * jumps most at it (the 40 ms after its attack against the 40 ms before).
 */
function labelParts(events: { sec: number; part?: PartName }[], stems: Record<PartName, Float32Array>, sr: number) {
  const W = Math.round(0.04 * sr);
  const level = (x: Float32Array, a: number, b: number) => { let s = 0; const from = Math.max(0, a), to = Math.min(x.length, b); for (let i = from; i < to; i++) s += x[i] * x[i]; return to > from ? Math.sqrt(s / (to - from)) : 0; };
  for (const e of events) {
    const i = Math.round(e.sec * sr);
    let best: PartName | undefined, jump = 0;
    for (const p of ['drums', 'bass', 'vocals', 'other'] as PartName[]) {
      const x = stems[p];
      if (!x) continue;
      const j = level(x, i, i + W) - level(x, i - W, i);
      if (j > jump) { jump = j; best = p; }
    }
    if (best) e.part = best;
  }
}

self.onmessage = async (e: MessageEvent<ToMapper>) => {
  let mapped = false;
  try {
    const { pcm, sr, split, trained, stereo } = e.data;
    let grid: ReturnType<typeof import('./beats').gridFromBeats> | undefined;
    // The tracker's own beats: the trained mapper places its tiles on them (beatmap.ts).
    let beats: number[] | undefined;
    let gridError: string | undefined;
    let stems: Record<PartName, Float32Array> | null = null;
    let gpu = false;
    let ort: typeof import('./ort')['ort'] | null = null;
    try {
      const o = await import('./ort');
      ort = o.ort;
      gpu = await o.hasWebGpu();
      post({ progress: 'finding the beat' });
      const { trackBeats, gridFromBeats } = await import('./beats');
      const tracked = await trackBeats(o.ort, pcm, sr, { providers: gpu ? ['webgpu', 'wasm'] : ['wasm'] });
      beats = tracked.beats;
      grid = gridFromBeats(tracked);
    } catch (err) {
      gridError = err instanceof Error ? err.message : String(err);
      console.warn('[mapper] carrying on without the beat tracker', err);
    }
    // The song split into its parts (drums, bass, vocals, other). Without the trained mapper the
    // onset mapper finds each part's sounds on its own; with it, the sounds are still found in the
    // whole mix (the beat map and the repeats are built from those: found per part they charted
    // 2 phrases alike where the mix gave 11), and each is then labelled with the part it came from
    // (partOf), so every phrase of a chart can follow one part; the vocals give the syllables.
    // (The page says whether: WebGPU there, and splitting not switched off: stemModel.ts canSplit.)
    if (split && gpu && ort) {
      try {
        const { splitStems } = await import('./stems');
        stems = await splitStems(ort, pcm, sr, (stage, p) => post({ progress: stage === 'download' ? 'getting the song splitter' : 'splitting the song into its parts', p }), stereo);
      } catch (err) {
        console.warn('[mapper] carrying on without the split', err);
      }
    }
    post({ progress: 'finding every note' });
    const result = automap(pcm, sr, { grid, gridError, stems: trained ? null : stems });
    if (trained && stems) labelParts(result.events, stems, sr);
    const levels = computeLevels(pcm, sr);
    const charting = !!trained && !!ort;
    post({ result, levels, trained: charting });
    mapped = true;
    if (!charting) return;
    try {
      const { trainedCharts, linesCharts, canLead } = await import('./ensomi');
      // The trained mapper's own, larger beat tracker (right or exactly half or double on 27 of 28
      // test songs) sets the grid when the beat tracker found no steady beat (the grid is the onset
      // mapper's guess, which reads fast songs at 2/3 of their tempo), and when the two trackers
      // disagree by more than double or half while the beat tracker's beats don't hold one straight
      // grid (a steady-ish but wrong beat: 119 BPM, straight grid 0%, on a 200 BPM song). Where they
      // agree, or the beat tracker's grid is straight (99.95 BPM, 97%, on that song: right; the
      // trained mapper said 119), the beat tracker's grid stays.
      const sameBeat = (a: number, b: number) => [1, 2, 0.5].some((k) => Math.abs(a / b / k - 1) < 0.04);
      let regridded: typeof result | undefined;
      // Its tempo when its grid isn't used, for the dev tools: whether the two trackers agree is
      // what a half- or double-tempo fix would have to go on (none is guessed at yet).
      let unused: string | undefined;
      // The singing (voice.ts): the vocal split off and its notes heard, each start a syllable.
      // Needs the graphics chip (Demucs takes about 2 minutes of a 3-minute song on a laptop's);
      // without it, or if it fails, the charts are made as before.
      let voice: Syllable[] | undefined;
      // The instruments' notes too (the "other" part: piano, synths, guitar), heard the same way:
      // an instrument's line note by note (a piano solo), not only where its loudness jumps.
      let played: Syllable[] | undefined;
      let voiceNote = '';
      if (stems) {
        try {
          const t0 = performance.now();
          const { hearNotes } = await import('./notes');
          const sung = await hearNotes(ort!, stems.vocals, sr, { providers: ['webgpu', 'wasm'], onProgress: (p) => post({ stage: 'voice', p }) });
          const { syllables } = await import('./voice');
          voice = syllables(sung, { vocal: stems.vocals, mix: pcm, sr });
          const notesOther = await hearNotes(ort!, stems.other, sr, { providers: ['webgpu', 'wasm'] });
          played = syllables(notesOther, { vocal: stems.other, mix: pcm, sr });
          voiceNote = `; the song split into its parts, the voice heard in ${Math.round((performance.now() - t0) / 1000)} s`;
        } catch (err) {
          console.warn('[mapper] carrying on without the voice', err);
          voiceNote = '; no voice (hearing it failed)';
        }
      } else voiceNote = gpu ? '; no parts (the split failed)' : '; no parts (no WebGPU to split the song)';
      // (Dev: what the steps after the model work from, handed back with the charts: ensomiModel.ts STUDY_KEY.)
      const raws: { star: number; objects: { lane: number; start_ms: number; end_ms?: number }[]; shift: number }[] = [];
      const on = { bpm: result.bpm, offset: result.offset, events: result.events, onGrid: result.onBeatGrid, meter: result.meter, beats, voice, played, barEnergy: result.barEnergy };
      // Split, its parts heard, and the beat tracker's grid steady (the model's grid would never
      // replace it: regrid below): every difficulty is the song's own lines, so the trained mapper
      // (its ~120 MB and its charting) isn't needed. Otherwise it charts, and its grid may be used.
      const lines = !!(result.gridUsed && result.onBeatGrid && beats?.length && canLead(on));
      const out = lines ? await linesCharts(on, (p) => post({ chart: p })) : await trainedCharts(ort!, pcm, sr, {
        ...(trained!.study ? { onRaw: (star: number, objects: { lane: number; start_ms: number; end_ms?: number }[], shift: number) => raws.push({ star, objects: objects.map((x) => ({ lane: x.lane, start_ms: x.start_ms, end_ms: x.end_ms })), shift }) } : {}),
        base: trained!.base, title: trained!.title, artist: trained!.artist,
        bpm: result.bpm, offset: result.offset, events: result.events,
        onGrid: result.onBeatGrid, meter: result.meter, beats, voice, played, gpu, barEnergy: result.barEnergy,
        onStage: (stage, p) => post({ stage, p }),
        onProgress: (p) => post({ chart: p }),
        regrid: (g) => {
          if (result.gridUsed && (sameBeat(result.bpm, g.bpm) || result.onBeatGrid)) {
            const k = g.bpm / result.bpm;
            const rel = Math.abs(k - 1) < 0.04 ? 'the same' : Math.abs(k - 2) < 0.08 ? 'double' : Math.abs(k - 0.5) < 0.02 ? 'half' : `×${k.toFixed(2)}`;
            unused = `its beat tracker said ${g.bpm} BPM, ${rel} (not used: ${sameBeat(result.bpm, g.bpm) ? 'the same beat' : "the beat tracker's grid is straight"})`;
            return null;
          }
          const why = result.gridUsed ? `the beat tracker's ${result.bpm} BPM disagreed and drifted off one grid` : 'the beat tracker found no steady beat';
          const again = automap(pcm, sr, { grid: { ...g, confidence: 1, fit: 1 }, stems });
          again.report.beat = `the trained mapper's beat tracker: ${g.bpm} BPM, ${g.meter}/4 (used: ${why}) · ${result.report.beat ?? 'no beat tracker'}`;
          regridded = again;
          return { bpm: again.bpm, offset: again.offset, events: again.events, onGrid: again.onBeatGrid, meter: again.meter, barEnergy: again.barEnergy };
        },
      });
      let study: unknown;
      if (trained!.study) {
        const { hearNotes } = await import('./notes');
        const r = regridded ?? result;
        study = {
          seconds: pcm.length / sr, tracked: { beats: beats ?? [] }, regridded: !!regridded, raws, mapper: out.mapper,
          on: { bpm: r.bpm, offset: r.offset, meter: r.meter, events: r.events, onGrid: r.onBeatGrid, gridUsed: r.gridUsed, lengthBeats: r.lengthBeats, barEnergy: r.barEnergy, sections: r.report.sections, beat: r.report.beat },
          notes: await hearNotes(ort!, pcm, sr, { providers: gpu ? ['webgpu', 'wasm'] : ['wasm'] }).catch(() => []),
          voice: voice ?? [],
          played: played ?? [],
        };
      }
      const withVoice = { ...out, mapper: out.mapper + voiceNote };
      const done = regridded ? { ...withVoice, result: regridded } : unused ? { ...withVoice, mapper: `${withVoice.mapper}; ${unused}` } : withVoice;
      post({ trained: study ? { ...done, study } : done });
    } catch (err) {
      console.warn('[mapper] the trained mapper failed', err);
      post({ trainedFailed: err instanceof Error ? err.message : String(err) });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The mapper failed.';
    post(mapped ? { trainedFailed: message } : { error: message });
  }
};
