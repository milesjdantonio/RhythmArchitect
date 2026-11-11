# Rythm Architect

**Name any song. Our AI maps it. You play it.**

Type a song's title and artist, for example *Mr. Brightside* by *The Killers*. Rythm Architect
searches every song its AI has already mapped; if yours isn't there, generate its beatmap. The AI
finds the track, finds every note in it, and builds a beatmap on four lanes with three
difficulties. Every tile is a note in the song, at the moment you hear it:

- **Easy**: the notes that stand out most, spaced out.
- **Medium**: more of them, with holds where a sound rings.
- **Hard**: every note, chords on the biggest hits, taps under held notes.

Then you play it in a world of light that moves with the music, in the spirit of Tetris Effect.
The AI doesn't make music. It maps the music you already love.

**See it play:** `npm run video` records real gameplay to `docs/media/gameplay.webm` (no sound;
the recordings are made locally and kept out of the repo). It shows the intro, searching for a
song, a bot playing *Ink and Fury* on Hard with real audio and the dev tools open, *One Dance*
from YouTube (its video in its spot under the stage, then in the game's corner), and the
hand-mapped test song played badly enough to show misses and the results.

## Project 3: First prototype (Deliverable 3)

CS 2114, Project 3. This README covers how to [run the model](#run-the-model-no-view) and
[the view](#run-the-view), then the [Reflection](#reflection), the [Next Steps](#next-steps) and the
[Attribution and GenAI note](#attribution). The design follows the team's Project 3
specification: a Model (the queue-backed classes in `src/java/main/`), a View (the HTML/CSS/JavaScript
game in `frontend/`) and a Controller (`Main`, Darsh's part, still to come).

### Run the model (no view)

The model is plain Java with no libraries: `Node` and `Queue` (first in, first out), `Note`, the enums,
`Song` (one `Queue<Note>` per difficulty) and `SongWriter` (builds a `Song` from a chart). It knows
nothing about the view or the server.

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

**The tests.** JUnit 5 tests for every model class (`src/java/test/main/`: `QueueTest`, `NodeTest`,
`NoteTest`, `SongTest`, `SongWriterTest`, 39 tests from the spec's test plan, good and bad cases)
run with the backend's tests through Maven (Java 25):

```bash
cd backend
./mvnw test                      # every test (Windows: mvnw.cmd test)
./mvnw test -Dtest=QueueTest     # one class
```

`node tools/export-charts.mjs` (from `frontend/`) writes the chart files again after the built-in
songs change.

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
song, type one that isn't there and press **Generate beatmap** (desktop Chrome or Edge: the game
listens to the song's YouTube video once through tab sharing). With the Java backend instead of
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
  every mapped song is searched as you type, and the **Generate beatmap** button sits at the bottom
  of the results. Under it, **Favorites**: a drop-down of your starred songs with its own search,
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
- **The game.** Four lanes on D F J K (or arrows / 1–4 / touch). Perfect/great/good windows, holds,
  combo multiplier up to ×4 with **fever**, health and no-fail, pause, early/late feedback (under
  the hit line, never over the tiles). One **run panel** down the left holds the score, accuracy,
  multiplier, combo, signal and live Perfect/Great/Good/Miss counts, headed by a YouTube song's
  video; where you hit stays in the centre of the screen. Every 25 in a row (and fever) is
  **called out on the right**: the number slams in and counts up, a streak cuts across, rings and
  shards burst, every hundred in gold. Big moments burst from the sides of the track and tiles draw
  over every effect, so the notes stay readable. Hitting a tile makes no sound: the song is the
  sound (synth songs play every note of the map themselves).
- **Results.** Grade and score; accuracy and max combo, then Perfect, Great, Good and Miss; *Play
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
- **`frontend/mock-server/`**: runs inside the Vite server when `VITE_API_BASE_URL` is empty and
  keeps its songs in `frontend/.data/songs.json`.

The mock never makes up a song. Search pulls up songs that are already mapped. **Generate
beatmap** maps a new one, and it plays from YouTube:

1. **Find the video.** Paste the song's YouTube link into Title, or type title and artist (searching
   YouTube by name needs a free YouTube Data API key: `YOUTUBE_API_KEY` in `frontend/.env.local`, see
   `frontend/.env.example`). The video shows in YouTube's own embedded player. Its audio is never downloaded.
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
   bursts, and the Easy, Medium and Hard tile counts count up. If sharing is turned down or stops part-way, the dialog says so and offers to try again.
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
chords on Hard. For songs mapped by listening, a trained mapper places the tiles (below); if it
can't, `frontend/src/mapping/charts.ts` picks them from the measured sounds by how much they stand
out, never at random and never adding a note that isn't there.

Before that, two models run in the browser on what was heard (the mapping worker,
`frontend/src/mapping/listen.worker.ts`; the audio still never leaves the page):

- **The beat** (`beats.ts`): the Beat This! tracker (10 MB, `frontend/public/models/`) finds the beats and
  downbeats; its grid sets the tempo, beat 0 and the meter (3 or 4) whenever its beat is steady beat
  to beat for at least 40% of the song, even when it drifts off one straight grid (a long song, or the
  capture slipping); the onset mapper's own estimate is only the fallback for when it finds no steady
  beat (it reads fast songs at 2/3 of their tempo). On 14 Creative Commons tracks with known tempos
  (full length) it gets 11 right (two very slow songs at double time, one at 1.5 times) against 8 for
  the onset estimate; the same 14 sped up to 200 BPM, over 6 minutes, through a simulated listen
  (a coarse YouTube clock, page stalls): 12 right (one at half time, one wrong). (An earlier rule,
  half the beats on one straight grid, threw away right tempos: a 200 BPM song was kept at 121.)
- **The tiles** (`ensomi.ts`): Ensomi R2, a model trained on human-made osu!mania 4K charts, charts
  the song from the audio (about 20 s on WebGPU for a 3-minute song, about 90 s without). Its model
  (about 120 MB) downloads from Hugging Face while the song is listened to and stays in the
  browser's cache. Its lowest star rating is already about this game's Hard, so it charts once and
  every difficulty keeps a subset of its tiles (`thin.ts`): the strongest sounds, spaced out, each
  stretch of the song keeping its share (Easy about 1 tile a second, Medium about 2, Hard about 5).
  Its tiles come about 29 ms early (measured on a groove with known hit times), so they move onto
  the sounds the onset mapper measured.
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
                        trained mapper, charts, osu! fan charts, loudness and visual cues
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
src/java/test/main/     the model's JUnit tests (run with ./mvnw test in backend/)
src/java/charts/        the built-in songs' charts, for the model (frontend/tools/export-charts.mjs)
docs/                   the backend contract (api.md), resources, media
```

## Reflection

### What changed from the spec

Each change says what the spec said, what we built, why, and what prompted it.

| # | Area | The spec said | We built | Why | Prompted by |
|---|---|---|---|---|---|
| 1 | **SongWriter** (class, signature) | `SongWriter.generateSong(String title, String artist)` asks the Claude API to map the song into Easy, Medium and Hard. | `SongWriter.writeSong(String chart)` / `readSong(Path file)` build a `Song` (one `Queue<Note>` per difficulty) from a chart the app made; `SongWriter.chartFor(Song, Difficulty)` picks the chart to play. The charts come from a trained beatmap model (Ensomi R2, trained on human osu!mania charts) that listens to the song in the browser. | We built the Claude version first (`SongMapper.java` behind `POST /api/chart`, Nov 7-10). It worked, but its charts felt off the music and awkward, a song took minutes (calls timed out), and each song cost about $1-3. The trained mapper charts a 3-minute song in about 20 s, for free, and its tiles land on the beat. Claude was removed on Nov 11. | Play-testing the Claude charts (Miles, Nov 10), its timeouts and its token cost. |
| 2 | **Queue** (signatures) | `enqueue(Node)`; a null node returns without adding. | `enqueue(Node<T>)` ignores a null node as specified, and `enqueue(T)` wraps data in a node (what callers use). | Building a chart is simpler with data than with nodes. | Writing `SongWriter`. |
| 3 | **Queue** (validation) | `dequeue` and `peek` on an empty queue: the method table says "return null", the test plan says "NullPointerException". | Both throw `EmptyQueueException` (unchecked, "The queue is empty"). | The spec contradicted itself; `null` can't be told apart from a note that is null (the queue allows null data); a named exception says what went wrong. | Writing `QueueTest` from the test plan. |
| 4 | **NoteType** (class) | The Data section lists `NORMAL`, `HOLD`, `SLIDE`; the method table's default is `A`. | `NoteType` is the note's letter, `A` to `G` (its pitch, which synth-played songs use); a hold is a note whose `noteLength` is long; there are no slides. | Lanes and holds already say how a note is played; the letter was needed for playing synth songs. | The two halves of the spec disagreeing; the game's charts carrying a pitch per tile. |
| 5 | **Note** (validation) | Null type: default `A`; length of zero or less: default 1; `toString()` is "NoteType, noteLength". | As specified (also a null `MusicNoteType` becomes `NORMAL`; `NaN` lengths become 1). Notes also keep `timeStamp` (seconds) and `lane` (0-3), from the Data section. | | `NoteTest` from the test plan. |
| 6 | **Song** (validation) | Reject a null or empty title or artist and a non-positive duration or BPM; `getChart` returns null when there's no chart; `setChart` rejects nulls. | As specified (`IllegalArgumentException` with a message; `getChart(null)` is null). | | `SongTest` from the test plan. |
| 7 | **Model/View boundary** | The view knows only the next few notes, never the whole queue at once. | The view loads a song's whole chart once (a few KB), because it draws tiles all the way down a 3D track and runs offline from the server; but each frame it now only looks at the notes near the hit line. | Drawing far-away tiles needs their times; asking a server for every frame's notes would add network delay to every hit. | Miles asking whether the game "loads the entire queue" while chasing a slowdown (Nov 11): the per-frame work was cut to a window. |
| 8 | **Controller** | `Main` (Spring Boot) relays input and score between the view and the model. | Not built yet (Darsh's part). The Spring Boot backend serves the songs, search, YouTube lookups and fan charts; judging hits and scoring run in the browser for now (`frontend/src/game/engine.ts`). | The view had to be playable before the controller existed. | Division of work and the schedule. |
| 9 | **Validation: key at the wrong time** | Penalize the score. | A press with no tile within reach is ignored; a tile that isn't hit becomes a miss (it breaks the combo and costs signal). | Penalizing stray presses punishes players for tapping along to the beat; missing the tile already costs points. | Play-testing. |
| 10 | **Validation: no difficulty chosen** | Default to Easy. | `SongWriter.chartFor(song, null)` gives Easy. In the game a difficulty is always chosen: the menu starts on Medium, and a link with no or an unknown difficulty goes back to the menu. | | The e2e bad-input test. |
| 11 | **Validation: AI fails or returns bad data** | `SongWriter` throws; the view says "Couldn't create song". | If the trained mapper fails (no model download, bad output), the song still gets charts from the on-device onset mapper, and the dev tools say why. A bad chart file makes `SongWriter` throw an `IllegalArgumentException` that names the problem. | Better a playable map than an error. | The e2e test "when the trained mapper fails". |
| 12 | **Tests** | Tests for Node, Queue, Note, Song, SongWriter, Score and Main. | 39 JUnit tests for Node, Queue, Note, Song and SongWriter (`src/java/test/main/`, good and bad cases from the plan); 10 backend tests; 80 frontend unit tests; 22 browser tests. Score and Main have none yet (not written). | | The test plan. |
| 13 | **Scope** | JavaFX, then HTML/CSS (revised scope). | HTML, CSS and TypeScript (React, three.js for the 3D stage, Tone.js for sound), songs played through YouTube's embedded player. | We know the web better, and YouTube lets any song play without downloading its audio. | The revised scope and the GTA conversation. |

### Did the model really stand alone?

Yes. `src/java/main/` imports nothing but the Java standard library: no view, no Spring, no
controller. `ModelDemo` runs it with plain `javac`/`java`, and the 39 model tests run without a
server or a browser. The honest caveat: because the controller isn't written yet, the browser
game doesn't play from the Java model today. It has its own copy of the rules in TypeScript.
Connecting them is the first of the Next Steps.

### What happened to the unknowns from the scope

| Unknown | Status | What we found |
|---|---|---|
| Can an AI map a real song into a playable beatmap? | **Figured out** | Yes, by listening to it: the browser hears the song once, measures every note (an onset mapper plus the Beat This! beat tracker), and a trained model (Ensomi R2) places the tiles. Claude, given the measurements, was worse, slower and costly (change 1). |
| Where does the audio come from, legally? | **Figured out** | YouTube's embedded player plays the song; the game never downloads it. It listens once through tab sharing and keeps only the tiles and a loudness curve. |
| Will the tiles line up with the music? | **Figured out** | Tiles are timed to each sound within a few milliseconds; the Map Syncer corrects a song's offset after a run whose hits were steadily early or late. |
| JavaFX or the web for the view? | **Figured out** | The web (revised scope). |
| Can it run for others, not just on our machines? | **Mostly** | The backend runs on Render (Docker). Songs saved there are lost when the service restarts (its disk isn't persistent yet), and finding songs by name needs a YouTube API key on the server. |
| How will the controller connect the view to the model? | **Still open** | Waiting on `Main` (and `Score`). |

### What doesn't work yet

- **`Score` and `Main` aren't written**, so the Java model isn't connected to the game; `HitResult` is unused in Java.
- **Songs mapped on the deployed site don't last**: the Render service's song file is reset when it restarts.
- **Searching YouTube by name on the deployed site** needs `YOUTUBE_API_KEY` set on Render; pasting a YouTube link works without it.
- **Mapping a new song needs desktop Chrome or Edge** (sharing a tab's sound); other browsers and phones get an osu! fan chart when one exists.
- **The first song mapped downloads the trained model** (about 120 MB, then cached); without WebGPU, charting a 3-minute song takes about 90 s instead of 20 s.
- **The menu starts on Medium**, not Easy as the spec's "no difficulty chosen" row says.

## Next Steps

### To finish the MVP, in order

| # | Item | Owner | Classes and methods |
|---|---|---|---|
| 1 | Write `Score`. | Darsh | `Score()`, `addHit(HitResult)`, `addMiss()`, `getScore()`, `getCombo()`, `getMaxCombo()`, `getHits()`, `getMisses()`, `getAccuracy()`, `reset()`; uses `HitResult`. |
| 2 | Write `Main`, the controller. | Darsh | `processInput(int lane, double currentTime)` (peeks the chart's queue, judges the hit, `dequeue()`s the note, calls `Score.addHit`), `checkMissedNotes(double currentTime)` (`peek()`/`dequeue()` past the miss window, `Score.addMiss`), `getUpcomingNotes(int count)`; gets its chart with `SongWriter.chartFor(song, difficulty)`. |
| 3 | Expose the controller to the view. | Darsh, Miles | Spring Boot routes for `Main` (for example a play session: start, input, upcoming notes, score) and a client in `frontend/src/api/client.ts`. |
| 4 | Play through the controller. | Miles | `frontend/src/screens/Play.tsx` asks `Main` for upcoming notes and sends key presses; `frontend/src/game/engine.ts` stays as the offline fallback. |
| 5 | Tests for `Score` and `Main`, then beta testing. | Haniya | `ScoreTest`, `MainTest` from the test plan; an end-to-end test that plays through the controller. |
| 6 | Keep songs on the deployed site. | Miles | `backend/.../songs/SongStore.java` on a persistent disk or a database; `YOUTUBE_API_KEY` on Render. |
| 7 | Review the model changes in this deliverable. | Sarah | `Queue`, `Note`, `Song` (changes 2-6 above) and the new `SongWriter`. |

### A change feature not in the MVP: Practice mode

Pick a section of a song (a verse, the drop) and play it on a loop, optionally slowed down, until
you get it right. Nothing in the MVP plays part of a song or changes its speed.

| Will change | How (prediction) |
|---|---|
| `Song` | A new `getChartBetween(Difficulty difficulty, double from, double to)` that builds a new `Queue<Note>` with only the notes in that stretch (the queue can't seek, and dequeuing uses it up). |
| `Main` | `processInput(int lane, double currentTime)` and `checkMissedNotes(double currentTime)` take song time scaled by the practice speed; a new `startPractice(double from, double to, double speed)`. |
| `Score` | Practice runs are not saved: `reset()` at each loop, plus an `isPractice()` flag. |
| View | `frontend/src/audio/playback.ts` (playback rate, looping a stretch), `frontend/src/screens/Play.tsx` (choosing the section), `frontend/src/game/engine.ts` (the offline fallback, same rules). |

| Should not change | Why |
|---|---|
| `Queue`, `Node` | A practice chart is just another queue. |
| `Note`, `NoteType`, `MusicNoteType`, `Difficulty`, `HitResult` | Notes keep their real times; only the clock is scaled. |
| `SongWriter` | Charts are made the same way; practice picks part of one. |
| The mappers (`frontend/src/mapping/`) | Practice plays existing charts. |

### Stretch goals

| Committed (done or in progress) | Dropped |
|---|---|
| The trained mapper (Ensomi R2) in the browser (done) | The Claude charter: worse charts, slow, costly (change 1) |
| The music bank, favourites, search as you type (done) | Generating music: the game maps real songs, it never makes them |
| osu! fan charts for browsers that can't listen (done) | JavaFX (revised scope) |
| The 3D stage with effects that follow the music, on WebGPU or WebGL (done) | Listening on phones (browsers can't share a tab's sound there) |
| Recovering when the graphics chip is lost (done) | Splitting songs into parts (Demucs) as the main path: kept only as a fallback (slow) |
| Practice mode (next, above) | Multiplayer |

### New tests needed

- `ScoreTest`: every row of the test plan for `Score` (start at zero, `addHit` updates score and combo, a null hit is ignored, `addMiss` resets the combo, `getAccuracy` is 0 before any note, `reset`).
- `MainTest`: `processInput` (a hit in the window gives the right `HitResult`; a bad lane or negative time is rejected), `checkMissedNotes` (a note past its window is a miss; none past it changes nothing), `getUpcomingNotes` (a count of zero or less is empty).
- An integration test (Spring MockMvc): a play session through the controller's routes.
- A browser test that plays a song through the controller.
- For practice mode: `Song.getChartBetween` (the stretch's notes only, in order; an empty stretch; `from` after `to`).

## Attribution

Who worked on what, and how. "GenAI-assisted" means written with Claude Code (Anthropic's coding
assistant) at the named person's direction, then run and reviewed by them.

### The model (`src/java/main/`)

| Class | Who | How |
|---|---|---|
| `Node` | Sarah Schallon; Miles D'Antonio | Sarah wrote it; Miles fixed its constructors so it compiles and added Javadoc (GenAI-assisted). |
| `Queue` | Sarah Schallon; Miles D'Antonio | Sarah wrote the first draft and its fix (linked nodes, `enqueue`, `dequeue`, `clear`, `peek`); Miles made it compile (constructor, `isEmpty`, `clear`), added `getSize`, `enqueue(T)`, the empty-queue checks, the null-node rule and Javadoc (GenAI-assisted). |
| `Note` | Sarah Schallon; Miles D'Antonio | Sarah wrote it (fields, getters, setters, `equals`, `toString`); Miles made it compile (constructor, a setter's type, `equals`/`hashCode`) and added the spec's defaults for bad input and its `toString` (GenAI-assisted). |
| `NoteType`, `MusicNoteType`, `Difficulty`, `HitResult` | Sarah Schallon | Wrote them (Miles put them in package `main`, public). |
| `Song` | Sarah Schallon; Miles D'Antonio | Sarah started it (fields, constructor, the method signatures); Miles implemented one chart per difficulty (`getChart`, `setChart`, `getAvailableDifficulties`) and the spec's validation (GenAI-assisted). |
| `EmptyQueueException` | Miles D'Antonio | Wrote it (GenAI-assisted). |
| `SongWriter` | Miles D'Antonio | Wrote it (GenAI-assisted). |
| `ModelDemo` (driver) | Miles D'Antonio | Wrote it (GenAI-assisted). |
| `Score`, `Main` | Darsh Sharma | To be written (Next Steps 1-2). |

### The backend (`backend/`, Java, Spring Boot)

| Class | Who | How |
|---|---|---|
| `BackendApplication` | Miles D'Antonio | Set up the Spring Boot project (Spring Initializr), then built on it (GenAI-assisted). |
| `SongController`, `SongStore`, `SongLists`, `NewSongCheck` | Miles D'Antonio | Wrote them (GenAI-assisted): songs, scores, search, the music bank. |
| `SourceController`, `YouTubeService`, `FanChartService`, `Http` | Miles D'Antonio | Wrote them (GenAI-assisted): YouTube lookups and osu! fan charts. |
| `Osu` | Miles D'Antonio | Ported the frontend's osu! reader to Java (GenAI-assisted). |
| `Matching`, `Text` | Miles D'Antonio | Wrote them (GenAI-assisted): matching names and videos. |
| `ApiException`, `ApiExceptionHandler`, `CorsConfig` | Miles D'Antonio | Wrote them (GenAI-assisted). |

### The view (`frontend/`, TypeScript)

| Part | Who | How |
|---|---|---|
| The whole game (screens, 3D stage, audio, game rules, mapping pipeline, mock server, tools) | Miles D'Antonio | Designed, directed and play-tested it; the code is GenAI-assisted (Claude Code). |

### Test files

| Test file | Who | How |
|---|---|---|
| `src/java/test/main/QueueTest.java` | Miles D'Antonio; Haniya Naseer | Written from the spec's test plan (drafted by Sarah, completed by Haniya) (GenAI-assisted); Haniya to review. |
| `src/java/test/main/NodeTest.java` | Miles D'Antonio; Haniya Naseer | Same. |
| `src/java/test/main/NoteTest.java` | Miles D'Antonio; Haniya Naseer | Same. |
| `src/java/test/main/SongTest.java` | Miles D'Antonio; Haniya Naseer | Same. |
| `src/java/test/main/SongWriterTest.java` | Miles D'Antonio; Haniya Naseer | Same, for the new SongWriter. |
| `backend/src/test/.../ApiTests.java` | Miles D'Antonio | Every route against a fresh song bank (GenAI-assisted). |
| `backend/src/test/.../MappingTests.java` | Miles D'Antonio | Name matching and the osu! port (GenAI-assisted). |
| `backend/src/test/.../BackendApplicationTests.java` | Miles D'Antonio | The app starts (generated by Spring Initializr). |
| `frontend/tests/unit/engine.test.ts` | Miles D'Antonio | The game rules: judging, holds, combo, score (GenAI-assisted). |
| `frontend/tests/unit/automap.test.ts`, `automap-band.test.ts` | Miles D'Antonio | The onset mapper and its note-finding benchmark (GenAI-assisted). |
| `frontend/tests/unit/beats.test.ts` | Miles D'Antonio | The beat tracker's grid and inputs (GenAI-assisted). |
| `frontend/tests/unit/trained.test.ts` | Miles D'Antonio | The trained mapper's charts: thinning, timing (GenAI-assisted). |
| `frontend/tests/unit/sync.test.ts` | Miles D'Antonio | The Map Syncer's math (GenAI-assisted). |
| `frontend/tests/unit/youtube.test.ts` | Miles D'Antonio | The YouTube player's clock (GenAI-assisted). |
| `frontend/tests/unit/bank.test.ts` | Miles D'Antonio | The music bank's order and letters (GenAI-assisted). |
| `frontend/tests/unit/music.test.ts` | Miles D'Antonio | The menu music (GenAI-assisted). |
| `frontend/tests/unit/perf.test.ts`, `stage-thread.test.ts` | Miles D'Antonio | Performance profiles and the stage worker (GenAI-assisted). |
| `frontend/tests/e2e/app.spec.ts` | Miles D'Antonio | 22 browser tests: the whole game end to end, including the scope's bad input (GenAI-assisted). |

### GenAI note

We used GenAI in two ways. The specification was drafted from a GenAI-generated template that the
team filled in (see the spec's own note). Most of the code outside Sarah's model classes, and the
revisions to them listed above, were written with Claude Code (Anthropic's AI coding assistant)
at Miles's direction: Miles set the goals and the design, play-tested every change and decided what
stayed, and each change was checked with the tests above before it was kept. The game's features
also use AI at run time: a trained beatmap model (Ensomi R2) and a beat tracker (Beat This!) run in
the player's browser; Claude was used at run time (the Claude charter) until Nov 11, 2026, then
removed. Third-party models and code are credited in [NOTICE.md](NOTICE.md).
