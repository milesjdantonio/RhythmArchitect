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
//      after the onset mapper's result has gone to the page (it shows the sounds meanwhile).
// Each step that fails is left out, and the mapper does what it did without it.

import { automap, type PartName } from './automap';
import { computeLevels } from './levels';
import type { ChartProgress } from '../api/types';
import type { Trained, TrainedStage } from './ensomi';

export type ToMapper = {
  pcm: Float32Array;
  sr: number;
  split: boolean;
  /** Chart with the trained mapper, its files read from `base`. */
  trained?: { base: string; title?: string; artist?: string };
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

self.onmessage = async (e: MessageEvent<ToMapper>) => {
  let mapped = false;
  try {
    const { pcm, sr, split, trained } = e.data;
    let grid: ReturnType<typeof import('./beats').gridFromBeats> | undefined;
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
      grid = gridFromBeats(await trackBeats(o.ort, pcm, sr, { providers: gpu ? ['webgpu', 'wasm'] : ['wasm'] }));
    } catch (err) {
      gridError = err instanceof Error ? err.message : String(err);
      console.warn('[mapper] carrying on without the beat tracker', err);
    }
    if (split && gpu && ort && !trained) {
      try {
        const { splitStems } = await import('./stems');
        stems = await splitStems(ort, pcm, sr, (stage, p) => post({ progress: stage === 'download' ? 'getting the song splitter' : 'splitting the song', p }));
      } catch (err) {
        console.warn('[mapper] carrying on without the split', err);
      }
    }
    post({ progress: 'finding every note' });
    const result = automap(pcm, sr, { grid, gridError, stems });
    const levels = computeLevels(pcm, sr);
    const charting = !!trained && !!ort;
    post({ result, levels, trained: charting });
    mapped = true;
    if (!charting) return;
    try {
      const { trainedCharts } = await import('./ensomi');
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
      const out = await trainedCharts(ort!, pcm, sr, {
        base: trained!.base, title: trained!.title, artist: trained!.artist,
        bpm: result.bpm, offset: result.offset, events: result.events,
        onGrid: result.onBeatGrid, gpu,
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
          return { bpm: again.bpm, offset: again.offset, events: again.events, onGrid: again.onBeatGrid };
        },
      });
      post({ trained: regridded ? { ...out, result: regridded } : unused ? { ...out, mapper: `${out.mapper}; ${unused}` } : out });
    } catch (err) {
      console.warn('[mapper] the trained mapper failed', err);
      post({ trainedFailed: err instanceof Error ? err.message : String(err) });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The mapper failed.';
    post(mapped ? { trainedFailed: message } : { error: message });
  }
};
