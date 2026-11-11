// Maps what the listening pass heard (src/mapping/listen.ts) off the page's main thread: the beat,
// every note, three charts, and the loudness curve the visuals use. The audio itself ends here.
//
//   1. The beat grid from the trained beat tracker (beats.ts, Beat This!): used by the mapper when
//      it's confident; on the graphics chip where there is one.
//   2. With WebGPU (and when the page asks): the song split into drums, bass, vocals and other
//      (stems.ts, Demucs), so each part's sounds are found on their own.
//   3. The onset mapper (automap.ts) with both.
// Each step that fails is left out, and the mapper does what it did without it.

import { automap, type PartName } from './automap';
import { computeLevels } from './levels';

export type ToMapper = { pcm: Float32Array; sr: number; split: boolean };
export type FromMapper =
  | { progress: string; p?: number }
  | { result: ReturnType<typeof automap>; levels: ReturnType<typeof computeLevels> }
  | { error: string };

const post = (m: FromMapper) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<ToMapper>) => {
  try {
    const { pcm, sr, split } = e.data;
    let grid = null;
    let stems: Record<PartName, Float32Array> | null = null;
    let gpu = false;
    try {
      const { ort, hasWebGpu } = await import('./ort');
      gpu = await hasWebGpu();
      post({ progress: 'finding the beat' });
      const { trackBeats, gridFromBeats } = await import('./beats');
      grid = gridFromBeats(await trackBeats(ort, pcm, sr, { providers: gpu ? ['webgpu', 'wasm'] : ['wasm'] }));
      if (split && gpu) {
        const { splitStems } = await import('./stems');
        stems = await splitStems(ort, pcm, sr, (stage, p) => post({ progress: stage === 'download' ? 'getting the song splitter' : 'splitting the song', p }));
      }
    } catch (err) {
      console.warn('[mapper] carrying on without', grid ? 'the split' : 'the beat tracker', err);
    }
    post({ progress: 'finding every note' });
    const result = automap(pcm, sr, { grid, stems });
    const levels = computeLevels(pcm, sr);
    post({ result, levels });
  } catch (err) {
    post({ error: err instanceof Error ? err.message : 'The mapper failed.' });
  }
};
