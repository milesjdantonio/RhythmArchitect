// Builds every Rythm Architect .riv file from the art scripts in tools/rive/art/ into public/rive/.
// Ported from TerraSim (tools/rive/build.mjs).
//
//   node tools/rive/build.mjs [name,name]

import { writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'public', 'rive');
mkdirSync(out, { recursive: true });
const only = process.argv[2] ? process.argv[2].split(',') : null;

for (const file of readdirSync(join(here, 'art')).filter((f) => f.endsWith('.mjs'))) {
  const name = file.replace(/\.mjs$/, '');
  if (only && !only.includes(name)) continue;
  if (!only && name.startsWith('zz-')) continue; // scratch files only build when named
  const mod = await import(pathToFileURL(join(here, 'art', file)).href);
  const bytes = mod.default().toBytes();
  writeFileSync(join(out, `${name}.riv`), bytes);
  console.log(`${name}.riv  ${(bytes.length / 1024).toFixed(1)} KB`);
}
