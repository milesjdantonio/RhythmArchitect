// Splits what the listening pass heard into its parts (drums, bass, vocals, other) with Demucs v4
// on the graphics chip (WebGPU), so the mapper (automap.ts) can find the sounds of each part on its
// own: the vocal line from the voice alone, the kick and snare from the drums. Runs in the mapping
// worker; the audio never leaves the browser.
//
// Demucs takes 44.1 kHz stereo in 7.8-second segments (demucs-web does the segmenting and the
// spectrograms). The listening pass hears mono at about 22-24 kHz, so it goes in upsampled on both
// channels (Demucs separates mono fine; there's just nothing above ~11 kHz to separate), and each
// part comes back downmixed and resampled to the pass's own rate and length.

import { DemucsProcessor } from 'demucs-web';
import type { PartName } from './automap';
import { resample } from './beats';
import { stemModelBytes } from './stemModel';

const DEMUCS_SR = 44100;

/** The parts of `pcm` (mono at `sr`), each the same length and rate. */
export async function splitStems(
  ort: unknown,
  pcm: Float32Array,
  sr: number,
  onProgress?: (stage: 'download' | 'split', p: number) => void,
): Promise<Record<PartName, Float32Array>> {
  const model = await stemModelBytes((p) => onProgress?.('download', p));
  const processor = new DemucsProcessor({
    ort,
    sessionOptions: { executionProviders: ['webgpu'] },
    onProgress: ({ progress }: { progress: number }) => onProgress?.('split', progress),
  });
  await processor.loadModel(model);
  const x = resample(pcm, sr, DEMUCS_SR);
  const out = await processor.separate(x, x);
  const back = (s: { left: Float32Array; right: Float32Array }) => {
    const mono = new Float32Array(s.left.length);
    for (let i = 0; i < mono.length; i++) mono[i] = (s.left[i] + s.right[i]) * 0.5;
    const r = resample(mono, DEMUCS_SR, sr);
    // Exactly the pass's length (resampling there and back can be a sample off).
    if (r.length === pcm.length) return r;
    const fit = new Float32Array(pcm.length);
    fit.set(r.subarray(0, Math.min(r.length, pcm.length)));
    return fit;
  };
  return { drums: back(out.drums), bass: back(out.bass), vocals: back(out.vocals), other: back(out.other) };
}
