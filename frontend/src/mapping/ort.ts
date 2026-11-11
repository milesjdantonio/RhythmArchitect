// ONNX Runtime for the browser's models (the beat tracker, beats.ts; the song splitter, stems.ts;
// the trained mapper, ensomi.ts).
// The WebGPU build: it runs on the graphics chip where the browser has WebGPU, and on the CPU
// (WebAssembly) otherwise. Imported only by the mapping worker, so the page never loads it.

import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

// Its WebAssembly ships with the site (Vite gives it a hashed URL).
ort.env.wasm.wasmPaths = { wasm: wasmUrl };
// One thread: several need cross-origin isolation, which would stop YouTube's player from embedding.
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

export { ort };
export type Ort = typeof ort;

/** WebGPU is there and gives an adapter (the song splitter needs it; the beat tracker doesn't). */
export async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}
