# Rythm Architect: guidance for Claude

The product: a player asks for a real song; the AI maps it into a 4-lane beatmap (Easy, Medium,
Hard); they play it. The AI does not make music. Market and word everything that way.

- Read [README.md](README.md) for the layout, [docs/api.md](docs/api.md) for the backend contract,
  [docs/resources.md](docs/resources.md) for tools and rules.
- Layout is fixed by the user: left = title + AI (**Name a Song**: title + artist fields that
  search every mapped song as you type, with the Generate beatmap button at the bottom of the
  results; no presets, no mapper notes; then the **Favorites** drop-down with its own search). The
  **music bank** is its own screen (`screens/MusicBank.tsx`, `#/bank`, `GET /api/library`): every
  song A to Z with a search and a letter rail, opened by the Bank button under the settings gear; a pick goes on
  stage in the menu, Esc goes back. No map report. Right = gameplay only: a Rive waiting screen until a song is picked;
  then the stage (60-75% of the height) and, at the very bottom, cover + song name + favourite star,
  Preview/Play and difficulty (a YouTube song's video has its own spot there in place of the
  cover; nothing goes over the stage). No scrolling on the right. A three-second opening plays on every page load
  (`src/intro/WorldIntro.ts`: a world of light, full screen; a Rive orbit without WebGL), waits for
  a click, then plays a three-second launch (a charge, `CHARGE_MS`, then the burst while the title
  flies to the wordmark, `FLIGHT_MS`; `src/lib/entrance.ts`): keep that hand-off to transforms and
  opacity, Rive glows that get scaled up free of feathers, and nothing heavy on the main thread
  during it (the audio is only woken in the click; its synths are built after the title lands).
- **Every tile is a note in the song, at the moment it's heard.** No filler, nothing random, holds
  only where a sound rings (`automap.ts`, `charts.ts`). No sound on key presses: the song is the
  sound; synth songs play every chart note themselves.
- Music: the menu plays `src/audio/ambient.ts` (composed in code, its own clock, not the Transport;
  its notes go to single voices scheduled a second ahead, never a `PolySynth`, whose notes wait in
  a JavaScript timer until 30 ms before they play and so come late when the page is busy)
  while no preview plays; it must stay quiet during the Generate dialog (`holdAmbient`). The end
  screen replays the song quietly (`setDuck`); back on the menu with that song, the menu takes the
  replay over and it plays on from where it was (`handOverPreview` / `takePreview` in `engine.ts`).
- Look and feel: Tetris Effect (deep space, light, thin wide type, hairline frames, particles that
  move with the music). Keep text readable over effects: panels have clear borders and backing.
- Every difficulty has 4 lanes, keys D F J K. Difficulty is density, holds, chords and speed. Note
  speed is fixed, not a setting: `NOTE_SPEED` (0.85) in `src/game/engine.ts`, the same fall time on
  every song (`fallTime`).
- No song generation: search pulls up mapped songs. Generate beatmap finds the song's YouTube
  video (it plays in YouTube's embedded player, `src/audio/youtube.ts`, docked visibly, 200px+,
  nothing over it; shown only while it plays, inert so players can't click it); the browser listens to it once through tab capture and `automap.ts` maps it
  (`src/audio/listen.ts`), then the backend's AI charter (Claude, `POST /api/chart`,
  `docs/claude-backend.txt`) picks which measured sounds become tiles; the browser enforces the rules
  on its plan (`src/music/charter.ts`) and falls back to the on-device charts. Keep the request and
  plan types (`src/api/types.ts`), the mock (`mock-server/api.ts`) and docs/claude-backend.txt in
  step. If it can't listen, an osu! fan chart is the fallback
  (`mock-server/sources.ts`, `src/music/osu.ts`). Only tiles and a loudness curve are kept. Never
  download commercial audio. Test with `localhost`, not `127.0.0.1` (label music refuses IPs).
