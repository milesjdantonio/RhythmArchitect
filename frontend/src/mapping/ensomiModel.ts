// The trained beatmap model's files (Ensomi R2, sed-i/ensomi-r2 on Hugging Face, MIT; about
// 120 MB, pinned to one commit). They are downloaded once into the browser's cache and kept there:
// the page starts the download while a song is listened to (prefetchEnsomi), and the mapping
// worker reads them from the cache (ensomi.ts). Light on purpose: the page imports this, never
// ONNX Runtime or the model's runtime.

/** The model commit the app was tested with: its files never change. */
export const ENSOMI_REVISION = '2bb35c61b1a4d725e9c4c1b40c0bc85f6be2651e';
export const ENSOMI_BASE = `https://huggingface.co/sed-i/ensomi-r2/resolve/${ENSOMI_REVISION}/onnx/`;
const MANIFEST = 'ensomi-package.json';
const CACHE = 'rythm-architect-models-v1';

/** localStorage switch that turns the trained mapper off (tests set it; a player could too). */
export const NO_ENSOMI_KEY = 'rythm-architect:no-ensomi';
/** Dev: a base URL to read the model's files from instead (a local copy). */
const BASE_KEY = 'rythm-architect:ensomi-base';

function stored(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null; // storage blocked: carry on
  }
}

/**
 * Where to read the trained mapper's files from, or null when it's switched off or can't run
 * here (it checks every file's SHA-256, which browsers allow only on https and localhost).
 */
export function ensomiBase(): string | null {
  if (stored(NO_ENSOMI_KEY)) return null;
  if (typeof crypto === 'undefined' || !crypto.subtle || typeof WebAssembly === 'undefined') return null;
  return stored(BASE_KEY) || ENSOMI_BASE;
}

/** An error the model's runtime reads as "no such file" (it then tries the package without a manifest). */
function missing(path: string): Error {
  return Object.assign(new Error(`trained mapper: no ${path}`), { code: 'ENOENT' });
}

/** Reads a file of the model, from the cache when it's there (else downloaded, and kept). */
export function cachedSource(base: string): (path: string) => Promise<Uint8Array> {
  return async (path) => {
    const url = new URL(path, base).href;
    const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null;
    const hit = await cache?.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
    const res = await fetch(url);
    if (res.status === 404) throw missing(path);
    if (!res.ok) throw new Error(`trained mapper: ${path} ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await cache?.put(url, new Response(bytes.slice())).catch(() => {});
    return bytes;
  };
}

/**
 * Downloads the model's files into the cache, those not there yet (resolves when they all are),
 * with how much of it is there, 0..1.
 */
export async function prefetchEnsomi(base: string, onProgress?: (p: number) => void): Promise<void> {
  if (typeof caches === 'undefined') return;
  const read = cachedSource(base);
  const manifest = JSON.parse(new TextDecoder().decode(await read(MANIFEST))) as { files: { path: string; size: number }[] };
  const total = manifest.files.reduce((a, f) => a + f.size, 0) || 1;
  let got = 0;
  // A few at a time, the biggest file (the beat model) among the first.
  const queue = [...manifest.files];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      await read(f.path);
      got += f.size;
      onProgress?.(got / total);
    }
  }));
}
