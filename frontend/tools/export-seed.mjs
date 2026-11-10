// Writes the mock backend's built-in songs (mock-server/songs/builtins.ts) as the Spring Boot
// backend's seed: ../backend/src/main/resources/seed/songs.json. Run from frontend/ after the
// built-in songs or their charts change (npm run map):
//   node tools/export-seed.mjs
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.argv[2] ?? '../backend/src/main/resources/seed/songs.json');
const server = await createServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true } });
try {
  const { builtInSongs } = await server.ssrLoadModule('/mock-server/songs/builtins.ts');
  const songs = builtInSongs();
  writeFileSync(out, JSON.stringify({ songs }));
  console.log(`${songs.length} songs -> ${out}`);
} finally {
  await server.close();
}
