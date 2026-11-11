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
| `npm run map` | Re-map the bundled test tracks with the onset mapper (`frontend/src/mapping/automap.ts`); add `-- --request` to also write sample AI-charter requests to `docs/samples/` |
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

- **`backend/`** (Java, Spring Boot): the real one. Its AI charter is `src/java/main/SongMapper.java`, which calls Claude. Run it with
  `./mvnw spring-boot:run` from `backend/` and set `VITE_API_BASE_URL=http://localhost:8080` in
  `frontend/.env.local`; see [backend/README.md](backend/README.md).
- **`frontend/mock-server/`**: runs inside the Vite server when `VITE_API_BASE_URL` is empty and
  keeps its songs in `frontend/.data/songs.json`. Its charter answers by fixed rules.

The mock never makes up a song. Search pulls up songs that are already mapped. **Generate
beatmap** maps a new one, and it plays from YouTube:

1. **Find the video.** Paste the song's YouTube link into Title, or type title and artist (searching
   YouTube by name needs a free YouTube Data API key: `YOUTUBE_API_KEY` in `frontend/.env.local`, see
   `frontend/.env.example`). The video shows in YouTube's own embedded player. Its audio is never downloaded.
2. **Listen once.** Press *Listen and map* and share this tab with its audio. The song plays once
   while the browser records what it hears (filed by the video's position; a short tick first
   measures the capture delay), then the onset mapper (`automap.ts`, in a worker) measures the beat
   and every sound, and the recording is dropped. The measurements (no audio) go to the backend's
   **AI charter** (`POST /api/chart`, Claude: [docs/claude-backend.txt](docs/claude-backend.txt)),
   which picks which sounds each difficulty plays and where; the browser checks its plan and builds
   the charts (`frontend/src/mapping/charter.ts`), or uses the on-device charts if the charter can't answer.
   The mock answers with the on-device rules (`MOCK_CHARTER=off` makes it act like a backend
   without one). Only the tiles and a loudness curve for the visuals are kept. The
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
chords on Hard. For songs mapped by listening, the AI charter on the backend then picks which of
those sounds each difficulty plays (it can only name measured sounds, so it can't add or move one);
without it, `frontend/src/mapping/charts.ts` picks them by how much they stand out, never at random and never
adding a note that isn't there.

Before that, two models run in the browser on what was heard (the mapping worker,
`frontend/src/mapping/listen.worker.ts`; the audio still never leaves the page):

- **The beat** (`beats.ts`): the Beat This! tracker (10 MB, `frontend/public/models/`) finds the beats and
  downbeats; its grid sets the tempo, beat 0 and the meter (3 or 4) when at least half its beats fit
  it, else the onset mapper's own estimate is used. On 14 Creative Commons tracks with known tempos it
  got 12 right (the other two at double time) against 8 for the mapper's own estimate, which kept
  reading fast songs at 2/3 of their tempo.
- **The parts** (`stems.ts`): with WebGPU, Demucs splits the song into drums, bass, vocals and other,
  and the onset mapper finds each part's sounds on its own (pitch from the part, drums never pitched).
  Its model (about 172 MB) downloads from Hugging Face while the song is listened to and stays in the
  browser's cache. Without WebGPU the song is mapped from the whole mix, as before.

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
    mapping/            the Generate pipeline: listening, the onset mapper, charts, the AI charter's
                        rules, osu! fan charts, loudness and visual cues
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
src/java/main/          the game's Java classes: SongMapper (Claude, the AI charter), Song, Note, Queue
docs/                   the backend contract (api.md, claude-backend.txt), resources, media
```
