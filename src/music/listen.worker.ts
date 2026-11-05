// Maps what the listening pass heard (src/audio/listen.ts) off the page's main thread: the beat,
// every note, three charts, and the loudness curve the visuals use. The audio itself ends here.

import { automap } from './automap';
import { computeLevels } from './levels';

self.onmessage = (e: MessageEvent<{ pcm: Float32Array; sr: number }>) => {
  try {
    const { pcm, sr } = e.data;
    const result = automap(pcm, sr);
    const levels = computeLevels(pcm, sr);
    (self as unknown as Worker).postMessage({ result, levels });
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: err instanceof Error ? err.message : 'The mapper failed.' });
  }
};
