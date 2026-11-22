# Rythm Architect

**Name any song. Our AI maps it. You play it.**

Type a song's title and artist, for example *Mr. Brightside* by *The Killers*. Rythm Architect
searches every song its AI has already mapped; if yours isn't there, generate its beatmap. The AI
finds the track, finds every note in it, and builds a beatmap on four lanes with four
difficulties, each a step up from the last. Every tile is a note in the song, at the moment you
hear it:

- **Easy**: the notes that stand out most, one at a time, with long holds where a sound rings.
- **Medium**: more of them, closer together, a chord of two on the biggest hits.
- **Hard**: most of the notes, more chords, shorter holds and taps under them.
- **Ultra**: every note, chords on the biggest hits.

Then you play it in a world of light that moves with the music, in the spirit of Tetris Effect.
The AI doesn't make music. It maps the music you already love.

**See it play:** `npm run video` records real gameplay to `docs/media/gameplay.webm` (no sound;
the recordings are made locally and kept out of the repo). It shows the intro, searching for a
song, a bot playing *Ink and Fury* on Hard with real audio and the dev tools open, *One Dance*
from YouTube (its video in its spot under the stage, then in the game's corner), and the
hand-mapped test song played badly enough to show misses and the results.
`npm run video:overdrive` records the Overdrive update to `docs/media/overdrive.webm` (with a still
of each level): the Background and key settings, the start card's Practice picker, a run that
climbs through the three Overdrive levels to ×8, mashing the keys (strays
drain the signal), and a part of a song practised on a loop at 75%.

## Project 3: Second prototype (Deliverable 4)

CS 2114, Project 3. This README covers how to [run the model](#run-the-model-no-view) and
[the view](#run-the-view), how [the view reaches the model through the controller](#view--controller--model),
then the [Reflection](#reflection), the [Next Steps](#next-steps) and the
[Attribution and GenAI note](#attribution). The design follows the team's Project 3
specification: a Model (the queue-backed classes in `src/java/main/`), a View (the HTML/CSS/TypeScript
game in `frontend/`) and a Controller (`Main`, written by Darsh), which the view reaches through the
server's play routes. The change feature named in Deliverable 3's Next Steps, **Practice mode**, is
built and goes through all three.

### Run the model (no view)

The model is plain Java with no libraries: `Node` and `Queue` (first in, first out), `Note`, the enums,
`Song` (one `Queue<Note>` per difficulty), `SongWriter` (builds a `Song` from a chart), and `Score`
(tracks hit points, misses, combos, accuracy, and high scores). It knows nothing about the view or
the server.

**A tiny driver.** `ModelDemo` reads a real chart (the game's built-in songs are exported to
`src/java/charts/`), writes its `Song`, plays one difficulty's note queue front to back, checks the
notes come out in time order, and shows the model turning down bad charts. From the repo root
(Java 17 or newer):

```bash
javac -d out src/java/main/*.java
java -cp out main.ModelDemo                                         # One Dance, Easy
java -cp out main.ModelDemo src/java/charts/ink-and-fury.chart hard # another chart and difficulty
java -cp out main.ModelDemo src/java/charts/one-dance.chart banana  # an unknown difficulty: Easy
```

**The tests.** JUnit 5 tests for the model classes (`src/test/main/`: `QueueTest`, `NodeTest`,
`NoteTest`, `SongTest`, `SongWriterTest`, `ScoreTest`, `GameScoreTest`, and the others), covering
good and bad cases from the spec's test plan, run with the backend's tests through Maven (Java 25):

```bash
cd backend
./mvnw test "-Dtest=main.*Test"  # just the model's tests (Windows: .\mvnw.cmd ...)
./mvnw test -Dtest=QueueTest     # one class
./mvnw test -Dtest=PlayTests     # playing through the controller over the API (Main on the model)
./mvnw test                      # every backend test (the model's and the API's)
```

The model's tests run on the model alone (no server, no browser): 72 tests over `Node`, `Queue`,
`Note`, `Song` (with Practice mode's `getChartBetween`), `SongWriter`, `Score`, `Main` and
`GameScore`, each method with normal and bad-input cases. The view's own tests are in `frontend/`:
`npm test` (unit) and `npm run test:e2e` (the game in a browser).

In VS Code (Red Hat's Java extension and the Test Runner for Java), the Testing panel and the Run
Test buttons in each test file run them too, and so does **Terminal → Run Task → Run model tests**.
Turn off Oracle's Java extension for this workspace if it's installed: it reads the folders its own
way and shows errors that aren't there.

`node tools/export-charts.mjs` (from `frontend/`) writes the chart files again after the built-in
songs change.

### View → controller → model

What the player does flows through the controller into the model, and the view shows the model's
state:

1. **Start.** Pressing Start (or *Practise* a part) on the start card asks the server for a run:
   `POST /api/play` with the song and difficulty (and, practising, the stretch). `PlayController`
   builds the song's `Song` (one `Queue<Note>` per `Difficulty`, through `SongWriter`) and starts a
   `Main` on it. Practising, the `Song`'s chart is first replaced by `Song.getChartBetween` (only the
   stretch's notes), so `Main` plays just that part.
2. **Play.** Every key press goes to `Main.processInput(lane, time)` and the song's clock to
   `Main.checkMissedNotes(time)`, in order, a quarter of a second at a time
   (`frontend/src/game/controllerLink.ts`, `POST /api/play/:run/inputs`).
3. **Confirm.** With the presses goes the run as the game judged it, and the model confirms it:
   checked against the chart's `Queue<Note>` and counted through `GameScore` (`RunReplay`), the
   same rules as the score at the top of the screen. `Main` is the input reviewer; the model keeps
   the score.
4. **Show.** Each answer is the model's state: the confirmed score and how many presses `Main`
   reviewed (and `Main`'s own `Score` and queue). The run panel shows it live under
   **Controller** ("97,150 confirmed · 512 presses reviewed"), and the results say whether the
   model's score matches the game's (✓). The view keeps no copy of it: it shows the last answer.

The game also judges each press at once in the browser (`engine.ts`, the same rules as
`GameScore`), so a slow network never delays a hit; that is the big score on screen, confirmed by
the model a moment later and counted again before a best is kept. Bad input stops at the
controller. Every input is reviewed before `Main` sees it (`InputReview`): anything that isn't a
press or a clock time (a lane 0-3, a time in seconds, nothing else), an input out of order or long
after the song's last note, and one press sent twice are turned down; a run whose clock ran ahead
of real time (a whole run sent at once), with more presses in a second than hands make, or whose
judged run claims hits nobody pressed a key for is flagged. A best is kept only from a run the
controller reviewed from start to end and passed, and only once (the scores route asks it:
`PlayController.keep`); one client can start only so many runs, and a run takes inputs only so
fast. `Main` still turns down a lane out of 0-3 itself, and `Song.getChartBetween` a practice
stretch that doesn't start before it ends (a 400). `PlayTests` and `InputReviewTests` check all of
it.

### Run the view

The view is the game itself: HTML, CSS and TypeScript in `frontend/` (React, three.js, Tone.js). It
runs on its own against a mock server, with nothing else to start:

```bash
cd frontend
npm install
npm run dev          # then open http://localhost:5173 (as localhost, not 127.0.0.1)
```

To see something happen: click through the opening, type *ink* in **Name a Song**, pick *Ink and
Fury* (a built-in song with its own audio), choose a difficulty and press **Play**; the keys are
**D F J K**. The other built-ins are *One Dance* (it plays from YouTube), *The Restless Stacks* and
*Neon Blueprint*. To map a new
song, type one that isn't there: its videos on YouTube come up under the results. Preview them,
then press **Generate beatmap** on the one you want (desktop Chrome or Edge: the game listens to that
video once through tab sharing). With the Java backend instead of
the mock: `cd backend && ./mvnw spring-boot:run`, and `VITE_API_BASE_URL=http://localhost:8080` in
`frontend/.env.local` (see [The backend](#the-backend)).

## What's in the frontend

- **The intro.** A three-second opening every time the game loads, filling the screen
  (`frontend/src/intro/WorldIntro.ts`, three.js): the camera flies in from deep space while a swarm of light
  gathers into a planet with glowing continents, ribbons of light sweep round it, a spiral disk of
  stars turns, rings and arcs of light fly between the continents, and the title gathers beneath.
  D F J K send a ripple of their colour across the world and fire arcs (the world never follows the mouse). Then
  it waits for a click (or any other key), and the click launches a three-second way in: a ring of
  light opens where you clicked, the dust is pulled into the world, its rings spin up and arcs fire
  faster and faster; then a shockwave bursts out, the planet flies apart past the camera as it
  dives through, and the title arcs up to its place on the menu while the panels build themselves
  around it, landing with a flash. The click also lets sound start; the menu's music is built once
  the title lands, so the launch keeps a steady frame rate (the world also drops its resolution if
  frames run slow).
  Without WebGL, a Rive orbit stands in. `?nointro` skips it.
- **The workspace.** Left: the title and the AI. **Name a Song** has a title and an artist field;
  every mapped song is searched as you type. For a song that isn't mapped yet, its videos **On
  YouTube** come up under the results once you stop typing (the best few, best first, with their
  thumbnail, channel and length): **Preview** plays one right there, in its own player under its
  row (the menu's music waits), and **Generate beatmap** maps that video, so you choose which
  upload is mapped rather than the search guessing. Under it, **Favorites**: a drop-down of your starred songs with its own search,
  which takes the rest of the column and scrolls.
  Each song shows its cover art, or a living Rive cover tinted to the song. Right: gameplay only.
  Before a song is picked, a waiting screen (a Rive loop of orbits over four lanes that answers your
  typing); once one is, the 3D stage where a ghost plays it, and at the very bottom the song's
  name, a favourite star, Preview, Play and the difficulty.
- **The music bank.** Its own screen (`#/bank`), opened by the **♫ Bank** button under the settings
  gear: every mapped song A to Z in letter groups, a search at the top (title or artist; typing
  anywhere goes there) and a rail to jump between letters. The song on stage keeps playing there,
  and picking a song plays it right away without leaving the bank (a "Now playing" card shows it,
  with a YouTube song's video). Esc clears the search, then goes back to the menu with the song
  that was playing on stage, its preview carrying on from where it was.
- **The game.** Four lanes on D F J K by default (rebindable in Settings; arrows / 1–4 / touch work
  too). Perfect/great/good windows, holds, a combo multiplier up to ×5 with **fever** at ×5, health
  ("signal") and no-fail, pause, early/late feedback (under the hit line, never over the tiles).
  A Perfect is worth 1,000 (`Score`'s 100, ×10). A miss costs a good chunk of signal and hits give
  only a little back. A key pressed with no tile to hit is a **stray**: it costs some signal and
  Overdrive charge, so mashing every key can't clear a song (a few strays are forgiven; a second of
  mashing drains the signal). One **run panel** down the left holds the score, accuracy,
  multiplier, combo, signal and live Perfect/Great/Good/Miss counts, headed by a YouTube song's
  video; where you hit stays in the centre of the screen. Every 25 in a row (and fever) is
  **called out on the right**: the number slams in and counts up, a streak cuts across, rings and
  shards burst, every hundred in gold. Big moments burst from the sides of the track and tiles draw
  over every effect, so the notes stay readable. Hitting a tile makes no sound: the song is the
  sound (synth songs play every note of the map themselves). Each map sets its own **note speed**,
  as in Beat Saber: harder difficulties fall faster, and faster songs too (part of the way, so a
  song's tempo still shows in how close its tiles are); the start card shows it. **How to play**
  (the ? beside Settings, or the start card) walks through tiles, holds, timing, combo, Overdrive,
  the signal, the difficulties and practice, each with a moving diagram.
- **Overdrive.** Accurate hits fill a charge (shown under the multiplier: a Perfect 3, a Good 2,
  Early or Late 1, a hold held to its end 3, out of 100, so about 34 Perfects in a row; a miss takes
  20). When Overdrive ends, run out or broken, the charge empties with it, and its name says so on
  the right: broken by a miss, it cracks in red and its letters fall away while the screen's sides
  flash red; run out, it drifts up and fades. When it's full, press
  **Space** (or the key you bound, or the HUD's button on touch screens): Overdrive adds +1 to the
  multiplier for the next 60 tiles. Press again whenever the charge fills while it runs to stack it,
  up to three levels: ×5 from the combo plus ×3 from Overdrive is **×8**. At the top it can't be set
  off again, and **a single miss ends it**, every level, except in its **grace**: for 3 seconds after
  each press (time to get from the key back to the lanes) a miss costs its combo and signal but not
  Overdrive, and a countdown beside the lanes shows it. Each level takes the whole field to its own
  colours (the tiles, pads, beams, walls, track, the world and the sky): *Neon* (purple and pink),
  *Eclipse* (white light on black: the sky's colour drains away) and *Prism* (every colour, turning
  across the lanes). When the charge is full, beacons rise from both sides of the
  hit line in the next level's colour and a cue beside the lanes names the key. Each level goes up
  with a bigger burst: the camera lunges into a warp (streaks of light rush past outside the lanes,
  the stars in the sky stream by, faster each level), every pad kicks, shockwaves cross the track,
  light pours up both sides, the sky storms with fireworks and comets, the screen's edges flash, the
  level's name lands on the right and the multiplier slams in. On built-in songs the song itself
  whooshes (a quick filter sweep; YouTube's audio never reaches the page). While it runs, the warp
  keeps rushing, the hit line throbs on the beat, every hit rings wider, light climbs the walls and
  streams down the sides of the screen, and the HUD counts what this Overdrive has added. With a
  quarter left the field flickers between its colours and the song's; it runs out (embers fall, the
  colours drain back) or a miss breaks it (it shatters red), and the points it added are counted out
  beside the lanes. The results show the highest level, how often it was set off and what it
  added. The server checks every Overdrive in a saved run (`GameScore.startOverdrive`) and every
  grace (no longer than the chart has tiles for in 5 seconds: `RunReplay.graceTiles`).
- **Practice.** On the start card, switch *Play the song* to *Practice a part*, drag the loop's
  start and end anywhere in the song (the sections show as ticks) and pick a speed: 50%, 75% or
  100% (the speeds YouTube's player has, so a YouTube song and its tiles always move together); the
  one button (or Enter) then says and starts what you chose, e.g. *Practise 0:20–0:30 · 75%*. It loops
  (Loop 2, 3...) until you stop it from the pause menu; nothing is saved and you can't fail. The song really slows down: the
  track, the synth, or YouTube's own player (at the nearest speed it has).
- **Settings.** Volume and backing in 1% steps; **keybinds** (click a lane or Overdrive, press the
  new key; keys swap rather than double up; every key shown in the game follows them); and
  **Background**: *Dynamic* (it follows the song, as before) or a fixed colour (Nebula, Ocean,
  Aurora, Rose, Ember, Gold) on the menu and in every song.
- **Waking the server.** A free server sleeps when nobody plays, and takes about a minute to wake.
  Nothing waits for it: the menu opens at once, and wherever something is waiting on the server
  (the searches, Favorites, the music bank, a song loading) a small line says it's waking, with a
  clock, and offers to try again if it takes too long.
- **Results.** Grade and score (the grade is the score against the best the chart allows, every tile
  Perfect with Overdrive used as soon as it charges: S from 85% of it, A 65%, B 45%, C 25%, D
  below; the results show the share); accuracy and max combo, then Perfect, Great, Good and Miss; *Play
  again* (R) or *Return to main menu* (Esc). The song plays again quietly behind it, and back on
  the menu it plays on from where it was as the song's preview.
- **Menu music.** While no song preview is playing, the menu plays *Drift*, a calm piece composed
  for the game in code (`frontend/src/audio/ambient.ts`): soft pad chords, a warm sub, glassy bells and a
  slow sung line, about a minute long and a little different each time round. It goes quiet for a
  song's preview and the Generate dialog (the listening pass hears the whole tab). Settings → Menu
  music turns it off.
- **Failing.** When the signal runs out, it drops: the music winds down like a tape stopping, the
  tiles slow to a halt, the lanes go dark from the outside in and shed red sparks, the camera sags,
  and a flatline draws across the screen with *Signal lost*, then the results (with how far you
  got). Clearing a song plays a finale first: light on every lane and *Clear* (gold, *Full combo*).
- **Loading.** While a song loads: four lanes with tiles of light running down onto the hit line,
  the song's name and what's happening (the map, the track, the video).
- **Impact.** Tiles pop into being and bounce on the beat; a hit bursts the tile into a shell of
  light with sparks that swirl upward, star glints and a flare; receptors are on springs; chords are
  joined by a bar of light; the camera and the screen take a punch sized to the hit.
- **The climb.** Bands of light run up both sides of the track when the song calls for it: a
  downbeat that hits harder than the music around it, a drop, a new section, and gold volleys on
  fever and milestones. Quiet stretches leave the walls still (in the 2D fallback too).
- **The stage.** A dark glass playfield framed by walls that light up the whole length of the
  track at the song's big moments, with a world of particles behind it (eleven forms in turn: a
  galaxy, a crystal, a ring, a trefoil knot, a sphere, a vortex, a bloom, an atom, a helix, a
  hypercube, a wave) that breathes with the bass and flows into a new form at each section.
  Far behind, a sky: ribbons of light, rings pulsing out of the world on each bar, columns on the
  horizon rising with the music, comets, and every hit echoed as a burst of light. The song's drops,
  sections and impacts set off **storms**: fireworks chain across the sky, comets streak, the
  columns leap and the backdrop's grains scatter with each burst. The combo has its own callouts and
  fever turns everything gold, but the background follows the song. The count-in ends before the
  song's first sound.
- **The backdrop**, on the menu and while playing: motes of light that settle into cymatic figures,
  stars streaming toward you (faster with the music, a warp on drops and milestones), rings of light
  on every beat, crystals that pop on every hit and keystroke, a colour bloom with the loudness, and
  a new palette at each section.
- **Dev tools** (the Dev button or <kbd>`</kbd> in the game): autoplay (perfect, human, sloppy;
  autoplay runs aren't saved), the queue of notes to come (lane by lane, and the next six), the
  clock (time, beat, bar, section), live judgements with a hit-error bar, audio levels, frame rate
  and particle count, audio offset / no-fail, effect triggers, the map's data, and
  deleting a map.
- **Rive everywhere it helps.** Intro, wordmark, waiting screen, covers, the mapping animation, hit
  bursts, hold loops, combo meter, difficulty badges, results stars. All generated by code, each with
  a non-Rive fallback.

## Run it

Everything for the game lives in `frontend/`; run every command from there.

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, with the mock backend at /api
```

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `preview` | Vite dev server, production build, preview the build |
| `npm test` | Unit tests (Vitest): chart writer, onset mapper (with a band benchmark), game rules |
| `npm run test:e2e` | Browser tests (Playwright): intro, search, the music bank, generating (listening pass and fan-chart fallback, with a fake YouTube player), favourites, playing, dev tools, pausing, failing, phone |
| `npm run rive` / `rive:check` | Rebuild the `.riv` files from `frontend/tools/rive/art/`, and check them in the real runtime |
| `npm run rive:bake` | Bake the hit and hold bursts to the sprite sheets the game's stage draws (`frontend/public/rive/baked/`) |
| `npm run video:listen` | Record the listening and loading process (Generate → listen → map → chart → load → play) to `docs/media/listening.webm`; self-contained (own server, stand-in YouTube player) |
| `npm run map` | Re-map the bundled test tracks with the onset mapper (`frontend/src/mapping/automap.ts`) |
| `npm run video` | Record `docs/media/gameplay.webm` (needs `npm run dev`) |
| `node tools/replay-listen.mjs <log.json>` | Replay a real listen from its log (dev tools on a mapped song → *Download listen log*: the timing only, no audio): how much of the song the recording holds, the gaps, when the tab was hidden |

**Performance.** The game screen draws as "one stage". How it draws is a profile in
`frontend/src/lib/perf.ts`: **B where the browser has WebGPU, A where it doesn't** (`gameProfile()`,
set in `frontend/src/main.tsx`). The menus use the same system: the backdrop is the stage's sky on the graphics chip in its own worker (`background/sky.worker.ts`), the preview stage runs in a worker, and both (with Rive) draw at most 60 frames a second there (`MENU_FPS`); gameplay and the intro draw at the screen's rate.
- **A · One stage** (WebGL): the backdrop drawn inside the 3D stage (`stage/sky.ts`, from the page backdrop's own simulation, `SynthScene.shapes()`), soft effects at half resolution (`stage/halfFx.ts`), the Rive hit and hold bursts baked to sprite sheets the stage draws (`npm run rive:bake` → `frontend/public/rive/baked/`, `stage/bursts.ts`), the whole stage in a worker (`stage/proxy.ts` on the page, `stage/stage.worker.ts`), and every main-thread animation on one shared loop (`lib/ticker.ts`, which falls back to a timer if the browser holds animation frames back).
- **B · One stage, WebGPU**: A drawn with WebGPU. Every GLSL shader (`stage/shaders.ts`) is written again in TSL (`stage/gpu.ts`, loaded only by B's worker), tone-mapped per material so light adds up as in WebGL; points become instanced sprites. Falls back to WebGL 2 where the browser has no WebGPU. B also builds and draws every pipeline once while loading (no first-use hitches), merges the sky's passes, and plays the page's big moments (combo callout, section banner, countdown) with only transform and opacity moving: the callout is built once and kept, glows are gradients, not blurs.

Both keep pooled judgements, a throttled HUD, and an eased video clock with a smooth start.
`node tools/check/flow.mjs [outDir] [width] [height]` (from `frontend/`) screenshots the app's main
views; `node tools/check/autoplay.mjs <songId> <difficulty>` has a bot play a song and screenshots it.

## The backend

The frontend talks to `/api` (or `VITE_API_BASE_URL`). The contract is in
[docs/api.md](docs/api.md) and the types in [frontend/src/api/types.ts](frontend/src/api/types.ts).
Two backends implement all of it:

- **`backend/`** (Java, Spring Boot): the real one (no AI runs on it: songs are charted in the browser). Run it with
  `./mvnw spring-boot:run` from `backend/` and set `VITE_API_BASE_URL=http://localhost:8080` in
  `frontend/.env.local`; see [backend/README.md](backend/README.md).
  Its song bank can live in **Supabase** (Postgres) instead of a file, so it survives restarts:
  set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` ([docs/supabase.md](docs/supabase.md)). It starts in
  about 2 s in its Docker image (the jar unpacked, plus Java 25's ahead-of-time class cache),
  and reads the song bank in the background once it's up.
- **`frontend/mock-server/`**: runs inside the Vite server when `VITE_API_BASE_URL` is empty and
  keeps its songs in `frontend/.data/songs.json`.

The mock never makes up a song. Search pulls up songs that are already mapped. **Generate
beatmap** maps a new one, and it plays from YouTube:

1. **Find the video.** Paste the song's YouTube link into Title, or type title and artist (searching
   YouTube by name needs a free YouTube Data API key: `YOUTUBE_API_KEY` in `frontend/.env.local`, see
   [docs/youtube-api.md](docs/youtube-api.md)). The video shows in YouTube's own embedded player. Its audio is never downloaded.
   **Only songs:** search asks YouTube for its Music category, and every video, found or pasted, is
   checked (`notSongReason` in `mock-server/match.ts`, `Matching` in the backend): a reaction,
   tutorial, full album or ten-hour loop, or anything under 45 s or over 15 min, is refused with a
   message saying why; with the API key, a pasted link must also be music on YouTube or look like
   a song upload (a Topic or VEVO channel, "Official Audio", "Artist - Title").
2. **Listen once.** Press *Listen and map* and share this tab with its audio. The song plays once
   while the browser records what it hears (a short tick first measures the capture delay; at the
   end the recording is filed by the video's position, one offset per stretch of steady playback,
   so it stays seamless and nothing is lost when the page stalls: `placeChunks` in
   `frontend/src/mapping/capture.ts`), then the onset mapper (`automap.ts`, in a worker) measures the beat
   and every sound, a **trained mapper** (Ensomi R2, also in the browser) charts the song, and the
   recording is dropped (see *How a map stays true to the song*). If the trained mapper can't, the
   onset mapper's own charts are used. Only the tiles and a loudness curve for the visuals are kept. The
   mapper finds notes with SuperFlux over a 24-bands-per-octave spectrogram, so a melody that only
   changes pitch still gets its notes (on the benchmark in `frontend/tests/unit/automap-band.test.ts` it finds
   every note, against 62-85% before); lanes follow pitch, or brightness for drums, ranked within
   two bars. While it listens, the song fills in under the video as three rivers of light (lows,
   mids, highs) and every note heard pops up as a star, building a constellation of the song, with
   a count of the sounds heard; the whole screen around the dialog streams with light and rings
   that follow the music (`ListenScope.tsx`, `ListenAura.tsx`). While it maps, a beam sweeps the
   song; while the AI charts it, the measured sounds settle in, bar lines draw down, four lanes open
   and threads of light reach from sounds to lanes; then every tile leaps into its lane, the screen
   bursts, and the Easy, Medium, Hard and Ultra tile counts count up. If sharing is turned down or stops part-way, the dialog says so and offers to try again.
   Typing a song that's already mapped shows it, without offering to generate it again.
3. **Fallback: a fan chart.** Browsers that can't share a tab's sound at all (phones, Safari,
   Firefox): the mock looks up a fan-made osu! chart of the song (osu!mania 4K first, then other key
   counts, then osu! standard, converted) and lines it up with the video. The dev tools' *Song sync*
   nudges it.

YouTube songs play in one embedded player that the screens dock into a corner (YouTube requires a
visible player of 200×200 or more with nothing over it); the game clock follows the player. It
only shows while the song plays. On the menu it has its own spot in the bar under the stage, in
place of the cover (until the preview plays, the spot says how to start it), so it never covers
the stage; in a game it sits in the top-left corner, and the Generate dialog shows the cued video, and players can't click or focus it: it's inert and
the game drives it. Around it (never on it) sit a hairline frame with corner ticks and a glow on
the beat. Label
music won't play on a page opened as `127.0.0.1`: use `localhost`. Songs that earlier versions of
the mock invented ("stand-in audio") are dropped from the store.

It starts with three songs:

| Song | Audio | Map |
|---|---|---|
| Neon Blueprint | Built-in synth | Hand-mapped to show every effect |
| Ink and Fury (organ toccata, C minor) | Real audio | Onset mapper |
| The Restless Stacks (waltz, D minor, 3/4) | Real audio | Onset mapper |

The two real tracks were composed by Claude for SchmollCrossword (MIT); see [NOTICE.md](NOTICE.md).

## How a map stays true to the song

`frontend/src/mapping/automap.ts` finds every onset in the audio and times each one to its attack within a
few milliseconds (attacks within 20 ms of a 16th are placed on it; the rest keep their exact time).
How long each sound rings decides holds; its pitch decides the lane; the biggest downbeats become
chords on Ultra. For songs mapped by listening, a trained mapper places the tiles (below); if it
can't, `frontend/src/mapping/charts.ts` picks them from the measured sounds by how much they stand
out, never at random and never adding a note that isn't there.

Before that, two models run in the browser on what was heard (the mapping worker,
`frontend/src/mapping/listen.worker.ts`; the audio still never leaves the page):

- **The beat** (`beats.ts`): the Beat This! tracker (10 MB, `frontend/public/models/`) finds the beats and
  downbeats; its grid sets the tempo, beat 0 and the meter (3 or 4) whenever its beat is steady beat
  to beat for at least 40% of the song, even when it drifts off one straight grid (a long song, or the
  capture slipping). When it finds no steady beat, the trained mapper's own, larger beat tracker
  (the grid of the chart Ensomi writes, `osuGrid`) sets the tempo instead: right or exactly half or
  double on 27 of 28 test songs, though it reads fast songs at half time. The onset mapper's own
  estimate (which reads fast songs at 2/3 of their tempo) is left only for when neither is there. On 14 Creative Commons tracks with known tempos
  (full length) it gets 11 right (two very slow songs at double time, one at 1.5 times) against 8 for
  the onset estimate; the same 14 sped up to 200 BPM, over 6 minutes, through a simulated listen
  (a coarse YouTube clock, page stalls): 12 right (one at half time, one wrong). (An earlier rule,
  half the beats on one straight grid, threw away right tempos: a 200 BPM song was kept at 121.)
- **The tiles** (`ensomi.ts`): Ensomi R2, a model trained on human-made osu!mania 4K charts, charts
  the song from the audio (about 20 s on WebGPU for a 3-minute song, about 90 s without). Its model
  (about 120 MB) downloads from Hugging Face while the song is listened to and stays in the
  browser's cache. Its lowest star rating is usually about this game's Ultra (the whole chart), so
  it charts at that rating; where Ultra would be thin (fast, intense songs, whose hardest stretches
  2★ eases), it charts again busier and each 10 s of the song takes the chart nearest about two
  tiles a beat. Its long notes are holds only where the sound under them rings for a fifth of
  their length or more (the onset mapper measures how long each sound rings): the model writes
  long notes out of habit, and charts were a third holds over sounds that had stopped. Then every
  difficulty keeps a subset of its tiles (`thin.ts` `KEEP`): the strongest sounds, spaced out, each
  stretch of the song keeping its share, each step about 0.7 of the tiles of the one above (Easy
  about a third of Ultra, Medium half, Hard 0.7), with chords and holds coming in gradually (none
  on Easy, a few on Medium's biggest hits, about one row in seven on Hard, all of the model's on
  Ultra; Easy holds only the long ones). Measured on the two bundled songs (Nov 19), the ladder
  went from ×1.35, ×1.8 to ×2.2, ×1.1 to ×1.15 (Medium to Hard doubling, Hard to Ultra hardly
  anything) to about ×1.4 each step, and holds from up to 32% of the tiles to 3-8%. Songs saved before
  Ultra (three charts) are upgraded when they load (`api/upgrade.ts`): the old Medium is Easy, the
  old Hard is Ultra, and their best scores move with them.
  Its tiles come about 29 ms early (measured on a groove with known hit times), so they move onto
  the sounds the onset mapper measured.
  Each difficulty's lanes are then flowed for its own speed (`lanes.ts`), never moving a tile in
  time: thinning had kept the model's lanes, written for its whole chart, so an easier chart hopped
  about 1.4 lanes from one tile to the next where human charts move about 1.1, with more quick
  edge-to-edge jumps. Measured against 26 human charts (`patterns.ts`, `tools/map-human.mjs`), the
  flowed charts sit within the human range on lane movement, quick repeats, jumps, one-hand runs,
  lane balance and repeated patterns.
  Then three things that human charts do (measured against the same 26 charts, Nov 19):
  - *An exact rhythm.* The beat tracker's own beats make a beat map (`beatmap.ts`), so a song
    whose tempo drifts still has an exact grid in each stretch, 16ths or triplets, and tiles go onto
    it (within 20 ms) wherever its sounds clearly follow one: 44% of the tiles sit exactly on it,
    from 12%. The check is strict: a looser one found a "grid" in random sounds.
  - *Repeats charted alike* (`repeats.ts`): a phrase that repeats an earlier one keeps the same
    moments and leans toward the same lanes (45% of repeated tiles in the same lane, from 37%;
    the humans' charts: 43%).
  - *Lanes that go with the tune*, and easier charts that follow one kind of sound through a
    phrase rather than hopping between the kick and the melody (Easy hopped 30% of the time; the
    humans' Easy charts 19%; ours now 24%, without catching fewer of the strong notes).
  And the song's form (`sections.ts`, Nov 21): its sections found from what it repeats (each
  phrase's sounds and its singing's rhythm and tune against every other phrase's: a chorus is its
  melody coming back), not from loudness alone, and each section's density set by how intense it
  is, held through the section, a chorus a little more each time it returns. Against the fan charts
  of three pop songs, our density over the song now follows theirs (tiles per 4 bars: r −0.09 →
  0.53) and moves as much as theirs does (spread 0.14 → 0.21; theirs 0.23); a returning section
  keeps its first time's rhythm, and every chart ends on a chord. The start card shows it: the
  chart's density through the song with its sections, the choruses lit (in practice, a section's
  name loops it).
  Every chart is then rated with osu!mania's star rating (the runtime's `starRating`), shown on the
  start card. Easy is thinned to the same rating on every song (1.05 stars), Medium and Hard to even
  steps between it and the song's Ultra, so each difficulty plays about as hard from song to song
  (by share alone, Medium ranged 1.14-1.50 stars; now 1.19-1.39) and every step stays even.
  What players miss is kept per tile from their checked runs (the server's `TileHeat`), and after
  each kept run the results ask how the map felt (right, or off and why: the notes didn't match the
  song, the timing, too hard, too easy; the server's `RunFeel`), so the mapper's rules can be
  tuned from real play (`tools/heat-report.mjs`).
- **If the trained mapper fails**: with WebGPU, Demucs (`stems.ts`) splits the song into drums,
  bass, vocals and other so the onset mapper finds each part's sounds on its own (model about 172 MB,
  cached likewise), and `charts.ts` picks the tiles as described above.

## Layout

```
frontend/               the game: everything below runs from here (npm scripts, Vite, tests)
  index.html            the app's page
  lab/                  dev-only pages: the Rive lab and the burst baker (rive-lab.html, rive-bake.html)
  public/               audio of the bundled tracks, the .riv files and their baked sprite sheets
  src/
    main.tsx, App.tsx   start-up and the routes
    api/                types (the backend contract) and the client
    audio/              playback (Tone.js: real tracks, synth songs, previews), YouTube, the menu's music
    mapping/            the Generate pipeline: listening, the beat tracker, the onset mapper, the
                        trained mapper, the beat map and repeated phrases, the song's form
                        (its sections), charts, osu! fan charts, loudness and visual cues
    library/            the songs cache, search and the music bank's letter groups
    game/               rules (engine.ts), autoplay, the 2D fallback renderer
    stage/              the three.js stage (Stage3D.ts, with its shaders, textures and particle forms),
                        its worker, the WebGPU twins (gpu.ts) and the baked bursts
    background/         the reactive backdrop and its workers
    intro/              the opening (WorldIntro.ts) and its React wrapper
    screens/            Workspace, Play and the music bank
    components/         shared pieces (icons, loader, covers, song rows, video slots, settings)
      menu/             Name a Song, favourites, now playing, difficulty, the waiting screen
      play/             the HUD, callouts, judgements, hit bursts, start/pause cards, results, dev tools
      generate/         the Generate dialog, the listening scope and aura
    lib/                routes, settings, perf profiles, the shared frame loop, small helpers
    rive/               the Rive React wrapper
    lab/                scripts for the dev-only pages
    styles/             tokens, global, then one sheet per area: workspace, intro, dialogs, video,
                        game, feedback (loading, listening, failing), bank, background
  mock-server/          the mock backend the dev server runs at /api
    songs/              the songs it starts with (and their mapped charts in tracks/)
  tools/                Rive generator (rive/), track mapper, safe browser
    video/              the gameplay and listening recordings
    check/              screenshots and the autoplay bot
  tests/                unit/ and e2e/
backend/                the Spring Boot backend (Java): songs, search, YouTube, fan charts
src/java/main/          the model: Queue, Node, Note, the enums, Song, SongWriter, and ModelDemo (the driver)
src/test/main/          the model's JUnit tests (run with ./mvnw test in backend/)
src/java/charts/        the built-in songs' charts, for the model (frontend/tools/export-charts.mjs)
docs/                   the backend contract (api.md), resources, media
```

## Reflection

### How the design absorbed the change: Practice mode

Deliverable 3 named Practice mode as the change feature: pick any stretch of a song and play it
on a loop, slowed down if you like. It is built (Nov 17; through the controller Nov 19). The
classes it actually touched, against the prediction:

| Class | D3 prediction | What happened |
|---|---|---|
| `Song` | A new `getChartBetween(Difficulty, from, to)`: a new `Queue<Note>` with only the stretch's notes. | **Matched.** Added as predicted, with its tests (`SongTest`: the stretch in order, an empty stretch, no chart, `from` after `to`). |
| `Main` | `processInput` and `checkMissedNotes` take time scaled by the speed; a new `startPractice(from, to, speed)`. | **Didn't change.** Note times stay in song seconds and the speed only slows the clock, so `Main` needs no scaling; and a practice run is just a `Main` on a `Song` whose chart is the stretch (`PlayController` sets it from `getChartBetween`). |
| `Score` | `reset()` at each loop, plus an `isPractice()` flag. | **Didn't change.** Each loop is a fresh run (a new `Main`, so a new `Score`), and practice runs are never sent to be saved. |
| `PlayController` (backend) | Not predicted (the controller's routes didn't exist yet). | **New.** `POST /api/play` takes an optional stretch. |
| View | `playback.ts` (rate, looping), `Play.tsx` (choosing the part), `engine.ts`. | **Matched, and more.** Also the start card (`PlayCards.tsx`: start and end handles, the speed), the stage worker (it carries its clock on at the rate), and the YouTube player (it only plays at 50%, 75% or 100%, so those are the speeds). `engine.ts` didn't change: it gets the stretch's tiles. |
| `Queue`, `Node`, `Note`, the enums, `SongWriter`, the mappers | Should not change. | **None changed.** |

What surprised us: the model side was smaller than predicted (one method, no flags), and the work
was all in the view's clocks. A slowed song has three clocks (the audio, the 3D stage in its own
thread, and YouTube's player), and the tiles stuttered until all three ran at the same rate; any
speed YouTube's player can't play put the video and the tiles apart, which is why the speeds are
YouTube's.

### Did the change cross the model/view line?

Only as data. The view learned two things: that a run can be a stretch (a start and an end, in
seconds) and that the clock can run slow. Neither is the model's business: the model only sees the
stretch's notes, at their real times. The change rippled through layers inside the view (the audio,
the stage worker, the YouTube player), not across the model/view line. The one place it touched
both sides is the play route, and there the view sends numbers and the controller turns them into
a model call (`getChartBetween`); the view never builds a `Queue` or a `Note`.

### What would make the next feature cheaper

The rules exist twice: in `Main`/`Score`/`GameScore` (Java) and in the browser (`engine.ts`,
`score.ts`), kept in step by shared tests. Giving `Main` its rules as an object (a `Judge` with the
hit windows, how lanes and holds are matched, and what a hit is worth) and building the browser's
copy from the same table would make the next scoring change one edit instead of four. And if
`Main` took a `Queue<Note>` (not only a `Song` and a `Difficulty`), practice and any later "part of
a song" feature would need no `Song` built just to hold a stretch.

### What changed from the spec

Each change says what the spec said, what we built, why, and what prompted it.

| # | Area | The spec said | We built | Why | Prompted by |
|---|---|---|---|---|---|
| 1 | **SongWriter** (class, signature) | `SongWriter.generateSong(String title, String artist)` asks the Claude API to map the song into Easy, Medium and Hard. | `SongWriter.writeSong(String chart)` / `readSong(Path file)` build a `Song` (one `Queue<Note>` per difficulty) from a chart the app made, and `writeSong(title, artist, bpm, duration, tiles)` from one already in pieces (how the server takes in its songs); `SongWriter.chartFor(Song, Difficulty)` picks the chart to play. The charts come from a trained beatmap model (Ensomi R2, trained on human osu!mania charts) that listens to the song in the browser. | We built the Claude version first (`SongMapper.java` behind `POST /api/chart`, Nov 7-10). It worked, but its charts felt off the music and awkward, a song took minutes (calls timed out), and each song cost about $1-3. The trained mapper charts a 3-minute song in about 20 s, for free, and its tiles land on the beat. Claude was removed on Nov 11. | Play-testing the Claude charts (Miles, Nov 10), its timeouts and its token cost. |
| 2 | **Queue** (signatures) | `enqueue(Node)`; a null node returns without adding. | `enqueue(Node<T>)` ignores a null node as specified, and `enqueue(T)` wraps data in a node (what callers use). | Building a chart is simpler with data than with nodes. | Writing `SongWriter`. |
| 3 | **Queue** (validation) | `dequeue` and `peek` on an empty queue: the method table says "return null", the test plan says "NullPointerException". | Both throw `EmptyQueueException` (unchecked, "The queue is empty"). | The spec contradicted itself; `null` can't be told apart from a note that is null (the queue allows null data); a named exception says what went wrong. | Writing `QueueTest` from the test plan. |
| 4 | **NoteType** (class) | The Data section lists `NORMAL`, `HOLD`, `SLIDE`; the method table's default is `A`. | `NoteType` is the note's letter, `A` to `G` (its pitch, which synth-played songs use); a hold is a note marked `isHold()`, held for its `noteLength`; there are no slides. | Lanes and holds already say how a note is played; the letter was needed for playing synth songs. | The two halves of the spec disagreeing; the game's charts carrying a pitch per tile. |
| 5 | **Note** (validation) | Null type: default `A`; length of zero or less: default 1; `toString()` is "NoteType, noteLength". | As specified (also a null `MusicNoteType` becomes `NORMAL`; `NaN` lengths become 1). Notes also keep `timeStamp` (seconds) and `lane` (0-3), from the Data section. | | `NoteTest` from the test plan. |
| 6 | **Song** (validation) | Reject a null or empty title or artist and a non-positive duration or BPM; `getChart` returns null when there's no chart; `setChart` rejects nulls. | As specified (`IllegalArgumentException` with a message; `getChart(null)` is null). | | `SongTest` from the test plan. |
| 7 | **Model/View boundary** | The view knows only the next few notes, never the whole queue at once. | The view loads a song's whole chart once (a few KB), because it draws tiles all the way down a 3D track and runs offline from the server; but each frame it now only looks at the notes near the hit line. | Drawing far-away tiles needs their times; asking a server for every frame's notes would add network delay to every hit. | Miles asking whether the game "loads the entire queue" while chasing a slowdown (Nov 11): the per-frame work was cut to a window. |
| 8 | **Controller** | `Main` (Spring Boot) relays input and score between the view and the model. | `Main` (Darsh) is plain Java in the model's package; the Spring Boot backend's `PlayController` gives each run its own `Main` and routes the player's presses and the clock to it, and the view shows `Main`'s `Score`. The browser also judges each press at once (`engine.ts`) for the big score on screen. | A hit can't wait on the network; the controller counts the same presses a quarter of a second at a time. | The view had to be playable before the controller existed; wired for Deliverable 4. |
| 9 | **Validation: key at the wrong time** | Penalize the score. | A press with no tile to hit is a *stray*: it costs a little signal and Overdrive charge (recorded in the run as `X`, so the server's replay agrees), but no points and no combo. Strays don't count from long before the first tile or after the last. | At first strays were ignored (penalizing them seemed to punish tapping along to the beat), but then mashing every key cleared songs for free. A small cost per stray stops mashing without punishing the odd extra press. | Play-testing (Miles, Nov 17). |
| 10 | **Validation: no difficulty chosen** | Default to Easy. | `SongWriter.chartFor(song, null)` gives Easy. In the game a difficulty is always chosen: the menu starts on Medium, and a link with no or an unknown difficulty goes back to the menu. | | The e2e bad-input test. |
| 11 | **Validation: AI fails or returns bad data** | `SongWriter` throws; the view says "Couldn't create song". | If the trained mapper fails (no model download, bad output), the song still gets charts from the on-device onset mapper, and the dev tools say why. A bad chart file makes `SongWriter` throw an `IllegalArgumentException` that names the problem, and the server turns down a mapped song or fan chart `SongWriter` can't take in. | Better a playable map than an error. | The e2e test "when the trained mapper fails". |
| 12 | **Tests** | Tests for Node, Queue, Note, Song, SongWriter, Score and Main. | JUnit tests cover Node, Queue, Note, Song, SongWriter, Score, Main and GameScore (`src/test/main/`, with good and bad cases from the plan); backend, frontend unit and browser suites cover the rest of the app. `ScoreTest` has 8 tests and `MainTest` has 13 tests for construction, hit windows, invalid input, missed notes and upcoming notes. | | The test plan. |
| 13 | **Scope** | JavaFX, then HTML/CSS (revised scope). | HTML, CSS and TypeScript (React, three.js for the 3D stage, Tone.js for sound), songs played through YouTube's embedded player. | We know the web better, and YouTube lets any song play without downloading its audio. | The revised scope and the GTA conversation. |
| 14 | **Score** (rules on top) | `Score`: a Perfect 100, a Good 75, an Early or Late 50; a combo. | `Score` unchanged. `GameScore` on top: points ×10 (a Perfect is 1,000), a combo multiplier to ×5, and Overdrive (+1 per level, three levels: ×8 at most; one miss ends it, except in the 5 seconds after each press), checked and counted again on the server. Signal drains faster on a miss and refills slower on a hit. | Scores felt small and the run too forgiving; Overdrive (an idea in the last Next Steps) needed to matter. Five stackable levels (×10, renewable at the top, a miss costing 8 tiles) were then too easy to keep: three levels, ended by any miss. Gold tiles (one in eight, triple on a Perfect) were tried and dropped; a grace after each press was added, because a hand on the Overdrive key can't be back on the lanes at once. | Play-testing (Miles, Nov 17). |

### Did the model really stand alone?

Yes. `src/java/main/` imports nothing but the Java standard library: no view, no Spring.
`ModelDemo` runs it with plain `javac`/`java`, and the 72 model tests run without a server or a
browser. Every run goes through `Main` on the server (above), and the server does more with it: every song it keeps goes into the model first (`SongModel`: `SongWriter` writes
it as a `Song`, a `Queue<Note>` per `Difficulty`), and a mapped song or fan chart the model can't
take in is turned down. Scores go through it too: the game records each run, and before a best
score is kept the backend checks the run against that difficulty's `Queue<Note>` (no more tiles
judged than it has, no more holds ended, no hold held longer than its holds) and counts it again
through `GameScore` (`Score` with the game's combo multiplier and held-note bonus on top). The
browser judges each press at once with a TypeScript copy of `GameScore`'s rules
(`frontend/src/game/score.ts`), so the big score on screen never waits on the network.

### What happened to the unknowns from the scope

| Unknown | Status | What we found |
|---|---|---|
| Can an AI map a real song into a playable beatmap? | **Figured out** | Yes, by listening to it: the browser hears the song once, measures every note (an onset mapper plus the Beat This! beat tracker), and a trained model (Ensomi R2) places the tiles. Claude, given the measurements, was worse, slower and costly (change 1). |
| Where does the audio come from, legally? | **Figured out** | YouTube's embedded player plays the song; the game never downloads it. It listens once through tab sharing and keeps only the tiles and a loudness curve. |
| Will the tiles line up with the music? | **Figured out** | Tiles are timed to each sound within a few milliseconds; the Map Syncer corrects a song's offset after a run whose hits were steadily early or late. |
| JavaFX or the web for the view? | **Figured out** | The web (revised scope). |
| Can it run for others, not just on our machines? | **Mostly** | The backend runs on Render (Docker) and can keep its songs in Supabase, so they outlive restarts once `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set there ([docs/supabase.md](docs/supabase.md)). Finding songs by name needs a YouTube API key on the server ([docs/youtube-api.md](docs/youtube-api.md)). A sleeping free server is said to be waking wherever something waits on it, instead of failing. |
| How will the controller connect the view to the model? | **Figured out** | Through the server: each run is a `Main` on the song's `Song` (`PlayController`), fed the player's presses and the clock; the view shows its `Score`. Every song the server keeps is a model `Song` first, and every saved run is checked against its `Queue<Note>` and counted again through `GameScore`. |

### What doesn't work yet

- **`Main` reviews presses by its own rules.** Its windows are wider (0.1, 0.2, 0.3 s against the game's 45, 90, 140 ms) and it takes presses strictly in its queue's order (in a chord, pressing the second lane first is a miss), so its own `Score` isn't the game's. The score shown and saved is `GameScore`'s, which the model confirms from the judged run.
- **If the server can't be reached mid-run**, the run plays on and the panel says the controller isn't counting, and its score isn't kept (a best comes only from a run the controller reviewed; a server restart during a run loses it the same way).
- **Songs mapped on the deployed site don't last until Supabase is set up there**: the Render service's song file is reset when it restarts; with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` set the bank is kept in Supabase ([docs/supabase.md](docs/supabase.md)).
- **Searching YouTube by name on the deployed site** needs `YOUTUBE_API_KEY` set on Render ([docs/youtube-api.md](docs/youtube-api.md)); pasting a YouTube link works without it. Without the key, a pasted link is checked as a song by its title and channel only.
- **Practice and Overdrive run in the browser's copy of the rules** like the rest of play (Overdrive is checked again on the server; practice runs are never saved).
- **Mapping a new song needs desktop Chrome or Edge** (sharing a tab's sound); other browsers and phones get an osu! fan chart when one exists.
- **The first song mapped downloads the trained model** (about 120 MB, then cached); without WebGPU, charting a 3-minute song takes about 90 s instead of 20 s.
- **The menu starts on Medium**, not Easy as the spec's "no difficulty chosen" row says.
- **Songs mapped before Nov 19** are made again from their saved Ultra the first time they're opened (the server checks every tile was in it), so their Easy, Medium and Hard best scores reset; their holds can't be checked against the sound any more (it isn't saved), only capped.

## Next Steps

### What's left for the final build, in order

| # | Item | Owner | Classes and methods |
|---|---|---|---|
| 1 | Make `Main` count a run as the game does: match a press to the nearest note in its lane (so chords can be pressed in either order), the game's hit windows, and holds. | Darsh | `Main.processInput`, `Main.checkMissedNotes`; `MainTest` cases for chords and holds. |
| 2 | Review `PlayController`'s use of `Main` and the model changes since Deliverable 3. | Sarah | `PlayController`, `Song.getChartBetween`, `QueueTest`'s interleaved case, `PlayTests`. |
| 3 | Show the controller's count on the results next to the game's, with where they differ (once 1 is done they should agree). | Miles | `Results.tsx`, `controllerLink.ts`. |
| 4 | Keep songs on the deployed site: set `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `YOUTUBE_API_KEY` on Render. | Miles | `SongStore`, `SupabaseSongs` ([docs/supabase.md](docs/supabase.md)). |
| 5 | **Done.** The bank's older songs get the new difficulty ladder (made again from their Ultra when first opened). | Miles | `upgrade.ts` `rethinSong`, `SongController.rechart`. |
| 6 | Rehearse the demo below to time. | Everyone | |

### Stretch goals

| Committing to (done, or for the final build) | Dropping |
|---|---|
| The trained mapper (Ensomi R2) in the browser (done) | The Claude charter: worse charts, slow, costly (change 1) |
| Practice mode (done: the change feature) | Generating music: the game maps real songs, it never makes them |
| Overdrive, three levels to ×8 (done) | Gold tiles in Overdrive (tried, removed: they read as noise) |
| How to play, with moving diagrams (done) | JavaFX (revised scope) |
| Note speed set by the map, as in Beat Saber (done) | Listening on phones (browsers can't share a tab's sound there) |
| The music bank, favourites, search as you type (done) | Splitting songs into parts (Demucs) as the main path: a fallback only |
| `Main` counting like the game (item 1) | Multiplayer |

### The 3-minute demo

| Time | What we show | Who |
|---|---|---|
| 0:00-0:20 | The opening, then **Name a Song**: type *ink*, pick *Ink and Fury*, Medium. | Miles |
| 0:20-1:15 | Play it. Point at the run panel: the **Controller** line is `Main`'s `Score`, live, fed by every key press (view → controller → model). Set off Overdrive once. | Miles plays, Darsh explains the controller |
| 1:15-1:35 | The results: the game's score, and what the controller counted. | Darsh |
| 1:35-2:20 | **The change feature, Practice mode:** the start card's *Practice a part*, drag the start and end, 75%, play the loop. The Controller line now counts only the stretch's notes (`Song.getChartBetween`, through `Main`). | Miles plays, Sarah explains the model method |
| 2:20-2:50 | **Tests and bad input:** `./mvnw test "-Dtest=main.*Test,PlayTests"` (run before, shown green): normal and bad-input cases per method, interleaved queue order, and the controller turning down a lane of 7, a negative time and a backwards stretch without a crash. | Sarah |
| 2:50-3:00 | How to play and the music bank, in passing. | Miles |

## Attribution

Who worked on what, and how. "GenAI-assisted" means written with Claude Code (Anthropic's coding
assistant) at the named person's direction, then run and reviewed by them.

### The model (`src/java/main/`)

| Class | Who | How |
|---|---|---|
| `Node` | Sarah Schallon; Miles D'Antonio | Sarah wrote it; Miles fixed its constructors so it compiles and added Javadoc (GenAI-assisted). |
| `Queue` | Sarah Schallon; Miles D'Antonio | Sarah wrote the first draft and its fix (linked nodes, `enqueue`, `dequeue`, `clear`, `peek`); Miles made it compile (constructor, `isEmpty`, `clear`), added `getSize`, `enqueue(T)`, the empty-queue checks, the null-node rule and Javadoc (GenAI-assisted). |
| `Note` | Sarah Schallon; Miles D'Antonio | Sarah wrote it (fields, getters, setters, `equals`, `toString`); Miles made it compile (constructor, a setter's type, `equals`/`hashCode`) and added the spec's defaults for bad input, its `toString` and the hold flag (`isHold`) (GenAI-assisted). |
| `NoteType`, `MusicNoteType`, `Difficulty`, `HitResult` | Sarah Schallon | Wrote them (Miles put them in package `main`, public). |
| `Song` | Sarah Schallon; Miles D'Antonio | Sarah started it (fields, constructor, the method signatures); Miles implemented one chart per difficulty (`getChart`, `setChart`, `getAvailableDifficulties`), the spec's validation and `getChartBetween` for practice (GenAI-assisted). |
| `EmptyQueueException` | Miles D'Antonio | Wrote it (GenAI-assisted). |
| `SongWriter` | Miles D'Antonio | Wrote it (GenAI-assisted). |
| `ModelDemo` (driver) | Miles D'Antonio | Wrote it (GenAI-assisted). |
| `GameScore` | Miles D'Antonio | Wrote it (GenAI-assisted): `Score` with the game's ×10 points, combo multiplier (to ×5), held-note bonus, Overdrive (charge, three levels, to ×8, its grace) and stray presses on top, `Score`'s own rules unchanged. |
| `Score`, `Main` | Darsh Sharma | Wrote both classes (GenAI-assisted). Implemented Score to track points, hits, misses, combos, and accuracy using HitResult. Implemented Main to handle player inputs, judge note timing, remove notes from the queue, track missed notes, and return upcoming notes.. |

### The backend (`backend/`, Java, Spring Boot)

| Class | Who | How |
|---|---|---|
| `BackendApplication` | Miles D'Antonio | Set up the Spring Boot project (Spring Initializr), then built on it (GenAI-assisted). |
| `SongController`, `SongStore`, `SongLists`, `NewSongCheck`, `SongModel`, `RunReplay` | Miles D'Antonio | Wrote them (GenAI-assisted): songs (each one taken into the model through `SongWriter`), scores (each run checked against the chart's `Queue<Note>`, then counted again through `GameScore`), search, the music bank. |
| `SourceController`, `YouTubeService`, `FanChartService`, `Http` | Miles D'Antonio | Wrote them (GenAI-assisted): YouTube lookups (songs only) and osu! fan charts. |
| `PlayController` | Miles D'Antonio; Darsh Sharma | Miles wrote the routes (GenAI-assisted); they run Darsh's `Main` unchanged, one per run. |
| `SupabaseSongs`, `HealthController` | Miles D'Antonio | Wrote them (GenAI-assisted): the song bank in Supabase, and the health check (is the server up, where the bank is, and why the database isn't working if it isn't). |
| `Osu` | Miles D'Antonio | Ported the frontend's osu! reader to Java (GenAI-assisted). |
| `Matching`, `Text` | Miles D'Antonio | Wrote them (GenAI-assisted): matching names and videos. |
| `ApiException`, `ApiExceptionHandler`, `CorsConfig` | Miles D'Antonio | Wrote them (GenAI-assisted). |

### The view (`frontend/`, TypeScript)

| Part | Who | How |
|---|---|---|
| The whole game (screens, 3D stage, audio, game rules, mapping pipeline, mock server, tools) | Miles D'Antonio | Designed, directed and play-tested it; the code is GenAI-assisted (Claude Code). |
| The link to the controller (`src/game/controllerLink.ts`, the mock's `mock-server/play.ts`) | Miles D'Antonio; Darsh Sharma | Miles wrote them (GenAI-assisted); `play.ts` is the mock server's copy of Darsh's `Main` and `Score` rules. |

### Test files

| Test file | Who | How |
|---|---|---|
| `src/test/main/QueueTest.java` | Miles D'Antonio; Sarah Schallon | Miles wrote it (GenAI-assisted) from the test plan Sarah drafted in the spec; the interleaved enqueue/dequeue case added for Deliverable 4. |
| `src/test/main/NodeTest.java` | Miles D'Antonio; Sarah Schallon | Miles wrote it (GenAI-assisted) from Sarah's test plan. |
| `src/test/main/NoteTest.java` | Miles D'Antonio; Sarah Schallon | Same. |
| `src/test/main/SongTest.java` | Miles D'Antonio; Sarah Schallon | Same, with Practice mode's `getChartBetween`. |
| `src/test/main/SongWriterTest.java` | Miles D'Antonio; Sarah Schallon | Same, for the new SongWriter. |
| `src/test/main/ScoreTest.java` | Sarah Schallon | Hit values, misses and miss hit results, null hits, combo and max-combo, accuracy, high score and reset behavior (GenAI-assisted). |
| `src/test/main/MainTest.java` | Sarah Schallon | Controller construction, difficulty defaults, hit windows, invalid input, missed notes and upcoming-note preservation (GenAI-assisted). |
| `src/test/main/GameScoreTest.java` | Miles D'Antonio | `GameScore` on the same run the browser's test uses (GenAI-assisted). |
| `backend/src/test/.../ApiTests.java` | Miles D'Antonio | Every route against a fresh song bank (GenAI-assisted). |
| `backend/src/test/.../PlayTests.java` | Miles D'Antonio | Playing through the controller: a press reaching Darsh's `Main`, the clock missing notes, practice's stretch, bad input turned down, a score kept only from a reviewed run (once), and the limits on starting runs and sending inputs (GenAI-assisted). |
| `backend/src/test/.../MappingTests.java` | Miles D'Antonio | Name matching (near misses too), the song check and the osu! port (GenAI-assisted). |
| `backend/src/test/.../RechartTests.java` | Miles D'Antonio | Older songs' charts made again on the new difficulty ladder: kept only when every tile was in their Ultra (GenAI-assisted). |
| `backend/src/test/.../songs/RunReplayTests.java` | Miles D'Antonio | A recorded run checked against the chart and counted again through `GameScore`, Overdrive's grace included (GenAI-assisted). |
| `backend/src/test/.../SupabaseTests.java` | Miles D'Antonio | The song bank in Supabase, against a stand-in for its REST API (GenAI-assisted). |
| `backend/src/test/.../songs/InputReviewTests.java` | Miles D'Antonio | The controller's review of a run's inputs: malformed, out of order, past the end, double presses, faster than real time, too many presses, hits nobody pressed for (GenAI-assisted). |
| `backend/src/test/.../HeatTests.java` | Miles D'Antonio | Where players miss: each checked run's tiles counted per tile, tiles that don't fit ignored (GenAI-assisted). |
| `backend/src/test/.../FeelTests.java` | Miles D'Antonio | How a run felt: counted only from a run whose score was kept, once, answers it doesn't know refused (GenAI-assisted). |
| `backend/src/test/.../BackendApplicationTests.java` | Miles D'Antonio | The app starts (generated by Spring Initializr). |
| `frontend/tests/unit/engine.test.ts` | Miles D'Antonio | The game rules: judging, holds, combo, score, each tile's result in chart order (GenAI-assisted). |
| `frontend/tests/unit/review.test.ts` | Miles D'Antonio | The controller's review, the mock backend's copy of the server's (GenAI-assisted). |
| `frontend/tests/unit/leadline.test.ts` | Miles D'Antonio | Every difficulty as the song's own lines: the singing where it's sung, the drums where it isn't, every note of a piano solo on Ultra, the easier charts the same rhythm simplified, a returning phrase charted alike, lanes that mirror the tune, a piano chord as a chord on Ultra, every chart ending on a chord (GenAI-assisted). |
| `frontend/tests/unit/sections.test.ts` | Miles D'Antonio | The song's form: the choruses found as the music that comes back loudest, the intro and the bridge, more density in the chorus and the most in the last, a fade charted with nothing but a quiet outro that keeps its beat played to the end (GenAI-assisted). |
| `frontend/tests/unit/lag.test.ts` | Miles D'Antonio | A lagging video: how far ahead it has loaded and how fast, when to count back in, when to show the connection card, Continue waiting after three (GenAI-assisted). |
| `frontend/tests/unit/heat.test.ts` | Miles D'Antonio | Where players miss, the mock backend's copy of the server's rules (GenAI-assisted). |
| `frontend/tests/unit/feel.test.ts` | Miles D'Antonio | How a run felt, the mock backend's copy of the server's rules (GenAI-assisted). |
| `frontend/tests/unit/search.test.ts` | Miles D'Antonio | The song search's near misses ("once dance" finds One Dance), the same cases as the server's (GenAI-assisted). |
| `frontend/tests/unit/slow.test.ts` | Miles D'Antonio | Slow moments: what was set off when the frames fell (GenAI-assisted). |
| `frontend/tests/unit/notes.test.ts` | Miles D'Antonio | Basic Pitch hearing a melody note by note, at its pitch and length (GenAI-assisted). |
| `frontend/tests/unit/score.test.ts` | Miles D'Antonio | The score rules (`Score`'s, with the multiplier and holds), checked against `GameScore` (GenAI-assisted). |
| `frontend/tests/unit/automap.test.ts`, `automap-band.test.ts` | Miles D'Antonio | The onset mapper and its note-finding benchmark (GenAI-assisted). |
| `frontend/tests/unit/beats.test.ts` | Miles D'Antonio | The beat tracker's grid and inputs (GenAI-assisted). |
| `frontend/tests/unit/voice.test.ts` | Miles D'Antonio | The singing: syllables from the split vocal (bleed gated out), a tile on each one the chart lacks, sung rows kept by thinning (GenAI-assisted). |
| `frontend/tests/unit/trained.test.ts` | Miles D'Antonio | The trained mapper's charts: thinning, timing (GenAI-assisted). |
| `frontend/tests/unit/lanes.test.ts` | Miles D'Antonio | The lane flow: fewer quick repeats and leaps, no tile moved in time, held lanes and chords left alone, repeats in their twins' lanes, lanes with the tune (GenAI-assisted). |
| `frontend/tests/unit/beatmap.test.ts` | Miles D'Antonio | The beat map (a drifting tempo followed, triplets taken where the sounds follow them, no grid in scattered sounds, double- and half-time trackers) and repeated phrases (GenAI-assisted). |
| `frontend/tests/unit/upgrade.test.ts` | Miles D'Antonio | Older songs upgraded to four charts and to the new ladder, and the check the server makes (GenAI-assisted). |
| `frontend/tests/unit/sync.test.ts` | Miles D'Antonio | The Map Syncer's math (GenAI-assisted). |
| `frontend/tests/unit/youtube.test.ts` | Miles D'Antonio | The YouTube player's clock (GenAI-assisted). |
| `frontend/tests/unit/bank.test.ts` | Miles D'Antonio | The music bank's order and letters (GenAI-assisted). |
| `frontend/tests/unit/music.test.ts` | Miles D'Antonio | The menu music (GenAI-assisted). |
| `frontend/tests/unit/perf.test.ts`, `stage-thread.test.ts` | Miles D'Antonio | Performance profiles and the stage worker (GenAI-assisted). |
| `frontend/tests/e2e/app.spec.ts` | Miles D'Antonio | 23 browser tests: the whole game end to end, including the scope's bad input (GenAI-assisted). |

### GenAI note

We used GenAI in two ways. The specification was drafted from a GenAI-generated template that the
team filled in (see the spec's own note). Most of the code outside Sarah's model classes, and the
revisions to them listed above, were written with Claude Code (Anthropic's AI coding assistant)
at Miles's direction: Miles set the goals and the design, play-tested every change and decided what
stayed, and each change was checked with the tests above before it was kept. The game's features
also use AI at run time: a trained beatmap model (Ensomi R2) and a beat tracker (Beat This!) run in
the player's browser; Claude was used at run time (the Claude charter) until Nov 11, 2026, then
removed. Third-party models and code are credited in [NOTICE.md](NOTICE.md).
