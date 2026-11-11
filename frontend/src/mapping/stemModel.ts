// The song splitter's model (Demucs v4, "htdemucs", MIT; the ONNX export by timcsy for the browser,
// about 172 MB). It is downloaded once into the browser's cache and kept there: the page starts
// the download while a song is listened to (prefetchStemModel), and the mapping worker reads it
// from the cache (stems.ts). Light on purpose: the page imports this, never ONNX Runtime.

export const STEM_MODEL_URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
const CACHE = 'rythm-architect-models-v1';

/** localStorage switch that turns splitting off (tests set it; a player could too). */
export const NO_STEMS_KEY = 'rythm-architect:no-stems';

/** Whether this browser should split songs: WebGPU with an adapter, and not switched off. */
export async function canSplit(): Promise<boolean> {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(NO_STEMS_KEY)) return false;
  } catch { /* storage blocked: carry on */ }
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

/** Starts the download into the cache if it isn't there yet (resolves when it's there). */
export async function prefetchStemModel(): Promise<void> {
  if (typeof caches === 'undefined') return;
  const cache = await caches.open(CACHE);
  if (await cache.match(STEM_MODEL_URL)) return;
  await cache.add(STEM_MODEL_URL);
}

/** The model's bytes: from the cache, else downloaded (and cached), with progress 0..1. */
export async function stemModelBytes(onProgress?: (p: number) => void): Promise<ArrayBuffer> {
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE) : null;
  const hit = await cache?.match(STEM_MODEL_URL);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(STEM_MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`stem model: ${res.status}`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress?.(got / total);
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.length; }
  await cache?.put(STEM_MODEL_URL, new Response(bytes.slice().buffer)).catch(() => {});
  return bytes.buffer;
}
