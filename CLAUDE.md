# Rythm Architect: guidance for Claude

The product: a player asks for a real song; the AI maps it into a 4-lane beatmap (Easy, Medium,
Hard); they play it. The AI does not make music. Market and word everything that way.

## Where things are

- The whole game is in `frontend/`: run every `npm` command from there. Paths below are relative to
  `frontend/` unless they start with `docs/`.
- Read [README.md](README.md) for the layout, [docs/api.md](docs/api.md) for the backend contract,
  [docs/resources.md](docs/resources.md) for tools and rules.
- Code by area: `src/audio/` (playback.ts, youtube.ts, ambient.ts), `src/mapping/` (the Generate
  pipeline: listening, automap, charts, charter, osu), `src/library/` (song cache, search, bank),
  `src/game/` (rules), `src/stage/` (3D stage), `src/background/`, `src/intro/`, `src/screens/`,
  `src/components/` (shared, plus `menu/`, `play/`, `generate/`). The mock backend and the songs it
  starts with are in `mock-server/`.

## Layout (fixed by the user)

- Left = title + AI. **Name a Song**: title + artist fields that search every mapped song as you
  type, with the Generate beatmap button at the bottom of the results; no presets, no mapper notes.
  Then the **Favorites** drop-down with its own search.
- The **music bank** is its own screen (`src/screens/MusicBank.tsx`, `#/bank`, `GET /api/library`):
  every song A to Z with a search and a letter rail, opened by the Bank button (♫ icon) under the
  settings gear. The menu's song keeps playing there; a pick plays right there (the bank stays
  open, its "Now playing" card holds a YouTube song's video). Esc goes back to the menu with the
  song that was playing on stage, its preview carrying on (the screens hand it over:
  `handOverPreview` / `takePreview`). No map report.
- Right = gameplay only: a Rive waiting screen until a song is picked; then the stage (60-75% of the
  height) and, at the very bottom, cover + song name + favourite star, Preview/Play and difficulty
  (a YouTube song's video has its own spot there in place of the cover; nothing goes over the
  stage). No scrolling on the right.
- A three-second opening plays on every page load (`src/intro/WorldIntro.ts`: a world of light,
  full screen; a Rive orbit without WebGL), waits for a click, then plays a three-second launch (a
  charge, `CHARGE_MS`, then the burst while the title flies to the wordmark, `FLIGHT_MS`;
  `src/lib/entrance.ts`): keep that hand-off to transforms and opacity, Rive glows that get scaled
  up free of feathers, and nothing heavy on the main thread during it (the audio is only woken in
  the click; its synths are built after the title lands).

## Maps and gameplay rules

- **Every tile is a note in the song, at the moment it's heard.** No filler, nothing random, holds
  only where a sound rings (`src/mapping/automap.ts`, `src/mapping/charts.ts`). No sound on key
  presses: the song is the sound; synth songs play every chart note themselves.
- Every difficulty has 4 lanes, keys D F J K. Difficulty is density, holds, chords and speed. Note
  speed is fixed, not a setting: `NOTE_SPEED` (0.85) in `src/game/engine.ts`, the same fall time on
  every song (`fallTime`).
