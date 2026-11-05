// Builds tools/rive/defs.json from a checkout of https://github.com/rive-app/rive-runtime (MIT).
// It reads the generated *_base.hpp headers for each object's type key, parent class and property
// keys, and core_registry.hpp for each property's field type.
//
//   node tools/rive/extract-defs.mjs <path to rive-runtime checkout>

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/rive/extract-defs.mjs <rive-runtime checkout>');
  process.exit(2);
}
const generated = join(root, 'include', 'rive', 'generated');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('_base.hpp')) out.push(p);
  }
  return out;
}

const classes = {};
for (const file of walk(generated)) {
  const src = readFileSync(file, 'utf8');
  const decl = src.match(/class\s+(\w+)Base\s*:\s*public\s+(\w+)/);
  if (!decl) continue;
  const name = decl[1];
  const parent = decl[2].replace(/Base$/, '');
  const typeKey = src.match(/static const uint16_t typeKey = (\d+);/);
  const properties = {};
  for (const m of src.matchAll(/static const uint16_t (\w+)PropertyKey = (\d+);/g)) {
    properties[m[1]] = { key: Number(m[2]) };
  }
  classes[name] = { typeKey: typeKey ? Number(typeKey[1]) : null, parent, properties };
}

// Field types: the propertyFieldId switch lists "case XBase::yPropertyKey:" lines before each
// "return CoreZType::id;".
const registry = readFileSync(join(generated, 'core_registry.hpp'), 'utf8');
const start = registry.indexOf('static int propertyFieldId(int propertyKey)');
const body = registry.slice(start, registry.indexOf('\n  }\n', start));
let pending = [];
for (const line of body.split('\n')) {
  const c = line.match(/case (\w+)Base::(\w+)PropertyKey:/);
  if (c) { pending.push([c[1], c[2]]); continue; }
  const r = line.match(/return Core(\w+)Type::id;/);
  if (r) {
    const type = r[1].toLowerCase(); // uint, string, color, bool, double, bytes
    for (const [cls, prop] of pending) {
      if (classes[cls]?.properties[prop]) classes[cls].properties[prop].type = type;
    }
    pending = [];
  }
}

const out = join(dirname(fileURLToPath(import.meta.url)), 'defs.json');
const header = registry.match(/majorVersion = (\d+)/);
writeFileSync(out, JSON.stringify({
  source: 'rive-app/rive-runtime include/rive/generated (MIT)',
  majorVersion: header ? Number(header[1]) : 7,
  classes,
}, null, 1));
console.log(`wrote ${Object.keys(classes).length} classes to ${out}`);
