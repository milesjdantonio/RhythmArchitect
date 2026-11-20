# Rythm Architect: guidance for Claude

The product: a player asks for a real song; the AI maps it into a 4-lane beatmap (Easy, Medium,
Hard, Ultra); they play it. The AI does not make music. Market and word everything that way.

## Where things are

- The whole game is in `frontend/`: run every `npm` command from there. Paths below are relative to
  `frontend/` unless they start with `docs/`.
- Read [README.md](README.md) for the layout, [docs/api.md](docs/api.md) for the backend contract,
  [docs/resources.md](docs/resources.md) for tools and rules.
- Code by area: `src/audio/` (playback.ts, youtube.ts, ambient.ts), `src/mapping/` (the Generate
  pipeline: listening, beats, automap, charts, ensomi (the trained mapper), beatmap, repeats, thin,
  lanes, osu), `src/library/` (song cache, search, bank),
  `src/game/` (rules), `src/stage/` (3D stage), `src/background/`, `src/intro/`, `src/screens/`,
  `src/components/` (shared, plus `menu/`, `play/`, `generate/`). The mock backend and the songs it
  starts with are in `mock-server/`.
- The real backend is `backend/` at the repo root (Java 25, Spring Boot, Maven; see
  `backend/README.md`): the same routes as the mock. The game's own Java classes (`Song`, `Note`,
  `Queue`, `SongWriter`...) are in `src/java/main/` at the repo root (package `main`, built into the
  backend; no libraries, no view: `ModelDemo` drives them with plain `javac`), their JUnit tests in
  `src/test/main/` (beside `src/java/`, not inside it, so IDEs read both roots; run by `./mvnw test`
  or VS Code's Testing panel), and the built-in songs' charts for them in
  `src/java/charts/` (`node tools/export-charts.mjs` from `frontend/`). This is a CS 2114 project:
  the README's Reflection, Next Steps and Attribution sections follow the course rubric; keep them
  true when things change. `Main` (the controller) and `Score` are Darsh's: don't write them.
  No AI runs on the server. Its built-in songs are `src/main/resources/seed/songs.json` (`node tools/export-seed.mjs` from
  `frontend/` after they change). Run `./mvnw test` there after changing it. Every run (practice
  too, its stretch via `Song.getChartBetween`) also plays through `Main` on the server
  (`PlayController`, `POST /api/play`, `/api/play/:run/inputs`; the game's side:
  `src/game/controllerLink.ts`; the mock's copy of Main's rules: `mock-server/play.ts`). Main is the
  input reviewer: presses and the clock go to it; the game's judged run goes too and the model
  confirms the score (`RunReplay`: the chart's queue, then `GameScore`: the score at the top). The
  run panel shows the confirmed score and the presses reviewed (the course's "view through the
  controller into the model"). The browser still judges each press at once. Songs the trained
  mapper charted before ladder 2 (`thin.ts` `LADDER`, `report.ladder`) are made again from their
  Ultra when first opened (`upgrade.ts` `rethinSong`, `PUT /api/songs/:id/charts`: every tile must
  be one of their Ultra's).
  Haniya isn't credited in the README (she didn't work on it).
- The song bank is a JSON file, or Supabase when `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set
  (`SupabaseSongs`: its REST API with Java's own HTTP client, no driver or pool, so boots stay
  fast; `docs/supabase.md`, `docs/supabase.sql`). The browser never talks to Supabase. The live
  bank holds real songs only: the user had the built-in test tracks (Neon Blueprint, Ink and Fury,
  The Restless Stacks) deleted from it on Nov 19. They stay in the seed and the mock as test
  fixtures; the seed fills only an empty bank, and coming back from a Supabase outage never
  carries built-ins over (`loadRemote`). Keep the
  backend's boot quick (a sleeping free server wakes on the first visit): no startup work beyond
  Spring's own (the bank is read in the background, `SongStore.warm`), and the Docker image keeps
  its AOT cache step (its training start and `CMD` share one fixed heap, `-Xmx384m`: a heap
  sized as a share of the build machine's memory turned compressed pointers off there and the
  cache was refused on Render, ~36 s starts). No screen waits for it: while `/api/health` doesn't answer, the places waiting on the server
  (searches, Favorites, the bank, a song loading) say so with `ServerNote` (`src/lib/server.ts`).
- YouTube videos must be songs (`notSongReason` in `mock-server/match.ts`, `Matching` in the
  backend: the same rules and the same test cases). Setting up the API key: `docs/youtube-api.md`.

## Layout (fixed by the user)

- Left = title + AI. **Name a Song**: title + artist fields that search every mapped song as you
  type; under the results, for a song not mapped yet, its videos **On YouTube** (best few, best
  first: `src/components/menu/VideoResults.tsx`, `GET /api/youtube/search`), each with Preview (it
  plays in its own player under its row) and Generate beatmap for that video, so the player chooses
  what is mapped; no presets, no mapper notes. YouTube is searched only once the typing pauses
  (`src/library/videos.ts`), never for a song already mapped, and each search is kept (quota: about
  1% of a day's per search). Then the **Favorites** drop-down with its own search.
- The **music bank** is its own screen (`src/screens/MusicBank.tsx`, `#/bank`, `GET /api/library`):
  every song A to Z with a search and a letter rail, opened by the Bank button (♫ icon) under the
  settings gear (beside the gear: **How to play**, `src/components/HowToPlay.tsx`, a dialog of
  topics with moving diagrams, also opened from the start card; its numbers come from the rules). The menu's song keeps playing there; a pick plays right there (the bank stays
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
  only where a sound rings (`src/mapping/automap.ts`, `src/mapping/charts.ts`). Sounds go onto the
  grid's 16ths (up to 20 ms) only where the grid holds there (`gridHolds`: the sounds peak on its
  16ths, not to one side); where a song's beat drifts off one straight grid they keep their own
  times (snapping there put tiles up to 35 ms off). "On the beat" checks allow 20 ms for that. No sound on key
  presses: the song is the sound; synth songs play every chart note themselves.
- Every difficulty has 4 lanes, keys D F J K by default (rebindable: `src/lib/keys.ts`; anything
  that shows or reads a key uses the player's binds, never a hard-coded D F J K). Difficulty is density, holds, chords and speed. Four
  steps, each about half again the last: Easy (one at a time), Medium (closer), Hard (chords of two,
  taps under holds), Ultra (the whole chart). For the trained mapper, `thin.ts` `KEEP` counts in
  tiles (Easy ~⅓ of Ultra, Medium ½, Hard 0.7) and brings chords in gradually (Medium a few on the
  biggest hits, Hard ~15% of rows): the user found Medium→Hard a huge jump and Easy→Medium,
  Hard→Ultra hardly any; keep every step about the same. The same ladder everywhere: `thin.ts` `KEEP` (trained
  mapper), `charts.ts` `RULES` (onset mapper), `osu.ts`/`Osu.java` (fan charts), `engine.ts`
  (windows, drain). Easy is what Medium was before Ultra, Ultra what Hard was; songs saved with
  three charts are upgraded on load (`src/api/upgrade.ts`; the backend refreshes its built-ins). Note
  speed is not a setting: each map sets its own, like Beat Saber (the user asked for it, Nov 18):
  `fallTime(difficulty, bpm)` in `src/game/engine.ts`, `TRAVEL` per difficulty (each ~0.85 times
  the last) pulled part of the way by the tempo (`TEMPO_PULL`, clamped). The start card shows it
  (`noteSpeed`).
- Scoring is `main.Score`'s rules (Perfect 100, Good 75, Early/Late 50, accuracy, combo) with the
  game's on top: points ×10 (`POINT_SCALE`), the combo multiplier (×1-×5), the held-note bonus,
  **Overdrive** (a charge from accurate hits: Perfect 3, Good 2, Early/Late 1, a finished hold 3,
  out of 100, ~34 Perfects; it empties when Overdrive ends; Space adds +1 per level for 48 tiles, up to three
  levels: ×8; not at the top; any miss ends it, except in its grace: `OVERDRIVE_GRACE`, 5 song
  seconds after each press, timed by engine.ts) and stray presses (a key with no tile: signal and
  charge drain, no points): `main.GameScore` (Score.java itself is Darsh's: add on top, don't edit
  it). The run records `O` (Overdrive), `U` (its grace ended) and `X` (stray); the server refuses an
  Overdrive the charge couldn't pay for and a grace longer than the chart allows (`graceTiles`,
  RunReplay and score.ts). Gold tiles were tried and removed. The levels' looks are
  `src/game/overdrive.ts`: Neon (purple-pink), Eclipse (white on black: `mono` drains the sky,
  scene.ts/sky.ts, and greys the world) and Prism (rainbow); effect strength is each look's
  `power` (Stage3D recolours on the CPU, no shader change; the 2D fallback takes its hues and
  drains for Eclipse). Its effects: Stage3D (`setOverdrive`, `setOverdriveReady`,
  `setOverdriveLow`: warp streaks, shockwaves, beacons, the flicker), the sky (`overdrive` scene
  event: warp), `components/play/OverdriveFx.tsx` (the screen: an opacity-only flash, the ready cue,
  the tally, and its name when it ends: lost, cracking in red with the sides flashing; spent,
  drifting up; keep DOM shockwaves and big glows out of it, they cost the page frames at the press),
  and `overdriveSweep` in playback.ts (the song's whoosh, never YouTube). Shockwaves from the middle
  of the hit line dim while they cross the lanes (`RING_ON_TRACK`), and the hit line throbs brighter,
  not thicker: the board stays readable under the pulses. Fever is the combo's ×5. Practice mode (a part looped,
  at 50%, 75% or 100%, the speeds YouTube has: `PRACTICE_SPEEDS`, `startSong`'s `rate`; the
  stage worker carries its clock on at that rate) is never saved. The browser counts with the same rules
  (`src/game/score.ts`) and records the run; the server checks it against the difficulty's
  `Queue<Note>` (`RunReplay.fits`; the mock: `runFits`) and replays it through GameScore
  (`RunReplay`) before keeping a best. Change both together; `score.test.ts`, `GameScoreTest` and
  ApiTests share one run that must give the same numbers.
- The server takes every song into the model (`backend/.../songs/SongModel.java`: the bank's JSON
  → `SongWriter.writeSong(..., tiles)` → `main.Song`); new songs and fan charts it can't take in are
  refused (`NewSongCheck`). The bank itself stays JSON.
- Dev tools live on the game screen (` key): autoplay (it spends Overdrive when charged), the note
  queue, clock, judgements, Overdrive, tuning, effects (Overdrive steps through the levels' looks;
  od ready, od fading), map data. Keep them working when gameplay changes.

## Generating a beatmap

- No song generation: search pulls up mapped songs. Generate beatmap maps the YouTube video the
  player chose from the song's videos (it plays in YouTube's embedded player,
  `src/audio/youtube.ts`, docked visibly, 200px+, nothing over it; shown only while it plays, inert
  so players can't click it). A preview holds the menu's sound (`holdQuiet(..., { still: false })`:
  the visuals carry on); the Generate dialog's hold keeps them still too.
- The browser listens to it once through tab capture and `automap.ts` maps it
  (`src/mapping/listen.ts`, in `listen.worker.ts`). Before mapping, the worker runs the Beat This!
  beat tracker (`src/mapping/beats.ts`, model in `public/models/`). Its grid is used whenever its
  beat is steady beat to beat (`confidence` ≥ `GRID_TRUST`), even if it drifts off one straight
  grid (`fit`) (`gridRefusal` in `automap.ts`; a 3:2-clash guard was tried and dropped: right
  once, wrong once). A straight one (`fit` ≥ `GRID_STRAIGHT`) has its tempo fine-tuned against the
  onsets within 1.5% (`TUNE_GAIN`): the tracker came out ~1% off on a third of the human-chart
  songs (106.3 for 105), and a grid 1% off drifts a beat in under two minutes. Never a drifting one. Don't judge it by one straight grid over the whole song: that threw away right
  tempos (a 200 BPM song kept at 121). When it isn't steady, the trained mapper's own grid (its
  .osu timing, `osuGrid` in `ensomi.ts`; larger tracker, often half or double) replaces the onset
  estimate after charting: `regrid` re-runs `automap` on it, and the page saves that result. Then
  `automap.ts` measures every sound, the grid and the sections, and the page shows them.
- The tiles come from the trained mapper: Ensomi R2 (`src/mapping/ensomi.ts`, `@ensomi/runtime`;
  ~120 MB model from Hugging Face pinned to one commit, prefetched while listening, cached;
  `ensomiModel.ts`), run in the same worker after the onset mapper. It charts at its lowest star
  rating (2). A star rating is a difficulty, not a density: on a fast, intense song 2★ eases the
  hardest stretches (a 200 BPM song: 7 tiles a second in its intro, 2-4 after). So Ultra (the whole
  chart) is judged 10 s at a time against about two tiles a beat (`ultraTargets`); while under 85% is met it charts
  again a star busier (to 4★, at most three charts, from the same analysis) and each stretch takes
  the chart nearest its target (`splice`). Every difficulty keeps a subset of that (`src/mapping/thin.ts`, `KEEP`),
  then its lanes are flowed for its own speed (`src/mapping/lanes.ts` `flowChart`: never a tile moved
  in time; thinning left the model's lanes, written for its whole chart, hopping 1.4 lanes a step
  where human charts move 1.1; measured by `src/mapping/patterns.ts` against the human charts),
  and its tiles move onto the onset mapper's measured sounds (`soundShift`: they come ~29 ms early).
  Its long notes are holds only where the sound under them rings ≥20% of their length (`RING`,
  `SoundEvent.len`) and they're an 8th or longer: it writes them out of habit, and charts were up
  to a third holds over sounds that had stopped. To study its output, `onRaw` hands over each chart
  as the model made it (the Nov 19 study ran it headless on the bundled tracks and re-thinned
  offline). e2e tests switch it off (localStorage `rythm-architect:no-ensomi`).
- Its tiles are placed by `placer` (`ensomi.ts`), built once per song from the grid, the sounds
  and the beat tracker's own beats (`beats`, from the worker):
  - **The beat map** (`src/mapping/beatmap.ts`): each beat where the song really has it (the
    tracker's beats at the grid's level, smoothed, lined up with the attacks), so a drifting or
    played song has an exact grid in every stretch, not one straight grid that runs off it. Each
    stretch takes 16ths or triplets (8th or 16th) where its sounds follow them, or none; a sound goes
    onto it within 20 ms (a tile's own time, 12 ms). The check is strict on purpose (`EXPLAINS`,
    `CHANCE`: clearly more sounds on its points than chance): a looser one found a "grid" in random
    sounds on half the beats. Human charts are no timing target: their tiles sit 13-30 ms off the
    sounds on most of the benchmark's songs (some drift through the song); they read tight because
    they're evenly spaced, which this gives ours.
  - **Repeats** (`src/mapping/repeats.ts`): a 2-bar phrase whose sounds (rhythm by band, harmony)
    repeat an earlier one's (`PHRASE_SIMILAR`) is charted alike: thinning keeps or leaves its rows
    as its twin's were (`thin.ts` `twin`), and lane flow pulls each tile to its twin's lane
    (`TWIN_COST`, a pull, not a copy: humans share lanes on repeats ~43% of the time, ours 45%).
  - **Lanes with the tune** (`lanes.ts` `CONTOUR_COST`): a step against the pitch costs a little
    (humans 47% with / 42% against; ours 45/39, from 42/44).
  - **Following one kind of sound**: on Easy, Medium and Hard each phrase favours the band its rows
    weigh most in (`FOLLOW` 0.3: Easy hopped between kinds 29% of the time, humans 20%; now 24%;
    0.6 gave 21% but caught 5 points fewer of the synthetic band's strong notes on Easy and Medium). In a
    full mix nearly every sound reads as pitched, so parts can't be told apart better without
    splitting the song (stems.ts). Most human tiles our charts miss aren't in the model's chart
    and aren't on a sound we measured either: hearing more is what would close the rest.
  - "Easy from the beat" (rows on the beat weighing more on Easy) was tried and left out: human
    Easy charts put 26-50% of their tiles on the beat, ours already ~40%, and more made them less alike.
- Only if it's off or fails: with WebGPU the song is split with Demucs (`src/mapping/stems.ts`,
  ~172 MB, `stemModel.ts`; e2e: `rythm-architect:no-stems`), and the onset mapper's own charts
  (`charts.ts`) are used. All the models run on one ONNX Runtime (`src/mapping/ort.ts`); any of
  them failing leaves the next step to carry on.
- The capture runs on an audio context of its own (`listenCtx` in `listen.ts`, latency hint
  'playback'), not the game's low-latency one, so a busy machine doesn't make it drop sound. While
  the Generate dialog is open (`holdQuiet`, `src/lib/quiet.ts`) the backdrop and the stage preview
  hold still and the menu music's context is suspended once it has rung out; the dialog's own
  canvases draw at most `MENU_FPS` (`menuGate`), and `ListenScope` keeps its settled stars in a
  layer instead of redrawing each one every frame. Keep the listening pass this light: a real
  listen showed the page's frames falling to ~13 a second and the audio clock 20% behind.
- A listen that missed more than 5% of the song (at least 8 s: sound that never reached the
  capture, or a second or more with nothing recorded; `holesIn`, `missLimit` in `capture.ts`) is an
  error with a retry, not a map (the user would rather be told than get a thin map).
- The recording: every chunk the audio thread hands over is kept; the video position is read on
  each chunk (they keep coming with the tab hidden) and every frame; at the end `placeChunks`
  (`src/mapping/capture.ts`) files it by stretches of steady playback (`stretchesOf`, healed:
  glitches dropped, neighbours that carry on where the other left off joined), and
  `chooseRecording` falls back to the as-heard placement if that came out clearly worse. The
  browser's audio clock can fall behind the video when the computer is busy (a real listen: ×1.3,
  a quarter of the sound never captured): then a stretch's offset drifts and `stretchInto` follows
  it (slices placed where the video was, overlapped, no pitch change). The dev tools' Listen line
  says which, and how much was lost.
- **Debugging a real listen: ask for its log, don't guess.** The user's real YouTube listens
  differ from simulations. The dev tools' "Download listen log" saves the timing of the last
  listen (position reads, player states, tab hidden; no audio; `src/mapping/listenLog.ts`);
  `node tools/replay-listen.mjs <log.json>` replays it through the placement and reports what the
  recording holds, the gaps, the hidden spans and the stretches.
- **Mapping the bank again** after the mapper changes: `node tools/remap-bank.mjs [--only=<ids>]`
  runs each listened YouTube song through the page's own Generate beatmap → Listen and map in a
  real Edge window (`withBrowser({ edge: true })`: Playwright's own Chromium can't play H.264/AAC,
  which YouTube serves some sessions, and its player then fails, error 5), the same video, the sound
  kept off the speakers (the capture's `suppressLocalAudioPlayback`; `--mute-audio` silences the
  capture too), the song search answered empty (the mock has its own built-ins). It saves the new maps to
  `.data/remap/`; `--apply` adds each to the live bank and then deletes the old one (bests and
  plays go). Fan charts are left alone unless named in `--only` (One Dance was remade, Nov 19); a map the trained mapper didn't chart is never applied.
- Keep the API types (`src/api/types.ts`), the mock (`mock-server/api.ts`) and the Spring Boot
  backend (`backend/`) in step. No AI runs on the server.
- If it can't listen, an osu! fan chart is the fallback (`mock-server/sources.ts`,
  `src/mapping/osu.ts`). Only tiles and a loudness curve are kept. Never download commercial audio.
- Test with `localhost`, not `127.0.0.1` (label music refuses IPs).
- Sync is automatic, never a hand-set offset: the Map Syncer (`src/audio/syncer.ts`, math in
  `src/mapping/sync.ts`) checks a track's tiles against its audio when it loads and, for YouTube
  songs, moves the map after a run whose hits were steadily early or late. Settings and the dev
  tools have one Resync button (`resyncPlaying` in `src/audio/playback.ts`).
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
- Settings → Background: Dynamic (follows the song) or a fixed theme (`src/background/themes.ts`),
  applied in `forward()` (`background/host.ts`) for the menu's backdrop and the game's sky alike.
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
  at the screen's rate (the run panel's Rive at most 30: `PLAY_FPS`). The shared loop
  (`lib/ticker.ts`) falls back to a timer when the browser holds animation frames back.
- Dynamic resolution: the stage (`RES_*` in Stage3D.ts) and the sky worker draw fewer pixels when
  the page's frames run slow and step back up when they're on time again; the layout never changes.
  They go by the page's frames (`pageFrame`, sent with each batch), not the worker's own, which
  stay quick while the graphics chip falls behind (an integrated chip on a 2880x1800 screen: ~10 a
  second at full resolution during hits). The share drawn now: `Stage3D.resolution`.
- The run panel's numbers (ten times a second) and the controller's state live in stores
  (`lib/store.ts`, `useStore`) read by PlayHud, the Overdrive layer and Results, so the Play screen
  re-renders only when its look changes (fever, Overdrive's level). The panel's pulses are Web
  Animations on one element (`Pulse`), not a remounted motion span per change.
- Keep the 2D fallback (`src/game/render.ts`) working.

## After a change

- After changing the trained mapper's placement (`ensomi.ts`), `thin.ts` or the beat grid, run
  `node tools/map-bench.mjs` (the whole pipeline in a browser on the synthetic band of
  `tests/bench/band.ts`, 76-188 BPM clean and rough, then the bundled tracks): tempo right on every
  band, tiles on real notes, strong notes caught per difficulty, the ladder's steps and holds.
  Nov 19 (with the beat map, repeats and following): tempo 16/16, on-note E 100% M 98% H 98% U 96%
  (the 76 BPM band's Ultra 79%: the model's own chart there, read at 152), strong caught E 79% M 82%
  H 97% U 98% (before them: 80/84/98/98), every step ×1.22-1.73.
  The human-chart study behind them (Nov 19): one browser run saved what the steps after the model
  work from (its raw charts, the sounds, the tracker's beats) for every Creative Commons song, then
  each idea was replayed offline against the human charts in seconds; do it that way again.
- Against human charts: `python -I tools/fetch-cc-sets.py <folder outside the repo>` (Creative
  Commons songs with osu!mania 4K charts; credits in NOTICE.md; their audio is never committed),
  then `node tools/map-human.mjs <folder>`. Nov 19 (26 charts, 19 songs): timing F1 63% at the
  nearest difficulty (78-88% on 9 songs), Ultra holds 69% of the human tiles. Tempo: 10 the same,
  5 half/double (a choice of counting), 3 off where both trackers agree (likely mistimed unranked
  charts). Holds: human median 15% (0-78%: no agreement), ours 6/8/10/12% (E/M/H/U). Lanes
  (`patterns.ts`): move 1.08 a step (human 1.10), quick jumps 3% (8%), balance 30% (29%).
- After changing `src/mapping/automap.ts` or `charts.ts`, run `npm run map`. The band benchmark (`tests/unit/automap-band.test.ts`) must keep finding the notes (legato ones too).
- Before finishing (in `frontend/`): `npx tsc -b`, `npm test`, `npm run test:e2e`, `npm run build`.
  On this Windows box run vitest from a path that starts with an upper-case `C:` (a lower-case
  `c:` working directory makes it load twice and every suite fails with "reading 'config'").
- Windows dev box: write multi-line scripts with the file tool, not shell heredocs (they break on
  quotes).