- Dev tools live on the game screen (` key): autoplay, the note queue, clock, judgements, tuning,
  effects, map data. Keep them working when gameplay changes.

## Generating a beatmap

- No song generation: search pulls up mapped songs. Generate beatmap finds the song's YouTube
  video (it plays in YouTube's embedded player, `src/audio/youtube.ts`, docked visibly, 200px+,
  nothing over it; shown only while it plays, inert so players can't click it).
- The browser listens to it once through tab capture and `automap.ts` maps it
  (`src/mapping/listen.ts`), then the backend's AI charter (Claude, `POST /api/chart`,
  `docs/claude-backend.txt`) picks which measured sounds become tiles; the browser enforces the
  rules on its plan (`src/mapping/charter.ts`) and falls back to the on-device charts.
- Keep the request and plan types (`src/api/types.ts`), the mock (`mock-server/api.ts`) and
  `docs/claude-backend.txt` in step.
- If it can't listen, an osu! fan chart is the fallback (`mock-server/sources.ts`,
  `src/mapping/osu.ts`). Only tiles and a loudness curve are kept. Never download commercial audio.
- Test with `localhost`, not `127.0.0.1` (label music refuses IPs).
- YouTube songs' clock follows the player (`followTime` in `src/audio/playback.ts`); keep pause,
  restart, the dev tools and the 2D fallback working for them. e2e tests use a fake player
  (`tests/e2e/fake-youtube.js`).
- Listening and mapping show `src/components/generate/ListenScope.tsx` (the song as a field of
  light) and `src/components/generate/ListenAura.tsx` (the full-screen light behind the dialog; the
  dialog's text sits on its own panel). Loading uses `src/components/Loader.tsx`.

## Music

- The menu plays `src/audio/ambient.ts` (composed in code, its own clock, not the Transport; its
  notes go to single voices scheduled a second ahead, never a `PolySynth`, whose notes wait in a
  JavaScript timer until 30 ms before they play and so come late when the page is busy) while no
  preview plays; it must stay quiet during the Generate dialog (`holdAmbient`).
- The end screen replays the song quietly (`setDuck`); back on the menu with that song, the menu
  takes the replay over and it plays on from where it was (`handOverPreview` / `takePreview` in
  `src/audio/playback.ts`).

## Look and feel

- Tetris Effect: deep space, light, thin wide type, hairline frames, particles that move with the
  music. Keep text readable over effects: panels have clear borders and backing.
- Gameplay should feel very alive, but the notes must stay readable: tiles draw over every effect,
  big moments burst from the sides of the track (`EDGE`), judgements sit under the hit line, and
  milestone/fever callouts go on the right (`src/components/play/ComboCallout.tsx`).
- The game's HUD is one see-through run panel at the top left (`src/components/play/PlayHud.tsx`,
  the video heading it, the bottom left kept clear for the lanes); the lanes and the hit line stay
  centred on the screen (the 2D lanes narrow to clear the panel).
- A failed run plays out before the results (`Stage3D.fail`, `windDown` in `src/audio/playback.ts`,
  the "Signal lost" overlay).
- The backdrop (`src/background/scene.ts`) reacts to the song on the menu and in play: cymatic
  sand, stars streaming toward you, beat rings, crystals on hits/typing, a colour bloom, a palette
  per section. No synthwave sun/grid, no blueprint drafting. Keep it cheap: the user found an
  earlier version laggy.
- The background follows the song (drops, sections, impacts, loudness), not the combo: milestones
  and fever have their callouts and the gold track, no storms.
- Styles: `src/styles/` has one sheet per area (workspace, intro, dialogs, video, game, feedback,
  bank, background). Panels that stay on screen have solid backing, not `backdrop-filter` (it
  re-blurs every frame).
- Rive files are generated by code in `tools/rive/art/`; change the art script, then `npm run rive`,
  `npm run rive:bake` (the hit/hold sprite sheets the game's stage draws) and `npm run rive:check`.
  Every Rive slot needs a fallback.

## Performance

- Effects live in `src/stage/Stage3D.ts` (pooled; never allocate per frame); its GLSL shaders are in
  `src/stage/shaders.ts`, textures in `textures.ts`, particle forms in `forms.ts`.
- The game screen draws as "one stage" (`src/lib/perf.ts`, `gameProfile`): the stage in a worker
  (`stage/proxy.ts`, `stage.worker.ts`), the backdrop drawn inside it (`stage/sky.ts`), soft effects
  at half resolution (`stage/halfFx.ts`), Rive hit/hold bursts baked to sprite sheets
  (`stage/bursts.ts`), on WebGPU where the browser has it (every shader in `stage/shaders.ts` has a
  TSL twin in `stage/gpu.ts`: change both) and WebGL otherwise.
- The menus use the same system: the backdrop is the same sky on the GPU in
  `background/sky.worker.ts` (paced to the page's frames), the stage preview a `StageProxy` worker;
  menus draw at most `MENU_FPS` (60, Rive too: `RiveAnim` caps its runtime), gameplay and the intro
  at the screen's rate. The shared loop (`lib/ticker.ts`) falls back to a timer when the browser
  holds animation frames back.
- Keep the 2D fallback (`src/game/render.ts`) working.

## After a change

- After changing `src/mapping/automap.ts` or `charts.ts`, run `npm run map`. The band benchmark (`tests/unit/automap-band.test.ts`) must keep finding the notes (legato ones too).
- Before finishing (in `frontend/`): `npx tsc -b`, `npm test`, `npm run test:e2e`, `npm run build`.
- Windows dev box: write multi-line scripts with the file tool, not shell heredocs (they break on
  quotes).
