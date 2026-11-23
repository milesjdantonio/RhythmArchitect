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
  lanes, leadline, sections (the song's form), osu), `src/library/` (song cache, search, bank),
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
  controller into the model"). Every input is reviewed before Main sees it (`InputReview`; the
  mock's copy `mock-server/review.ts`, the same rules and cases: `InputReviewTests`,
  `review.test.ts`): malformed, out of order, past the end and double presses never reach Main; a
  run faster than real time, with more presses than hands make, or claiming hits nobody pressed for
  is flagged. A best is kept only from a run the controller reviewed and passed, once (the scores
  route's `play` run id, `PlayController.keep`: 422/409 otherwise), so the game waits for the
  controller to have the whole run before it sends the score; the backend also limits run starts
  per client and calls per run (429). Backend tests send scores through `Reviewed.play`. The
  browser still judges each press at once. Songs the trained
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
  (`src/library/videos.ts`), and each search is kept (quota: about 1% of a day's per search). A
  song already mapped still gets its YouTube results, headed "Other versions on YouTube", but the
  server leaves out every video already in the bank (the user, Nov 20: another song of the same
  name must still be mappable). The search takes near misses (`src/library/near.ts`, backend
  `Text.searchMatch`, the same cases: a slip of one letter a word, two from 7 letters, or the
  spaces: "once dance" finds One Dance). Then the **Favorites** drop-down with its own search.
- The **music bank** is its own screen (`src/screens/MusicBank.tsx`, `#/bank`, `GET /api/library`):
  every song A to Z with a search and a letter rail, opened by the Bank button (♫ icon) under the
  settings gear (beside the gear: **How to play**, `src/components/HowToPlay.tsx`, a dialog of
  topics with moving diagrams, also opened from the start card; its numbers come from the rules). The menu's song keeps playing there; a pick plays right there (the bank stays
  open, its "Now playing" card holds a YouTube song's video, and a Play button under it does what
  the Menu button does: back to the menu with that song on stage, its preview carrying on; the user,
  Nov 20). Esc goes back to the menu with the
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
  out of 100, ~34 Perfects; it empties when Overdrive ends; Space adds +1 per level for up to 60 tiles (`OVERDRIVE_LENGTH`; 48 before Nov 22, the user: "a little more time, to ease up on how hard it is to get a second overdrive": with the drain a level had room for ~30 tiles at Medium's rate, 33 at Hard's, under the 34 Perfects the next one needs), draining
  as the song plays too (`OVERDRIVE_DRAIN`, 1.5 tiles' worth a second; the user, Nov 20: "make overdrive also
  passively drop"; the clock is the chart's, the k-th tile judged at the k-th tile's time, to the ms, so
  RunReplay, which has no clock of the run, counts the same; the bar drops between tiles), up to three
  levels: ×8; not at the top; any miss ends it, except in its grace: `OVERDRIVE_GRACE`, 3 song
  seconds after each press (5 before Nov 22), timed by engine.ts) and stray presses (a key with no tile: signal and
  charge drain, no points). **The grade is the score against the chart's best** (Nov 22, the user: "the letter
  scores should be based on the number score rather than accuracy"): `parScore` (score.ts) and
  `GameScore.parScore` (the same chart, the same number: a perfect run, Overdrive set off as soon as
  it's charged), `gradeFor` S 85% / A 65% / B 45% / C 25% of it (`GRADE_SHARES`), D below, F a
  failed run; the results show the share. The server grades the replayed score so (SongController).
  All of it: `main.GameScore` (Score.java itself is Darsh's: add on top, don't edit
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
- Dev tools live on the game screen (` key): autoplay (Off or On, playing perfectly: the user, Nov 20;
  it spends Overdrive when charged), the note queue, clock, judgements, Overdrive, tuning, effects
  (Overdrive steps through the levels' looks; od ready, od fading), **slow moments** (`game/slow.ts`:
  when the frames fell in a run, what was set off in the second before, and a log to download; the
  user saw 100 fps fall to 24 "maybe when a certain animation plays": ask for that log, don't
  guess), map data. Keep them working when gameplay changes. Every profile uses the lite UI
  effects (`uiFx`: transform and opacity only; the full ones' blur and letter-spacing cost the stage frames).

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
    and aren't on a sound we measured either.
  - **Anticipations** (`thin.ts` `ANTICIPATION`): a strong sound a 16th or 8th before a beat whose
    sound is no stronger weighs more than that beat when thinning: the beat's grid bonus made easier
    charts march on the beat under syncopated songs (One Dance's Easy 9% off 16ths, Medium 8%, the
    fan chart 34%; now 19% and 15%). CC benchmark unchanged (F1 63%), Easy 66% → 58% on the beat
    (humans 44%); band strong notes E 80% → 76% (its strong notes are on the beat).
  - **The song's shape** (`src/mapping/shape.ts`, Nov 21: "make the mapper feel human"): for the
    charts that don't come from the lead line (thin.ts: the trained mapper's, thinned; charts.ts:
    the onset mapper's fallback). The lead line goes by the song's form instead (sections.ts,
    below), so the two never stack. Each 2-bar phrase's sounds a second against the song's median
    phrase (smoothed with its neighbours) times its loudness against the median (the onset
    mapper's `barEnergy`, passed with the sounds; multiplied and square-rooted) give it a scale,
    `rel^0.4` within 0.75-1.25 (`SHAPE`), that Easy, Medium and Hard multiply their budget by
    (thin.ts `intensity` per window, charts.ts each note's keep share; Ultra never). A phrase
    `DROP_JUMP` (1.45) times as busy as the two before it, or `DROP_LOUD` (1.3) times as loud, is a
    drop, landing on the bar whose loudness jumps most (`dropSecs`): the phrase before builds
    (`BUILD`, at least 1.1), Easy leaves a breath before it (`BREATH`: half a beat, Easy only
    since Nov 21: E 1, M ¾, H ½ before read as pauses; a sung syllable there stays; a hold ringing into it ends where it starts, `cutHolds`),
    and its first beat keeps a tile (thin.ts `drop`, charts.ts `DROP_LIFT`; a chord on Medium and
    up where the row is one). A busy repeat builds on its pattern (`growth`: +10% from its second
    time, at most +25%, `GROW_MAX` its last time in the song), and isn't held to what its twin left
    out; repeats are found on the straight grid when there's no beat map (`straightMap`, ensomi.ts:
    for telling phrases apart only). No 4 s window passes `PEAK` (1.5) times its difficulty's rate
    (`maxRate`). **Shared with the lead line** (its section intensity as the scale, the lean taken
    at most `SHAPE.hi`): in a busy part the easier charts' tiles may come closer (`spacing`:
    `minGap` divided by the scale; the user, Nov 21: "Easy can be made harder"; else Easy's spacing,
    not its budget, held a chorus back), Medium plays taps under a hold there (`HOLDS_FREE`, 1.05; the lead line's Medium everywhere since round 18),
    and every stretch keeps at least `STRETCH_FLOOR` tiles a second where it plays (E 0.5, M 0.8,
    H 1.1: thin.ts per 4 s window, the lead line per phrase), so a calm verse and the star
    calibration together can't empty it; the lead line's own breath before a drop cuts a hold
    ringing into it too. **Figures** (`lanes.ts` `figuresOf`, in lane flow, so not the lead line,
    which places its own lanes): four or more evenly spaced single tiles under 0.3 s apart whose
    pitch climbs or falls every step are a run, charted as a staircase the tune's way
    (`FIGURE_AGAINST`); two pitches back and forth are a trill on two lanes (`FIGURE_TRILL`);
    neither pays `REPEAT_COST`. Swing counts as even (the second gap up to ~2:1 the first, then
    each gap like the first or the one two before); a chord in a run goes by its top note;
    unpitched sounds count by band and brightness (`soundFigure`), so a kick-snare back and forth
    is a trill and a tom fill a run. Favouring held words and line-ending holds when capping holds
    was tried and taken out (the human charts held 0-1 of 21 sung line ends: the form's notes
    below). A rough replay (Open Your Eyes' saved Ultra thinned again, its tiles as the sounds,
    its 48-point energy as the loudness, before calibration): Easy busy phrases 7.5 → 10.8 tiles,
    quiet 5.8 → 5.7; Medium busy 12.6 → 14.5, quiet 9.8 → 8.5; Hard busy 20.9 → 22.3, quiet 13.2 →
    12.0. Not yet measured with map-bench or against the human charts: do that before tuning.
  - Chords were left as the model makes them (Nov 20): ours match the human charts' share and how
    they cluster on the CC set (27% vs 29%; 61% vs 60% within a beat of the last); humans range
    3-64% from song to song (3% and 45% on one song), and neither the sounds' strength nor
    anything else measured says which songs want them. Gating chords on strength cut them to 3-9%.
  - **Every difficulty is the song's own lines** (`src/mapping/leadline.ts`, the user, Nov 20:
    "what notes even are these?", then "why not Hard and Ultra too", "the piano solo at the start of
    Open Your Eyes should be mapped, every note"), where the song was split (its sounds labelled by
    part, the syllables, and the instruments' notes: Basic Pitch on the "other" stem, gated as the
    voice is: `played`); without that they're the trained mapper's, thinned as below. Each 2-bar
    phrase picks its lead (the singing where it's sung, else the strongest instrument:
    `LEAD_WEIGHT`; the last phrase's lead stays while it's `STAY` of the best) and a second part.
    `PROFILE`: Easy the lead (the second part only where the lead has under `EASY_FILL` (0.9) of
    the notes it wants: when the star calibration asks Easy for more, the second part fills in),
    Medium the lead with the second where it runs short, Hard both with chords of two on strong hits
    that meet, Ultra both lines whole (every note of a piano solo), chords where they meet. Notes are
    kept by where they fall in the bar first (`METRIC`: downbeat, beat, 8th, triplet, 16th; a note
    pushing ahead of an empty beat counts as that beat), then how strong, the lead's first
    (`LEAD_FIRST`): the easier charts are the same rhythm simplified (the user: "the times between
    notes" didn't match when tiles were dropped by loudness). Tiles go on the beat map's grid; a
    phrase whose lead plays an earlier one's rhythm (`ALIKE`) takes its pattern; long notes are
    holds. **Lanes mirror the tune**: in each phrase a note starts in the lane its pitch ranks at
    (lowest left, highest right, two notes in the middle lanes; drums: kick low, the rest high), and
    flowing moves it only where it's awkward (Nov 20, Open Your Eyes: pitch steps with the tune
    E 44→69%, M 64→82%, H 66→87%, U 64→94%; every tile had started in lane 0, so Ultra had 53% of
    its tiles there and 17% quick repeats, now 22/29/32/17% and 10%). Chords two lanes apart; a
    chord struck on the piano (voice.ts `also`: two notes 3 semitones or more apart within 80 ms)
    is a chord where the difficulty has them (Ultra, Hard's strong hits), one tile on the others.
    Ultra keeps every note of its lines plus the other parts' big hits where nothing else is
    (`accents` 0.6), fewer only above `ULTRA_CEILING` (4★, a sanity ceiling; the user lifted its
    cap at the trained mapper's level, Nov 20: on Open Your Eyes that was never what held it, two
    lines come to ~2.5★), and the easier ones take the usual star targets from it. The trained
    mapper runs only when its grid could be used (the beat tracker's isn't steady) or the song
    wasn't split (`linesCharts`, `canLead`, listen.worker.ts: split, its parts heard and the
    grid steady, the charts come straight from the lines; its ~120 MB and its charting are
    skipped, the star ratings from the runtime's core alone; the mapper string says "The song's own
    lines", which `remap-bank.mjs` applies too). Easy and
    Medium of the first version (Easy/Medium only) on the two real listens: Easy's phrases on one
    part 99% and 96%. **The testing ground** (`#/testingGround`, `src/screens/TestingGround.tsx`):
    songs mapped two ways to play side by side (each card names its song and the difficulty the
    two differ on, `focus`, which its main button plays), each a song file in `public/testing/` (id
    `test-…`, read by `fetchSong`; never in the bank; runs not saved). Since round 18: Open Your
    Eyes and Hotline Bling, before (round 16) and now.
  - **The song's form** (`src/mapping/sections.ts`, Nov 21: "a human mapper maps what the song is
    trying to do"). Sections come from what the song repeats, not loudness alone (before: 8-bar
    blocks labelled by level, so a loud verse was a "Chorus"): each 2-bar phrase's fingerprint (its
    sounds by band and harmony, and the singing's rhythm and tune: a chorus is its melody coming
    back) against every other's, measured against the song's own typical pair; boundaries where it
    changes (loudness, drums, singing, likeness) and where a repeat starts or ends, 8 and 16 bars
    preferred; the music that returns most, sung and busy, is the chorus (Hotline Bling's hook,
    returning four times, isn't its loudest part); quiet is a break, late and like nothing else the
    bridge, rising into a chorus a build, the bass and drums jumping in after one a drop. A fade is
    the sound stopping, not the volume (human charts play Hotline Bling's quiet 40-s outro to the
    end). Each section's intensity is its loudness held through it, a little by its kind (`FORM`:
    each chorus return +4%, the last ×1.15); the lead line takes it as a share of density
    (`leadline.ts`; Ultra keeps its lines whole, the part under them comes in with the section,
    `ULTRA_FILL`), the report takes its sections and the visuals' cues. Measured on the fan charts
    of California Gurls, Change, Hotline Bling (7 charts; `map-pop.mjs` prints it as "shape"): our
    density per 4 bars against theirs r −0.09 → 0.53, its spread (CV) 0.14 → 0.21 (theirs 0.23);
    timing F1 58% → 55% (Ultra's calm stretches lose some fill; those charts are 2-4× denser than
    our Ultra); the same stars. Human ladders keep the contrast on Easy (a mapper's own: CV 0.30 /
    0.27 / 0.29), so every difficulty takes it. Also from the human charts: a section that comes
    back keeps its rhythm (41-84% of a chorus's return's tiles) and varies its lanes (about half),
    so a return is charted from its first time phrase by phrase (`SECTION_ALIKE`) and may grow
    (`GROW`); one part a section (`STICKY_MIN`); every chart ends on a chord (15 of 26 Creative
    Commons charts do, ours never did); Easy at most 5 tiles in a row half a beat apart (osu!mania's
    ranking criteria); the half beat before a drop clear on Easy (`DROP_BREATH`; human charts leave
    the beat empty at a lift 28% of the time, 12% at any section; the whole beat on Easy and Medium
    read as pauses). Not done, by the same measures: more holds at
    sung line ends (the human charts held 0-1 of 21; ours already hold most on Hard), rests after
    long runs (ours rest far more often than theirs).
  - **No pauses, Hard and Ultra back up, syllables on their attacks** (Nov 21, the user's playtest:
    "significant pauses for parts that definitely should be played", "difficulty dropped
    significantly in higher difficulties", ~45% of Beat Saber quality). The form's intensity went
    as low as 0.13-0.4 where the music plays (Open Your Eyes' piano intro 0.30, One Dance's break
    0.27), so the lead line's `lean` is at least `LEAN_MIN` 0.7 (Hard and Ultra `LEAN_HIGH` 0.85)
    wherever the song plays (`plays`: a phrase at least `SILENT` 0.2 of the median's loudness, or
    one whose line has `FOLLOW_MIN` notes however quiet: round 4 below), and a phrase with no part to follow follows
    its strongest. Hard and Ultra take the other parts' big hits a 16th clear of the line (`ACCENT`:
    Ultra ≥0.45, Hard ≥0.7): the well-timed fan charts chart 74-91% of the mix's strong onsets, more
    than any other sound. Each syllable goes onto the mix's onset just before it (`onAttack`: up to
    120 ms and under 0.85 of a 16th early, 30 ms late, the vocals' onsets first): Basic Pitch hears
    a syllable 20-80 ms after its attack, not by one amount, so the voice's one `lateness` couldn't
    follow it (fan charts put a tile on 17-37% of the raw syllables, at or below chance; on 38-62%
    moved). On the saved listens of 8 songs: two-bar holes 1-2 on four songs → 0 everywhere; Ultra's
    downbeats 61-88% → 64-92%; Hard 1.15-1.84★ → 1.15-1.94; Ultra 1.36-2.46 → 1.41-2.54; F1 against
    the Hotline Bling fan charts (30 ms) Hard 47-49% → 48-50%, Ultra 56-59% → 56-60%. Ultra is still
    ~2★ against 2.9-6.4★ for the fan charts. **The pool is not what holds it** (measured Nov 21
    evening, replaying the same 8 listens at every commit of the day): the lead line before
    `11ab68c` (the merge that brought in main's form-driven lead line) made Ultra 1.63-3.35★ and Hard
    1.36-2.26 from them (Hotline Bling U 3.01, change 3.35, MEANT TO BE 2.55); from `11ab68c` on,
    Ultra 1.36-2.46 and Hard 1.15-1.84 from the very same sounds; round 1 won back 0.1-0.3. Lifting
    all of Ultra's fill limits at once (`PROFILE` clear 0 / Hard 0.25, `FILL_MIN` 0, `ULTRA_FILL`
    and `ULTRA_RATE` off) gives back only 0.05-0.36★ (Hotline Bling 2.15 → 2.51). The rest is how
    Ultra is built: against the fan charts (map-pop, 8 charts) chords 23% of moments then, 16% now
    (humans 47%; Hotline Bling 21% → 11%), lane repeats 24% → 17% (humans 13-19%: some of the old
    stars were jacks, not something to bring back). The ranked bottlenecks and what's next:
    `docs/mapper-bottlenecks.html` (updated each round).
  - **A rhythm you can count with the sound off** (Nov 21, round 2; the user: "with sound off, I
    could not find the rhythm or chorus"). osu!mania's ranking criteria: an Easy is "mostly 1/1", a
    Normal "mostly 1/1 and 1/2" (`soundoff.ts` `criteria` counts a chart's breaks of them, in
    seconds at their ~180 BPM: ours break none, the ladder is well inside them). Each bar keeps a
    tile on its `SKELETON` beats (Easy beats 1 and 3, Medium and Hard the downbeat; `skeletonOf`,
    first in a phrase's order, counted against its budget): the line's note there, else the line's
    note pushing up to half a beat ahead (it counts as the beat), else the strongest sound on the
    beat (the line is silent there), and a bar with sounds but none of those keeps its strongest.
    Letting the line's note after the beat stand in too kept Easy's downbeats at 46-71%. Downbeats
    with a tile, Easy 31-49% → 55-83%, Medium 36-68% → 59-84%, Hard 49-80% → 66-92% (the fan
    charts 82-92%); a chorus's return keeps more of its first time's rhythm on Easy (Hotline Bling
    43 → 52%, California Gurls 45 → 57%); the same stars, no holes. Chords come from any part
    striking with the line, not only the drums, from strength 0.3 (`CHORD_MIN`; Hard still only
    the big ones): Ultra's chords 3-18% → 10-28% of its moments (the fan charts 29-36%), Ultra
    1.41-2.54★ → 1.67-2.68. What the star gap is made of: Hotline Bling's fan Hard rates 2.92★, its
    chords taken out 2.40 at 4.5 rows a second (ours 4.5 a second rate 2.0-2.15), only its tiles on
    sounds we heard 2.32-2.50: chords are about half of it. Lane patterns are not: Ultra moves 1.0-1.1
    lanes a step (the fan charts 1.15-1.31), quick repeats 17% (13-19%).
    **Returns you can see** (round 3, Nov 21): on Easy and Medium (`RETURN_COPY`) every phrase of a
    section's return is charted from the same phrase of its first time, alike or not
    (`returnOf`: not only where `SECTION_ALIKE` holds), and takes its first time's lanes whatever
    the notes; Hard and Ultra as before (lanes vary, as the human charts' do). Only the return's own
    sounds can be kept, so where its music differs it keeps the slots both have. On the saved
    listens of 8 songs (replay-study, on against off): returns' lanes Easy 13-64% → 21-96%, Medium
    22-78% → 21-98% (Hotline Bling E 64 → 96%, M 78 → 98%; One Dance E 47 → 56%, M 37 → 53%), their
    rhythm +0-4 points; Easy the same stars (±0.03); Medium 3-17% fewer tiles and 0-0.07★ less (One
    Dance 1.28 → 1.21, change 1.29 → 1.22); no holes, no criteria breaks either way. The fan charts
    of Hotline Bling (Hard) keep 82-87% of a return's rhythm and 15-80% of its lanes: ours on Easy
    and Medium 69-72% rhythm, 96-98% lanes. Kept; its cost is on the ladder below.
    **Easy and Medium fall short of their star targets** on the lead line: Easy 0.83-1.01★ against
    `EASY_STARS` 1.05 on every song, Medium up to 0.24★ under its even step (Ice Ice Baby 1.01 for
    1.25), so Medium → Hard is the biggest step on several songs (E 0.87 / M 1.01 / H 1.46). Not the
    budget: at `SCALE` 1.4 Medium takes 26% more tiles (Hotline Bling 434 → 549) for +0.0-0.1★, and
    `SCALE` 2 or its second part from half a beat clear moved it +0.02-0.09★. Its stars stay low
    because it had no chords (osu!'s rating climbs with them): round 4 below.
    **Hard and Ultra back up** (round 4, Nov 21 evening; the user: "bring chords and the second part
    back into Hard and Ultra"). From the same 8 listens: (1) a phrase whose line has `FOLLOW_MIN`
    notes plays, however quiet (`plays`): Hotline Bling's 43-s outro (1-14% of the median's
    loudness, 15-20 sung notes a phrase; the fan charts play it to the end) was empty on every
    difficulty, 172 line notes; (2) Ultra keeps its lines whole: line first, its budget at least its
    lines, a repeat not held to its twin's pattern (on Hotline Bling it kept 502 of 710 line notes);
    (3) Hard and Ultra take the second part wherever it plays (`PROFILE` clear 0; Hard `on` 0), not
    only where the line rests half a beat; (4) a fill tile another part strikes with is a chord too
    (only line notes took one), Hard's chords also where both hits are firm (`HARD_CHORD` 0.6, as
    before `11ab68c`), and Medium a few: a big hit (≥ `BIG` or an accent) on a beat with the line
    (`chords: 'few'`). Ultra 1.67-2.68★ → 1.72-3.10 (Hotline Bling 2.15 → 2.45, change 2.68 →
    3.10, California Gurls 2.11 → 2.42), Hard 1.24-1.99 → 1.44-2.30, Medium 1.01-1.28 → 1.04-1.37,
    Easy the same; chords Ultra 10-28% → 10-33% of its moments, Hard 3-16% → 6-22%, Medium 0-2% →
    1-14% (each below Hard's on every song); jacks and lane moves about the same (Ultra 0-30% →
    1-33%, 1.06-1.39 → 1.07-1.35 lanes a step); no holes, no criteria breaks; downbeats Hard -2 to
    +10 points, Ultra -1 to +8. The ladder: the mean Hard/Medium star ratio 1.38 → 1.41 (1.50 without
    Medium's chords; 1.46 with them on downbeats or beats 1 and 3 only, 2-5% of its moments).
    Against the fan charts (map-pop on the replays): F1 56% → 58% (Hotline Bling's two Hards 63-65%
    → 70%, its density curve r 0.40-0.45 → 0.61), Ultra has 50% → 56% of the human tiles, the
    stars at the nearest difficulty 2.05 → 2.35 (humans 4.23), chords 16% → 20% (47%).
    California Gurls' alignment slides by whole bars on the replays (Speed Gurls -4 s, then -20 s;
    +0.12 s on the bank's map), so its numbers there are noise. Still under the pre-`11ab68c` Ultra
    on six of the 8 songs (MEANT TO BE 1.93 against 2.54, Open Your Eyes 2.28 against 2.74, Hotline
    Bling 2.45 against 3.01; over it on Ice Ice Baby and Coffin). Some of that was jacks (the old
    Ultra 13-36%, the fan charts 13-19%), the rest density (old 3.1-5.9 moments a second, now
    2.9-5.4) and chords. Hotline
    Bling has another part on the same grid point under only 124 of its 710 line notes, so its
    chords are near what exact coincidences allow.
    **Chords on drum hits** (round 5, Nov 21 evening). The fan charts of Hotline Bling chord their
    drum hits, not two parts at once: under their chords two of our parts sound within 30 ms 8% of
    the time (their single tiles 5-6%), a kick or snare 45-54% (33-38%), an onset ≥ 0.5 43-50%
    (27-31%). So a tile on a kick or snare doubles it (`DOUBLE`: Ultra from 0.5, Hard 0.7, Medium
    0.9 on a beat, Easy never; 0.3 / 0.5 made 36-66% / 25-52% of moments chords). Chords Ultra
    10-33% → 24-48%, Hard 6-22% → 15-39%, Medium 1-14% → 6-21% (below Hard's on every song); all
    of ours against the 8 fan charts 20% → 38% (theirs 47%). Against Hotline Bling's two Hards
    (precision / recall of our chords on the moments both have): Ultra 40-55% / 18-19% → 34-52% /
    49-54%, Hard 49-65% / 10% → 33-46% / 26-30% (the two human charts against each other: 86% /
    66%). Ultra 1.72-3.10★ → 1.88-3.20, Hard 1.44-2.30 → 1.52-2.32, Medium 1.04-1.37 → 1.07-1.38
    (its doubled hits keep the mean Hard/Medium ratio at 1.42; without them 1.47), Easy the same;
    stars at the fan charts' nearest difficulty 2.35 → 2.46. Hard's calibration paid for its chords
    with tiles on some songs (Hotline Bling 4.2 → 3.5 a second). The same F1, no holes, no criteria
    breaks, jacks about the same. **Swing was checked and left alone**: on Hotline Bling the mixes'
    onsets sit on 16ths (2% nearer a triplet point, `tools/swing-study.mjs`), and on our beat map
    only 14-15% of the fan charts' tiles are nearer a triplet point, 86-89% of them over no sound
    of ours (their straight ones 78-80% over one): map-pop's 27-29% "swung gaps" are mostly gaps
    between unheard tiles. osu!'s criteria chart swing on 1/6 or 1/12 "only when the song calls for
    it"; this one doesn't. The sung syllables spread evenly through the beat (Basic Pitch's timing),
    so a swung vocal can't be told from them.
    **Chord shapes** (round 6). A chord's partner went on a fixed lane of the other hand (outside
    for a kick), so a doubled kick on every beat hit one lane: Hotline Bling's Ultra jacks 17% →
    27% in round 5 (map-pop; the fan charts 13-19%). Now it takes the lane played least lately,
    either hand (human 4K charts jump on one hand too: chords only split across the hands kept the
    chart centred). Against the timed fan charts: jacks Hotline Bling 27% → 18%, California Gurls
    23% → 21%, change 14% → 11% (humans 3%); lane moves a step 0.89-0.95 → 0.98-1.11 (humans
    1.15-1.47); stars within 0.08; no holes, no criteria breaks. **Returns were checked and left
    alone**: of a first time's slots a return didn't keep on Easy and Medium, most have a return
    tile within a 16th, but 70 ms or more from the slot in nearly every case (raw times, before
    snapping): the sounds really come elsewhere the second time (the singer, or what's heard), not
    a snap that could have gone either way, so keeping the slot would move a tile off its sound.
    **Ultra hears more of the band** (round 7). Of the fan charts' Hotline Bling moments our Ultra
    lacked, 52-55% have no sound of ours within 30 ms (the analysis), a quarter a weak one. Of our
    onsets Ultra left out, the fan charts put a tile on (chance at their density ~33%): bass, drums
    and instruments at 0.3-0.5 71-100% (a third part: only accents from 0.45 came in), kicks and
    snares at 0.15-0.3 51-64%, bass and instruments that weak 39-50%, the vocal stem's onsets
    12-33% (change's chart is too dense to tell: chance ~85%). So Ultra takes any other part's hit
    from 0.3 (`ACCENT.ultra`; a sung syllable still from `ACCENT_SUNG` 0.45) and its kicks and
    snares from `GHOST_MIN` 0.15. Against the fan charts: F1 58% → 60%, Ultra has 56% → 59% of
    their tiles (Hotline Bling 68-69% → 70% at the same 72% precision; its density curve r 0.61
    → 0.73); Ultra 3.7 → 4.2 moments a second on MEANT TO BE, 4.7 → 5.0 on Open Your Eyes, stars
    +0-0.07; jacks Hotline Bling 19% (humans 13-19%); no holes, no criteria breaks. Of the strong
    drum hits still left out on Hotline Bling, 14 of 26 are in its quiet outro (`ULTRA_FILL` and
    `ULTRA_RATE` hold the part under the line back there, for the form's contrast) and 8 are 30-65
    ms from a tile of ours (two sounds too close for one moment).
    **The drum stem, tried and left out** (round 10, a fresh listen of Hotline Bling: the user
    allowed its dry-run remake, `yt-zt6arkpf9t4-mwpxnifz`). The onset mapper run on the drum stem
    (Demucs) found only 38 hits in 268 s that no sound of the mix was within 30 ms of: 28 hats the
    fan charts put a tile on 0-18% of the time (chance 26%), 9 snares 60-100%; under 1-2% of the
    human tiles our Ultra lacks. The mix's onsets already catch the drums the split can tell
    apart. The human tiles we hear nothing under (184 of 1,214 on this listen) are mostly the
    charters' own streams: 59% in an even run of half a beat or less, 74% a 16th from a
    neighbour, 52% over a note still ringing, 62% with a sound of ours 30-80 ms away. Charting
    those would be filler (a held note cut into a stream), against the first rule; it's the
    user's call. Today's mapper on this listen: Ultra 2.54★ (5.9 tiles a second), F1 71-72%
    against both fan Hards (2.92★), chords 34% (theirs 29-36%), jacks 17% (13-19%), lane moves
    1.04 (1.15-1.31), downbeats E 81% / M 80% / H 83% / U 84%, no holes, no criteria breaks.
    **Hard keeps its line whole; glides and weak hits** (round 11, Nov 21 night; the user, after
    playing the fresh remakes of One Dance, Open Your Eyes and Hotline Bling: "it sometimes skips
    certain notes in what it's trying to match", "the difficulty of Hard dropped a lot"). Calibrated
    to its even step, Hard was cut to 0.77-0.85 of its share and the cut fell on the line: it kept
    68-81% of it (Hotline Bling 72 holes on 8ths or stronger), Medium 52-59%. Now (1) Hard keeps
    every note of the line, its bar's skeleton first (`LINE_WHOLE`, as Ultra: the calibration trims
    only the part under it; line first without the skeleton cost Hard 5-15 points of downbeats), and
    Medium every line note on a beat, after a return's own slots (`LINE_BEATS`; all of its 8ths put
    Hotline Bling's Medium at 1.82★ against Hard's 2.12): Hard's line 99%, holes 4-6, its tiles
    +4-20% a second on five of 8 songs; Medium's beats 99-100%, its returns as before. (2) A sung or
    played note with no sound in the mix within 30 ms (`BARE_NEAR`), on a 16th or a triplet, isn't
    charted: of Ultra's tiles neither Hotline Bling fan chart has anything within 80 ms of, 77% were
    these (252 in all; both humans charted 18). (3) Ultra takes every drum and the bass from 0.1
    (`GHOST_MIN`): of the sounds it left out, both humans charted bass at 0.15-0.3 79-85%, hats
    87%, faint kicks 82% (chance 7%), the vocal stem's onsets 0-2%. (4) A chord's partner and the
    part under the line take a lane not played in the last 0.3 s where one is free (`JACK_SOFT`):
    (3) had put a tile half a beat after a chord in its lane, jacks 17% → 25%; now 17% (humans
    13-19%), lane moves 1.04 → 1.08 (1.15-1.31). Against Hotline Bling's two fan Hards: F1 71-73%
    → 81-83% (precision 72% → 85-87%, Ultra has 72% → 77-79% of their tiles); the two human charts
    agree with each other 92%. Across the 8 fan charts F1 60% → 61% (California Gurls' 13-20 tiles a
    second charts, which stream the glides too, -0 to -3). Stars, the 8 listens: Ultra 1.83-3.08
    (was 1.85-3.22; California Gurls 2.59 → 2.27), Hard 1.47-2.21 (1.51-2.32; Hotline Bling 1.94 →
    2.09), Medium 1.07-1.39, Easy the same; no holes, no criteria breaks. Hard's stars are held by
    its even step: its target at r^2.4 in place of r² (starTargets) gives Hard +0.01-0.23★ and
    6-19% more tiles, but Hard → Ultra ×1.13-1.20 against Medium → Hard ×1.4-1.76: the user's call.
    What's left against Hotline Bling: human tiles we lack 22-24%, a third of them a 16th beside a
    tile of ours that matches another of theirs (their streams), 72-76 on sounds we heard (61 of
    80 weak bass and drum hits within a fifth of a beat of a tile of ours: two sounds, one moment,
    they chose the drum), 78-91 on no sound of ours; only 20 are ours mistimed 30-80 ms.
    **A higher ladder, lighter steps** (round 12; the user: "you can raise hard but also raise medium
    and easy to make the jump lighter"). The lead line's ladder starts at `LEAD_EASY_STARS` 1.25
    (ensomi.ts; the trained mapper's charts keep `EASY_STARS` 1.05) with even steps to Ultra, and
    calibrates up to ×2 (`LEAD_SCALE`; ×1.4 before). Easy couldn't go past 0.92-1.17★ with KEEP's
    spacing and its second part only two beats clear on beats, so on the lead line Easy and Medium
    space at 0.7 of KEEP's `minGap` (`LEAD_GAP`), Easy takes the second part from half a beat clear
    on 8ths, Medium wherever it plays (`PROFILE`). On the 8 listens: Easy 0.85-1.01★ → 0.94-1.22,
    Medium 1.07-1.39 → 1.18-1.69, Hard 1.47-2.21 → 1.53-2.34, Ultra as it was; the biggest step on a
    song ×1.35-1.59 → ×1.30-1.43 (Hotline Bling M → H ×1.56 → ×1.38, change ×1.59 → ×1.38); no
    holes, no criteria breaks, downbeats the same or up; F1 against the fan charts 61% as before.
    Letting every return grow (not only a busy repeat) moved only Hotline Bling's Medium (+0.1★) and
    cost the returns 4-8 points of rhythm: left out. Also measured for "the remaining gap", and not
    charted: a stream into our half-beat gaps over a ringing note (both fan charts fill that 16th
    4-7% of the time: 93-96% of such tiles would be on nothing they chart); "two sounds, one moment"
    was one human tile between our tile and the drum, 40-50 ms apart (57 of 62), already a match;
    83 of the 103 human tiles 30-80 ms from ours are their 1/6-1/8 runs where we hear one sound.
    **The beat kept once it's followed** (round 13; the user, after playing: "sometimes it's on the
    beat, it's got it, then it drops it, like the pianos in Open Your Eyes; every song does this in
    some part"). Of the beats with a sound on them right after two that had a tile, Easy left out
    4.4%, Medium 7.0%, Hard 4.3% (Hotline Bling's fan charts 0-0.2%); 91% of those had a line note
    up to half a beat before the beat standing in for it (`SKELETON_AHEAD`). Now a bar's skeleton
    takes the beat's own sound first (the line's note on it, else any part's), the note pushing
    ahead only where nothing sounds on the beat, and Medium and Hard keep every beat of the bar
    (`SKELETON`, Easy still beats 1 and 3): dropped beats 1.2% / 0.7% / 0.4%. And where a difficulty
    plays nothing under a hold, a hold ends half a beat before another part's pulse (two beats in a
    row it sounds on: `pulseEnd`): Open Your Eyes' three-second "aaah" held Easy and Medium through
    the break while the piano played every 8th (bar 37 `----` against the piano's `BBsB`; now
    Medium `BB-B`); beats with a sound under a hold Easy 23 → 3, Medium 60 → 47 (its busy sections
    play taps under holds). On the 8 listens: stars within ±0.09; downbeats up (California Gurls
    Easy 76% → 92%, Medium 81% → 93%), returns' rhythm up (Hotline Bling Easy 68% → 74%, Medium 67%
    → 74%; change Medium 37% → 63%), returns' lanes -0 to -4 points; no holes, no criteria breaks;
    F1 against the fan charts 61% as before.
    **An even run leads its phrase** (round 14, Nov 22; the user: round 13's charts "honestly feel
    the same"). Open Your Eyes' piano runs 16ths into the drop (bars 38-39, 77-81 s, every 16th
    heard) under one sung syllable; the sung phrases either side bridged it to the voice
    (`SUNG_GAP_MIN`), so the run was fill thinned by the quiet break: Ultra kept 6-7 of 16 a bar
    after following the piano note for note in bar 37. A phrase whose instrument runs evenly
    (`RUN_EVEN` 0.5 of its steps like the last) with `RUN_OVER_VOICE` (4) times the sung notes
    follows the instrument, and the section's part doesn't take it back (`runLed`). Only that run is
    that even on the 8 listens (0.57-0.59; change's guitar under a few sung notes 0-0.43, and
    following it put tiles where its fan charts have none: 0-33%, chance 46-71%). Open Your Eyes
    +10-20 tiles a difficulty, stars ±0.02, nothing else moved. Measured and left out: (1) the round
    11 bare rule (`BARE_NEAR`) for played notes: keeping all of them added Hotline Bling tiles its
    fan charts have 2-20% of the time (chance 30%); only the ones in even runs added ~0. (2) Our
    rhythm is less steady than the humans' (gaps equal to the one before: Hard and Ultra 35-69%,
    human charts at 2.2-3★ 43-92%, mean 68%; at Easy's stars humans are as unsteady as ours,
    23-28%, the CC set); swapping fill for steadier real sounds at the same count gained 0-8
    points (California Gurls' Medium -4) and costs too much in the browser: the line itself (the
    syllables) is what's uneven, and steadying it would take streams (filler). (3) A part's pattern
    dropped while it plays on: ours 0-3% of bars (Medium, Hard, Ultra), 2-5% of phrases, the fan
    charts 0-41%; tile timing against the sounds: whole bars 15-30 ms off in a few places, the
    human charts 13-30 ms on most songs.
    **Runs that keep going; nothing in the silence** (round 15, Nov 22; the user: "it still feels
    like there's random breaks in a rhythm", "try the streams on Hard and Ultra", and "what is it
    mapping at the end of Hotline Bling? there's nothing playing"). (1) An even run (two equal gaps,
    a beat or closer) that skips one or two slots and goes on at the same gap: ours 2-8 per 100
    tiles on Medium, Hard and Ultra, Easy 2.5-6.5; Hotline Bling's fan Hards 0 and 0.2, One Dance's
    0.6, the Creative Commons charts mostly 0-2. On Hotline Bling 104 of the 115 skipped slots had an
    onset of the mix on them, and both fan charts tile 83-100% of those (chance 30%); slots with only
    a note ringing, 0%. So the breaks were sounds thinned out, not missing streams, and the skipped
    slot gets its tile back where the mix strikes (`RUN_KEEP`, `runSlot`; Easy from 8ths, within
    `EASY_RUN`). Skips per 100 tiles: Medium 1.3-8.4 → 0.2-1.9, Hard 1.5-5.6 → 0-2.9, Ultra
    2.3-5.8 → 0.4-3.6, Easy 2.5-6.5 → 2.0-4.4. Same-as-last gaps Medium 34-71% → 37-77% (Hotline
    Bling 52 → 72%), Hard 28-58% → 35-67%, Ultra 38-69% → 39-74% (humans at 2.2-3★ mean 68%); stars
    +0-0.15; downbeats the same or up; F1 against the fan charts 61% → 62% (Hotline Bling's Hards
    83/80% → 84/82%, the same precision); no holes, no criteria breaks. What's left is slots with
    nothing struck, where the fan charts don't tile either (One Dance 8-11%, chance 37%): streams
    there would be filler, so none were added. Easy's runs of 8ths stopping at `EASY_RUN` and
    starting again are most of its rest; playing a long run on its beats only took Easy's skips to
    0.7-3.6 and its stars down up to 0.06 (the Easy → Medium step wider): left out. (2) Basic Pitch
    hears notes in the silence after a song: Hotline Bling's last 10 s (the mix at 0-2% of its
    median, no attack) had 35, charted on every difficulty. A sung or played note where the mix is
    under `AUDIBLE` (5%) of its median with no attack within `UNHEARD_NEAR` (1 s) isn't charted:
    the chart now ends a second after the last drum (4:13; the fan charts 4:02 and 4:16).
    **The piano alone keeps every note** (round 16, Nov 22; the user: "it's very obvious at the
    beginning of CYE, it just skips parts of the piano", "this happens in every song", "if something
    is limiting it, fix that too"). Traced note by note: of the intro's 61 piano notes, Ultra lost 9
    and Hard 9 to round 11's bare rule (`BARE_NEAR`: a note on a 16th with no attack in the mix within
    30 ms), 2 more sharing a 16th with another; Medium and Easy lose 18-28 more to their budgets (by
    design: Easy at its calibration ceiling, scale 2, still under its 1.25★ on most songs; raising the
    ceiling to 3.5 gave Easy 15-25% more tiles for +0.02-0.06★ and broke Ice Ice Baby's Easy: left
    out). The bare rule is the biggest remover of instrument notes on Ultra in every song (13-29% of
    those heard), but the fan charts skip those notes too, even in struck intros (change 5 of 22,
    California Gurls 0 of 5; Hotline Bling's outro pad 0 of 51). What sets Open Your Eyes' intro apart
    is the mix: 0.85-1.08 attacks of the instrument a note of it (Hotline Bling's pad 0.07-0.3). So in
    a phrase the instrument leads, nothing sung, with `SOLO_STRUCK` (0.8) of its attacks a note, or
    where it runs evenly (`runLed`), its bare notes are kept. Moving instrument notes onto an attack
    within 45-60 ms (as syllables are) gave back 1-2 of the 9 and added 120 tiles to change at chance:
    left out. Intro kept: Ultra 82% → 95% (58 of 61), Hard 80% → 92%, Medium 52% → 57%, Easy 33% →
    38%; the run into the drop 81% → 97% on Hard and Ultra. Elsewhere California Gurls +9 tiles on
    Ultra (a fan chart has all of them, chance 38%), change +15 (its fan charts 18-25%, chance
    46-71%), the rest 0-2; stars +0-0.08; F1 62% as before; no holes, no criteria breaks.
    **Medium and Easy: simpler, still the music** (round 17, Nov 22; the user plays Hard and Medium:
    "for Easy and Medium it makes sense not to keep the whole part, so make it less difficult but
    still feel like you're playing music, for every song"). Reduction rules from other games: Guitar
    Hero's (Medium "eighth notes or slower", the strong beats kept and the offbeats thinned, "a
    well-placed eighth note" kept; Easy "a quarter rest or longer between notes", at most one 8th next
    to another; fast runs keep "the pitch extremes"; repetition over variation) and Beat Saber's
    downmapping (about 20% fewer notes a step, the song's key moments on every difficulty). Measured
    on the 8 listens: Medium keeps 92-98% of Ultra's beats, 36-50% of its 8ths, 12-32% of its 16ths;
    Easy 54-72% / 29-42% / 6-12% (the order the rules ask for). Bars Ultra has alike, Medium has
    alike 23-42% of the time (Easy 0-22%, Hard 20-63%), but the one human ladder that can be compared
    (a Creative Commons set, the same mapper) is no more consistent (37% at half the tiles); human
    charts favour the tune's peaks a little on Hotline Bling (29-38% against 18-23% of passing notes),
    not on California Gurls or One Dance; ours favour its valleys and repeated notes already; tiles on
    the tune and switches to other parts about as the fan charts. None of these says what to change.
    The rules part ways in one place: Medium has 3-16% of its gaps under an 8th (Coffin 33%, at 69
    BPM). Medium in 8ths (no two tiles closer than half a beat) comes out 0.03-0.22★ easier (Coffin
    1.26 → 1.04, beside its Easy's 0.94: the Medium → Hard step wider), downbeats the same. Not put in
    the mapper: both versions of Open Your Eyes and Hotline Bling are in the testing ground for the
    user to play.
    **Medium in 8ths; Ultra a smidge harder** (round 18, Nov 22; the user: "make these changes", "make
    ultra just a smidge harder"). Medium: no two tiles closer than half a beat, or than `MEDIUM_GAP`
    (0.2 s) on a slow song; to hold its rating it also takes taps under a hold (`PROFILE.medium.under`)
    and the other parts' big hits (`ACCENT.medium` 0.6). Medium 1.26-1.70★ → 1.27-1.69 (Open Your
    Eyes, Hotline Bling, Coffin, Ice Ice Baby, change -0.04 to +0.03; where the sung line runs in
    16ths MEANT TO BE 1.56 → 1.37, One Dance 1.41 → 1.30, California Gurls 1.59 → 1.53: no 8ths there
    to take their place). Gaps equal to the one before 37-76% → 50-81% (humans at Hard's stars mean
    68%); chords and jacks about the same; downbeats within 2 points (Open Your Eyes -4); returns'
    rhythm the same or up. More chords (`DOUBLE.medium` 0.6-0.7) put Medium's above Hard's (California
    Gurls 31-45% against 31%); a higher calibration ceiling moved nothing. One Dance's Medium now
    skips a slot in its 8th runs 7.3 times per 100 tiles (was 1.0; the others 0.1-0.9): slots with
    nothing struck (17 a note ringing, 11 nothing), 19 of 31 in runs that are new, 12 where a
    syncopated 16th stood beside it; the fan charts leave such slots empty. Ultra: calibrated to about
    `ULTRA_PLUS` (0.15★) over its own rating by a lift (`ULTRA_LIFT`: its doubled kicks and snares from
    0.5 down to 0.3, its two-part chords from 0.3 down to 0.18, its rate ceiling up), never past
    `ULTRA_CHORDS` (half of its moments chords, or its own share if higher; the fan charts 47%): Ultra
    1.83-3.17★ → 1.86-3.33 (change +0.16, MEANT TO BE +0.13, Open Your Eyes and Hotline Bling +0.10,
    Ice Ice Baby +0.07, California Gurls and Coffin +0.03-0.04, One Dance 0: already 53% chords);
    chords 38% → 43% against the fan charts (47%), jacks the same; F1 62% as before. A fixed chord
    threshold lifted songs unevenly (0.4: MEANT TO BE +0.21, most +0.01-0.04); more of the part under
    the line in calm sections (`ULTRA_FILL`) +0.0-0.12★. Easy was left: at most 2 tiles in a row half
    a beat apart (Guitar Hero's Easy) took its 8th gaps only from ~38% to ~30%, made 26-48% of its
    gaps uneven (a beat and a half and such) and cost 0.05-0.12★.
  - **"What am I playing?"** (the user, Nov 20: players asked "what notes even are these"). Each
    2-bar phrase follows one part: with the song split (WebGPU), every sound found in the mix is
    labelled with the stem that jumps most at it (`labelParts`, listen.worker.ts: drums, bass,
    vocals, other; sung syllables count as vocals) and thinning pulls each phrase to its lead part
    (`FOLLOW`, 0.3 as before: 1/0.8/0.5 for Easy/Medium/Hard raised the share of a phrase's tiles on
    its lead part only 73% → 77% on the real listens and cost the synthetic band's strong notes
    E 76% → 71%, M 80% → 77%). Sounds are
    still found in the whole mix, not per stem: found per stem they gave the repeat detection 2
    phrases charted alike on One Dance where the mix gave 11. Syllables always go onto the beat
    map's grid (`onGrid` in ensomi.ts; within 30 ms only, 17% of Easy's tiles sat off the 16ths and
    bars stopped repeating: 3% of One Dance's Easy bars repeated one of the last 8, Nov 19's map 36%).
  - "Easy from the beat" (rows on the beat weighing more on Easy) was tried and left out: human
    Easy charts put 26-50% of their tiles on the beat, ours already ~40%, and more made them less alike.
- **Star ratings** (`calibratedCharts`, `starTargets`): every chart is rated with the runtime's
  `starRating` (osu!mania's star rating) and saved as `Chart.stars` (the start card and the dev
  tools show it). Easy is thinned to `EASY_STARS` (1.05 since Nov 21, for the song's shape; 0.95 before; the song's own lines start at `LEAD_EASY_STARS` 1.25 since round 12, below) on every song, Medium and Hard to even
  steps of stars between it and the song's Ultra (KEEP's share and rate scaled only 0.7-1.4; one
  that would crowd the difficulty above it stays as KEEP made it). By share alone the same
  difficulty ranged 0.85-1.11 / 1.14-1.50 / 1.57-2.14 stars from song to song; now 0.86-1.02 /
  1.19-1.39 / 1.57-2.03, the tile steps as even as before (×1.22-1.85 on the synthetic band). Fixed
  targets for all three (1.38, 1.9) broke the ladder (Hard ×1.05 under a 2.2-star Ultra, Easy to
  Medium doubled): don't go back to them. Ultra (the whole chart, 2.0-3.1 stars) is rated, not
  thinned. By osu!'s names our Ultra is a Normal; making it harder is the user's call.
- **The charts go with the lyrics** (Nov 20, the user: "it often doesn't go with the lyrics"). With
  WebGPU, after the listen the worker splits the vocal off (Demucs, `stems.ts`; about 2 minutes
  of a 3-minute song on a laptop's chip, the user chose that wait), hears its notes (Basic Pitch,
  `notes.ts`) and takes their starts as sung syllables (`voice.ts`: merged within 80 ms, faint
  notes dropped, and only where the vocal stem is at least 30% of the mix's level: Basic Pitch hears
  bleed in an instrumental's vocal stem; `map-bench.mjs --voice-only` counts what gets through on
  the instrumental bundled tracks: 0 and 0.18 a second, against ~2.5 on sung songs).
  `withSyllables` (ensomi.ts) adds a tile on each syllable Ultra lacks (snapped to the beat map
  within 30 ms, a hold where sung long, never within 90 ms of another tile; a tile crowding it that's
  on no measured sound of its own is moved onto it) and thinning weighs sung rows `SUNG` (2) more
  (thin.ts), their phrases following the voice and their lanes its tune. On two real listens (One
  Dance, Open Your Eyes): Ultra's syllables with a tile 51% → 79%, 48% → 82%; Easy's tiles on a
  syllable 28% → 61%, 27% → 57%; the same stars and steps. Measured with the separated vocal as the
  truth: human charts of these songs are too few, and mistimed, to say. Sung notes are short
  (One Dance: 7% last 0.35 s), so few become holds. The judgement before
  (below: "about chance") was against a mistimed fan chart. Without WebGPU, or if the split fails,
  the charts are made as before (the report says which).
- Tried on Nov 20 and left out (measured on the Creative Commons charts and One Dance's):
  - **Basic Pitch** (`notes.ts`, Spotify, 230 KB) hears notes under 16% of the human tiles the
    onset mapper doesn't (59% → 75% heard), but the tiles come from the trained mapper: its notes
    merged into the sounds made the beat map and the repeats worse (tiles exactly on the grid 44% →
    28%), and as holds on ringing notes or as tiles added where Ultra is short they moved nothing
    (F1 64% → 64%, human holds we also hold 15% → 17%). (On the vocal split it's now the voice
    step: above.)
  - **The voice split off**, judged against the human tiles: on One Dance it heard notes under 6
    more points of the human tiles (about chance), but that fan chart was mistimed (up to 70 ms):
    measured against the separated vocal itself it's what the lyrics need (above).
  - **The model's own controls** (`@ensomi/runtime` 0.4.0 `controls`): `long_notes` NATURAL is what
    it does anyway, HALF made fewer holds survive RING and matched the humans' less; per-section
    stars in place of splicing whole charts met Ultra's targets less on the one fast song that
    needed it (81% against 86%).
- **Mapping studies** (dev): with localStorage `rythm-architect:study` (`ensomiModel.ts` STUDY_KEY)
  a listen also hands back what the steps after the model work from (its raw charts, the sounds,
  the beats, the notes heard; never the audio) as `window.__rythmStudy`;
  `node tools/remap-bank.mjs --only=<id> --study` saves it to `.data/remap/<id>.study.json`, to
  replay ideas offline against human charts. Real-listen tests remake only One Dance and Open Your
  Eyes (the user, Nov 21; One Dance only before), never the whole bank.
- Only if it's off or fails: with WebGPU the song is split with Demucs (`src/mapping/stems.ts`,
  ~172 MB, `stemModel.ts`; e2e: `rythm-architect:no-stems`), and the onset mapper's own charts
  (`charts.ts`) are used. All the models run on one ONNX Runtime (`src/mapping/ort.ts`); any of
  them failing leaves the next step to carry on.
- **The recording is full quality** (Nov 20, the user: "the limitation is the listener"): the
  browser's own rate (44.1 or 48 kHz), both channels kept (`Heard.stereo`, placed as the mix is);
  the mapping takes the mix at that rate and the song splitter (Demucs, made for 44.1 kHz stereo)
  the real left and right. It was mixed to mono and halved to ~22 kHz: Demucs got nothing above
  ~11 kHz and no stereo to tell the parts apart. On Open Your Eyes: sounds found 958 → 1112 (drum
  hits 380 → 458), instrument notes 289 → 307 (the piano intro 52 → 58), the split as long. The
  trained mapper resamples it itself (the runtime's 44.1 and 48 kHz tables go with the app). About
  200 MB while a 3-minute song is placed (the chunks are dropped after).
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
- **A listen's timing against the video varies** from one listen to the next by tens of ms (Nov
  20: three listens of One Dance landed 0, 46 and 70 ms behind the map before them). The capture
  tick measures the page's own sound, not YouTube's; a tick through a media element was tried and
  was further off (its position isn't read like YouTube's). So remakes line up with the old map
  (`remap-bank.mjs` `lineUp`) and new songs rely on the Map Syncer after a run.
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
  restart, the dev tools and the 2D fallback working for them. **A lagging video** (the user, Nov
  20; `src/game/lag.ts` `LagWatch`, Play.tsx): when the video buffers mid-song the game holds
  (phase `buffering`, "Loading the song…") while it loads ahead, then 3, 2, 1 once `READY_AHEAD`
  seconds are loaded; a stall over `HEAVY_MS`, or one within `AGAIN_MS` of the last, brings up
  `LagCard` (phase `lagging`: signal.riv at the top, seconds loaded ahead, how fast it loads
  against the song, the browser's Mbps where it says (Chrome, Edge), Continue playing / Return to
  main menu); after `CARDS_BEFORE_WAIT` (3) cards, Continue stays greyed out until the connection is
  strong (`STRONG_AHEAD` s ahead and loading `STRONG_RATE`× the song's speed, or all of it loaded).
  e2e: the fake player's `stall()` / `unstall()` and `__fakeYtLoaded`. e2e tests use a fake player
  (`tests/e2e/fake-youtube.js`).
- Listening and mapping show `src/components/generate/ListenScope.tsx` (the song as a field of
  light) and `src/components/generate/ListenAura.tsx` (the full-screen light behind the dialog; the
  dialog's text sits on its own panel). Loading uses `src/components/Loader.tsx`.
  The dialog's percentage is each step's measured share of a build (`GenerateDialog.tsx` `BUILDS`:
  `split` where the browser splits songs, `whole` where the trained mapper charts it): re-measure
  them when the steps change (Nov 22: it waited at 74% and jumped to 100%, the weights still the
  trained mapper's, which split songs no longer run).

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
- **Drop mode** (Nov 22, the user: "constant animations for the duration of a beat drop"): a drop
  is a stretch, not a moment. `dropZones` (`src/mapping/cues.ts`) runs each drop cue to the next
  break/build cue or the next section 4+ bars on (at most 16 bars); "Chorus (drop)" sections and the
  mapper's own drop cues are `big`, a plain chorus lighter (`CHORUS_DROP`). Play follows it on the
  song's clock (`followDrop`): `Stage3D.setDrop` (lasers fanning up behind the far end in three
  figures that change every two bars, flashing on the beat, always leaning out from the track;
  walls lit; warp streaks; each beat a climb, each bar a sky burst; under Overdrive only the lasers
  and walls), the sky's `drop` event (a warp floor, a wash each bar), and
  `components/play/DropFx.tsx` (the screen's edges glowing, flaring on each beat). The 2D fallback
  fans beams beside the field. **The notes first** (Nov 22, the user: "prioritize people being able
  to see the notes"; "remove the word drop on the side"): the DROP badge (`drop.riv`) is gone; no
  camera rock, lean or zoom kicks for a drop, Overdrive, milestones or fever; one shockwave per
  Overdrive level, none per drop bar; a veil (`VEIL`, Stage3D) darkens the track's body under the
  tiles over every effect, more in a drop or Overdrive; fever's glass stays dark (gold edges);
  Overdrive's running-out flicker is on the walls, not the tiles; fewer particles and sky bursts in
  every big moment. Dev tools: "drop mode" toggles it; the Map section lists the drops.
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
- **Safari** (the user, Nov 20: "a lot" of rendering bugs on a Mac, in the intro, the menu's backdrop
  and the stage): Safari's engine (`isWebKit` in perf.ts: Safari and every iPhone/iPad browser) draws
  with WebGL even where it has WebGPU (Safari 26's is new, and three.js's WebGPU renderer draws wrongly
  there). Its workers have no animation frames: the stage worker says `paced` and the page sends it a
  `pulse` each frame (proxy.ts), not a 16 ms timer of its own (off the screen's beat). In shaders
  (GLSL and the TSL twins) never `pow()` a base that can go negative (`pow(x, 2.0)`: write `x * x`;
  clamp `1.0 - h` and rims with `max(0.0, ...)`) nor `smoothstep` with edge0 >= edge1 (write
  `1.0 - smoothstep(lo, hi, x)`): undefined in GLSL, and Apple's GPUs answer NaN (white or garbage)
  where Windows' don't. Playwright's WebKit (`npx playwright install webkit`) runs on Windows for a
  look, but it has no Web Audio and no OffscreenCanvas: real Safari has both, so judge by screenshots
  from a Mac.

## After a change

- After changing the trained mapper's placement (`ensomi.ts`), `thin.ts` or the beat grid, run
  `node tools/map-bench.mjs` (the whole pipeline in a browser on the synthetic band of
  `tests/bench/band.ts`, 76-188 BPM clean and rough, then the bundled tracks): tempo right on every
  band, tiles on real notes, strong notes caught per difficulty, the ladder's steps and holds.
  Nov 20 (with star calibration): tempo 16/16, on-note E 100% M 97% H 98% U 96% (the 76 BPM band's
  Ultra 79%: the model's own chart there, read at 152), strong caught E 80% M 82% H 97% U 98%,
  every step ×1.22-1.85.
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
- Against human charts of real pop songs: `node tools/map-pop.mjs [--songs=<map.json>]` (the
  bank's maps, or a remap's dry run, against fan-made osu!mania 4K charts of the same songs: chart
  text only, cached in `.data/pop-charts/`). Charts timed at another tempo than the song's are left
  out (One Dance's at 141 and 92 BPM: mistimed and an edit). Nov 20: Hotline Bling F1 80% against
  a human Hard (2.92★), its humans' gaps 27-29% swung against our 9%.
- What a player sees with the sound off (`src/mapping/soundoff.ts`, Nov 21: "with sound off, I could
  not find the rhythm or chorus"): the longest stretch with no tile while the song plays, two-bar
  holes, the share of downbeats with a tile, a section's returns against its first time (rhythm,
  lanes). map-pop prints it for ours and each human chart (human: 64-92% downbeats, no holes, returns
  82-87% of their rhythm on Hotline Bling). The offline way, in seconds: `node tools/replay-study.mjs
  .data/remap/*.study.json [--out=<dir>]` replays the saved listens through today's mapper (the
  modules through Vite, the stars by the runtime; its lines, else the study's raw trained charts
  spliced and thinned) and prints the sound-off report and criteria breaks per difficulty, now and
  as the listen made it; `--out` writes song files for `map-pop.mjs --songs=`. Give it one study a
  song (the newest: several listens of One Dance and Open Your Eyes are saved). The studies made
  before Nov 21 hold no loudness, so it takes the dry run's `levels` (without them the form had
  holes the browser never makes: change 9 s, MEANT TO BE 5 s). It replays an older commit too:
  `git archive <commit> frontend/src frontend/package.json` into a folder outside OneDrive, today's
  tool and `soundoff.ts` copied in, `node_modules` as a junction; at `c34aa1d` it gives exactly what
  the listens made, so it matches the browser. Human baseline in map-pop (Nov 21 evening, the
  charts timed to our audio: Hotline Bling's two Hards, California Gurls' Speed Gurls): downbeats
  82-99%, longest gap 1.0-1.9 s, no holes; returns 40-90% of their rhythm and 14-80% of their
  lanes (measured on our map's sections, so they move with it: Hotline Bling's 82-90%).
  replay-study reads downbeats on the listen's beat map (round 8; map-pop, with no beat map,
  still on the straight grid): on the straight grid change, Ice Ice Baby and Open Your Eyes read
  14-28% on Easy where the beat map's bars have 55-83%. The bars are where the song has them
  (kicks on beat 1, snares on 2 and 4 on Ice Ice Baby, California Gurls, Open Your Eyes). On the
  beat map (round 7's charts): Easy 55-83%, Medium 59-84%, Hard 67-92%, Ultra 71-97% (the listens'
  own maps 22-80 / 50-88 / 53-88 / 62-92%). Most of the downbeats Easy has no tile on are a line
  note up to half a beat ahead of them (5-31%: the skeleton's `SKELETON_AHEAD`, by design; both
  wouldn't fit Easy's spacing); a sound it left on the beat 0-7%, nothing there 0-14%. (Before it, the Nov
  21 study did the same in a scratch `tests/unit/zz-*.test.ts`, moved out before committing.) After each round, update
  `docs/mapper-bottlenecks.html` (plain: the measures against the human charts, the analysis, the
  ranked bottlenecks, a change log).
- Where players miss: the game sends each scored run's tiles (`engine.ts` `tiles()`), the server
  keeps per tile how often runs reached and missed it (`Song.heat`; backend `TileHeat`, mock
  `game/heat.ts`, cleared when a chart changes); the dev tools show a song's most missed tiles, and
  `node tools/heat-report.mjs` sums the bank's by pattern (quick repeats, leaps, chords, holds) per
  difficulty, to tune the mapper's rules from real play. And how runs felt (Nov 20): after a kept
  run the results ask once, Felt right / Felt off and why (notes didn't match the song, timing,
  too hard, too easy: `FeelAsk.tsx`, `POST /api/songs/:id/feel`, backend `RunFeel` and
  `PlayController.rate`, mock `game/feel.ts`: counts only, from a run whose score the controller
  kept, once; cleared when a chart changes); the dev tools and heat-report show them.
- After changing `src/mapping/automap.ts` or `charts.ts`, run `npm run map`. The band benchmark (`tests/unit/automap-band.test.ts`) must keep finding the notes (legato ones too).
- Before finishing (in `frontend/`): `npx tsc -b`, `npm test`, `npm run test:e2e`, `npm run build`.
  In the cloud sandbox (Nov 21) "plays the test song on Easy perfectly" grades B: its autoplay's
  presses land ~45 ms late there (on main too), so it's the sandbox, not the change; the intro test
  can time out under the full run's load and passes alone. Judge both on the dev box.
  On this Windows box run vitest from a path that starts with an upper-case `C:` (a lower-case
  `c:` working directory makes it load twice and every suite fails with "reading 'config'").
- Windows dev box: write multi-line scripts with the file tool, not shell heredocs (they break on
  quotes).
- OneDrive can lock `backend/target`, so `./mvnw test` here may reuse stale classes and pass where
  Render's Docker build (from scratch) fails to compile (Nov 20: an ambiguous `assertTrue` passed
  locally and broke the deploy). After changing Java, build a fresh copy outside OneDrive:
  `git archive HEAD backend src/java src/test | tar -x -C <temp dir>`, then `./mvnw -B test` there.