- YouTube songs' clock follows the player (`followTime` in `engine.ts`); keep pause, restart, the
  dev tools and the 2D fallback working for them. e2e tests use a fake player (`tests/e2e/fake-youtube.js`).
- Gameplay should feel very alive, but the notes must stay readable: tiles draw over every effect,
  big moments burst from the sides of the track (`EDGE`), judgements sit under the hit line, and
  milestone/fever callouts go on the right (`components/ComboCallout.tsx`). The game's HUD is one
  see-through run panel at the top left (`components/PlayHud.tsx`, the video heading it, the bottom left kept clear for the lanes); the lanes and
  the hit line stay centred on the screen (the 2D lanes narrow to clear the panel). Effects live in
  `src/stage/Stage3D.ts` (pooled; never allocate per frame). The game screen draws as "one stage"
  (`src/lib/perf.ts`, `gameProfile`): the stage in a worker (`stage/proxy.ts`, `stage.worker.ts`),
  the backdrop drawn inside it (`stage/sky.ts`), soft effects at half resolution (`stage/halfFx.ts`),
  Rive hit/hold bursts baked to sprite sheets (`stage/bursts.ts`), on WebGPU where the browser has it
  (every stage shader has a TSL twin in `stage/gpu.ts`: change both) and WebGL otherwise. The menus
  use the same system: the backdrop is the same sky on the GPU in `background/sky.worker.ts` (paced
  to the page's frames), the stage preview a `StageProxy` worker; menus draw at most `MENU_FPS` (60,
  Rive too: `RiveAnim` caps its runtime), gameplay and the intro at the screen's rate. The shared
  loop (`lib/ticker.ts`) falls back to a timer when the browser holds animation frames back. Measure
  changes at `/demo` against the previous build. Keep the 2D fallback (`src/game/render.ts`) working. A failed run plays out before
  the results (`Stage3D.fail`, `windDown` in `engine.ts`, the "Signal lost" overlay); loading uses
  `components/Loader.tsx`; listening and mapping show `components/ListenScope.tsx` (the song as a field of light) and
  `components/ListenAura.tsx` (the full-screen light behind the dialog; the dialog's text sits on its own panel).
- Styles: `src/styles/` has one sheet per area (workspace, intro, dialogs, video, game, feedback).
  Panels that stay on screen have solid backing, not `backdrop-filter` (it re-blurs every frame).
- The backdrop (`src/background/scene.ts`) reacts to the song on the menu and in play: cymatic
  sand, stars streaming toward you, beat rings, crystals on hits/typing, a colour bloom, a palette
  per section. No synthwave sun/grid, no blueprint drafting. Keep it cheap: the user found an
  earlier version laggy.
- Dev tools live on the game screen (` key): autoplay, the note queue, clock, judgements, tuning,
  effects, map data. Keep them working when gameplay changes.
- Rive files are generated by code in `tools/rive/art/`; change the art script, then `npm run rive`, `npm run rive:bake` (the hit/hold sprite sheets the /demo stage draws)
  and `npm run rive:check`. Every Rive slot needs a fallback.
- **After any gameplay change, re-record the video: `npm run video`** (dev server running), check a
  few frames, and say so in the reply. The user asks for this every time.
- **After any change to the Generate flow, listening, mapping, charting or the loading screens,
  re-record the listening video: `npm run video:listen`** (self-contained: its own server, the test
  stand-in for YouTube, a throwaway store), check a few frames, and say so in the reply. It writes
  docs/media/listening.webm and listening.png. The user asked for this to stay current.
- After changing `src/music/automap.ts` or `charts.ts`, run `npm run map`, then the video. The band
  benchmark (`tests/unit/automap-band.test.ts`) must keep finding the notes (legato ones too).
- The background follows the song (drops, sections, impacts, loudness), not the combo: milestones
  and fever have their callouts and the gold track, no storms.
- Before finishing: `npx tsc -b`, `npm test`, `npm run test:e2e`, `npm run build`.
- Windows dev box: write multi-line scripts with the file tool, not shell heredocs (they break on quotes).
