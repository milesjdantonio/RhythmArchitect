# Backend API contract

What the frontend expects from the backend. The types are in [frontend/src/api/types.ts](../frontend/src/api/types.ts);
[frontend/mock-server/api.ts](../frontend/mock-server/api.ts) implements all of it for local development.

Base URL: `VITE_API_BASE_URL` (empty means same origin). All bodies are JSON. Errors are
`{ "error": "message for the player" }` with a 4xx/5xx status; the UI shows the message as written.

## Songs

| Route | Body | Returns |
|---|---|---|
| `GET /api/songs` | | `{ songs: Song[] }` (not used by the app any more; kept for tools) |
| `GET /api/songs/:id` | | `Song` |
| `PATCH /api/songs/:id` | `{ title?, favorite? }` | `Song` |
| `DELETE /api/songs/:id` | | `204` (the dev tools' "Delete map") |
| `PUT /api/songs/:id/charts` | `{ charts, ladder }` | `Song`: a song the trained mapper charted before today's difficulty ladder, its four charts made again from its Ultra (the browser does it the first time it's opened: `upgrade.ts` `rethinSong`). 400 unless the ladder is newer than the song's and every tile is one of its Ultra's (same beat and lane; a hold no longer, or a tap); a difficulty whose chart changed loses its best. |
| `POST /api/songs/:id/scores` | `{ difficulty, score, accuracy, maxCombo, grade, run, play, tiles? }` | `Song` (plays + 1; `best[difficulty]` kept if higher). Autoplay runs are never sent. `play` is the controller's run id (`POST /api/play`): the score is kept only from a run the controller reviewed from start to end and passed ("Play" below), whose run is the one it confirmed, once. Otherwise nothing is counted: `422` (no such run: never played through the controller, or the server restarted during it; another song or difficulty, or practice; a different run than it confirmed; or the review flagged it: the answer says which check), `409` when that run's score was already kept. Without `run`: `400`. `run` is the run in order (`P` `G` `E` `L` a hit as `main.HitResult`, `M` a miss, `H<ms>;` a held note held its length, `B` one let go): the server checks it against the song's chart for that difficulty (the game's model: a `Queue` of `Note`s, so no more tiles judged than the chart has, no more holds ended than it has, no hold held longer than its holds, within 2 ms) and counts it again through `main.GameScore` (`Score` with the combo multiplier and the hold bonus), and keeps that score, accuracy, max combo and grade, marked `rules: "score"`; a best without it (the old points) gives way to any such run. A `run` that isn't one, or that the chart couldn't have given: 400 "Bad run" (no play counted). With a checked `run`, `tiles` (optional) is each tile's letter in the chart's own order (`P` `G` `E` `L` `M`, `-` not reached; the same judgements as the run's, one per tile): the song's `heat[difficulty]` then counts `runs` and, per tile, how often a run reached it (`seen`) and missed it (`miss`). `tiles` that don't fit are ignored (the play still counts); a chart that changes loses its heat. |
| `POST /api/songs/:id/feel` | `{ difficulty, play, feel, why? }` | `Song`: how the run felt, counted into `feel[difficulty]` (`right`, `off`, and per reason `notes` `timing` `hard` `easy`; counts only). `feel` is `"right"` or `"off"`; `why` (only with `"off"`) a list of those reasons. Only for a run whose score was kept (`play`: the controller's run id), once: `422` otherwise, `409` the second time; an answer it doesn't know: `400` (the run keeps its say). A chart that changes loses its feel. |

## Play (through the controller)

Every run (a practice loop too, each time round, as a run of just its stretch) also goes through
the game's controller, `main.Main`, on the server (`PlayController`). The controller reviews the
input and the model keeps the score: key presses go to `Main.processInput` (checked against the
song's queue of notes), the song's clock to `Main.checkMissedNotes`, and the run as the game judged
it (the tokens of `POST /api/songs/:id/scores`, a part at a time) is confirmed through the model
(`RunReplay`: checked against the chart's queue, counted through `GameScore`, the same rules as the
score at the top of the screen). Every answer is the model's state, which the run panel and the
results show.

Every input is reviewed before it reaches `Main` (`InputReview`; the mock's copy:
`mock-server/review.ts`). Turned down (its result `null`; it never reaches `Main`): an input that
isn't `{ lane, time }` or `{ time }` (a lane a whole number 0-3, a time a finite number of seconds
from 0, nothing else in it), one more than 0.35 s earlier than the latest time reviewed, one later
than 30 s after the last note, and the same lane again within 12 ms. Flagged (the run's score won't
be kept): a malformed input or one past the end, more than 20 out of order or 20 double presses
(a YouTube song's clock can step back a little when the video stalls), the song's clock running more than 3 s ahead of real time from the first
input (a run sent all at once), more than 40 presses in a second of song, and a judged run claiming
more hits (and stray presses) than there were presses near a note in their lane (within 0.3 s,
Main's widest window; 4 and 2% of slack). A client may start 30 runs a minute and have 12 going
(its oldest gives way), and a run takes 20 calls a second: `429` past either (the backend only). The game still judges each press at once in the browser; these go a quarter of a
second at a time.

| Route | Body | Returns |
|---|---|---|
| `POST /api/play` | `{ songId, difficulty, from?, to? }` | `201 { run, notes, state: PlayState }`: a `Main` on the song's model at that difficulty. With `from` and `to` (seconds: practice mode), only that stretch: the song's chart is replaced by `Song.getChartBetween` (400 when it doesn't start before it ends). `400` without a song id (or one that isn't an id: letters, digits, `-` and `_`, up to 120) or with an unknown difficulty, or when the model can't take the song; `404` for an unknown song; `429` past a client's 30 starts a minute. |
| `POST /api/play/:run/inputs` | `{ inputs: ({ lane, time } \| { time })[], run? }` (in order; at most 500; `run`: the judged run's tokens since the last call) | `{ results, state }`: one result per press (Main's `HitResult` name, or `null` when Main turned the input down: a lane out of 0-3, a time that isn't one or is negative), then the state. A time alone is the clock passing. `400` when `inputs` isn't a list or is too long, or the run's score was kept; `429` past 20 calls a second; `404` for a run that's over (runs live in memory: at most 300, none idle over an hour). |

`PlayState`: `{ confirmed: { score, accuracy (0-1), maxCombo } | null, reviewed, review: { passed, flags: { check, detail, count }[], refused }, score, combo, maxCombo, hits, misses, accuracy (0-100), time, left, upcoming: { lane, time }[] }`. `confirmed` is the run so far through `GameScore` (null once a part couldn't have been played on the chart: it stays refused); `reviewed` the presses `Main` took; `review` what the review flagged (each check, its first detail, how often) and how many inputs it turned down; the rest is `Main`'s own `Score` and queue.

## Search and favourites

| Route | Returns |
|---|---|
| `GET /api/search?title=&artist=` | `{ results: SongSummary[] }`: mapped songs matching what the player typed, best first, at most 8. Every filled-in field must match (case, accents and punctuation ignored). Called as the player types (debounced, earlier requests cancelled). |
| `GET /api/favorites?q=` | `{ results: SongSummary[] }`: the songs marked `favorite`, newest first; `q` filters by title or artist. |
| `GET /api/library` | `{ results: SongSummary[] }`: every mapped song, A to Z by title (then artist), case and accents ignored, numbers in order. The music bank. |

`SongSummary` is a song without its charts: `id, title, artist, bpm, lengthBeats, hues, source
{ kind, standIn? }, tiles { easy, medium, hard, ultra }, best, plays, favorite, cover?`.

## Mapping a song (it plays from YouTube)

| Route | Body | Returns |
|---|---|---|
| `GET /api/health` | | `{ ok: true, storage, database, problem? }`: the server is up; where the song bank is (`supabase`, `file`, or `starting`), the database (`not set up`, `connected`, `failing`) and, when failing, why in words. The app asks this when it opens; while there's no answer, the places waiting on the server say it's waking (a sleeping free server takes a while to start). |
| `GET /api/youtube?title=&artist=` | | `VideoMatch`: the video that plays the song (the best of the search below). `title` may be a YouTube link (no API key needed; checked with oEmbed). Searching by name needs `YOUTUBE_API_KEY` on the server (else `503` with a message saying so). `422` when the video can't be embedded. |
| `GET /api/youtube/search?title=&artist=` | | `{ results: VideoMatch[] }`: the videos that play the song, best first (at most 5), every one a song that can be played outside YouTube, for the player to preview and choose from, leaving out every video already in the bank (its song comes up in the song search; another song of the same name still does). A pasted link is that one video. The same errors as above; `404` when none fits. Each search by name is kept on the server for 6 hours (a search costs YouTube quota), and the app asks only once the typing pauses. |
| `POST /api/songs` | `NewSong` (a song the browser mapped by listening; `source.kind` must be `youtube`) | `201 Song`. Every tile at beat 0 or later and every hold with a length ("A bad tile in the … chart"), and the song must go into the game's model (`main.SongWriter` writes it as a `main.Song`; 400 "The game can't play this map: …" if not). |
| `POST /api/fan-chart` | `{ title, artist, videoId, seconds? }` | `201 Song`: a fan-made osu! chart of the song, lined up with the video, saved. `404` if there's none, or if it doesn't pass the same checks as `POST /api/songs`. |
| `PATCH /api/songs/:id` | `{ offset }` | `Song` with `source.offset` changed (the dev tools' Song sync). |

Nothing is ever composed or invented. The browser does the listening, because only it can hear
the embedded player: it shares its own tab's sound (`getDisplayMedia`), plays the video once,
files every captured sample under the video position it was heard at, and measures it with the
onset mapper (`frontend/src/mapping/automap.ts`): the beat grid and every sound, exact to a few ms. The audio
never leaves the page.

Then the AI charts it, also in the browser: a trained mapper (Ensomi R2, `frontend/src/mapping/ensomi.ts`)
reads the audio and places the tiles, and each difficulty keeps a subset of them; its tiles are
moved onto the sounds the onset mapper measured. If it can't (its model didn't download, or it
failed), the onset mapper's own charts (`frontend/src/mapping/charts.ts`) are used and
`report.mapper` says so. No AI runs on the server. Then the song is saved with `POST /api/songs`:
the charts, the report and `levels` (a loudness curve, three bands × 30 per second, one byte each).
When it can't listen (no tab audio, sharing declined, a phone), it asks for a fan chart instead.

`VideoMatch`: `{ videoId, title, channel, songTitle, songArtist, seconds?, thumbnail? }`
(`songTitle`/`songArtist` are what the song is filed under).

## What a mapped Song must contain

- `title`, `artist`, `prompt` (what the player asked for), `bpm`, `meter` (beats per bar), `key`,
  `scale`, `mood`, `lengthBeats`, `hues` (two hues that tint the UI for this song).
- `cover` (optional): a square album-art URL that allows cross-origin use. Without it the app shows
  a living cover (cover.riv) in the song's colours.
- `source`: `{ kind: 'stream', url, offset }` for real audio, where `offset` is the seconds into
  the audio at which beat 0 of the map lands. `{ kind: 'youtube', videoId, offset, chart, credit }`
  for a song that plays in YouTube's embedded player: `offset` is seconds into the video, `chart`
  is `listened` or `fan`, `credit` says where the tiles came from (a fan chart's author).
- `levels` (optional): the loudness curve of a YouTube song (see above). The app can't analyse a
  YouTube song while it plays, so the visuals read this instead (fan charts get one from their tiles). `{ kind: 'synth' }` means the app plays the map's
  melody itself; `standIn: true` marks a synth stand-in for a track that couldn't be streamed.
- `charts.easy|medium|hard|ultra`: `{ lanes: 4, notes: [{ t, lane, pitch, len, hold? }], stars? }` (`stars`: its
  osu!mania star rating, when the trained mapper made it; the server keeps it as given), each
  difficulty a step harder than the last (Ultra is the whole chart; a song saved before Ultra may
  have only `easy|medium|hard`, which the client upgrades: frontend/src/api/upgrade.ts), with times
  and lengths in beats. Two notes may share a `t` (a chord). A hold blocks its lane until it ends.
  **Every note must be a sound in the track, at the moment it is heard**: no filler tiles, nothing
  placed at random. `t` may be fractional beyond 16ths (exact attack times for unquantised audio).
  Holds are sounds that actually ring that long. Hitting a tile makes no sound in the app, so a
  tile that isn't in the music is felt immediately.
- `report`: `{ mapper, confidence (0..1), sections: [{ label, beat }], energy: number[48], cues? }`
  (shown in the dev tools).
  The visuals react to these on the beat: each section settles the backdrop into a new figure.
- `report.cues` (optional): moments the visuals should react to, `[{ beat, kind, strength? }]` with
  `kind` one of `build` (energy rising: things shake harder), `drop` (shockwaves, fountains, a flash
  of the song's colour), `break` (everything calms down), `flash` (one accent). When the mapper sends
  none, the app derives them from the section labels (a drop at each Chorus/Drop, a build 4 beats
  before it, a break at each Break/Bridge/Outro).
- `patch` and `backing`: the synth and the backing groove for synth songs, which play every note
  of all four charts themselves (`songMelody` in frontend/src/audio/playback.ts).

The app also analyses the playing audio live (bass, mids, highs), so every song moves the
backdrop and the stage even with no sections or cues at all.

Example map (trimmed):

```json
{
  "title": "Mr. Brightside", "artist": "The Killers", "bpm": 148, "meter": 4,
  "source": { "kind": "stream", "url": "https://cdn.example/tracks/123.mp3", "offset": 0.42 },
  "charts": {
    "easy":   { "lanes": 4, "notes": [{ "t": 0, "lane": 1, "pitch": "C5", "len": 1 }] },
    "medium": { "lanes": 4, "notes": [{ "t": 0, "lane": 1, "pitch": "C5", "len": 2, "hold": true }] },
    "hard":   { "lanes": 4, "notes": [{ "t": 0, "lane": 1, "pitch": "C5", "len": 0.5 }, { "t": 0.5, "lane": 3, "pitch": "A4", "len": 0.5 }] },
    "ultra":  { "lanes": 4, "notes": [{ "t": 0, "lane": 1, "pitch": "C5", "len": 0.5 }, { "t": 0, "lane": 3, "pitch": "A4", "len": 0.5 }] }
  },
  "report": {
    "mapper": "AI mapper v2", "confidence": 0.93,
    "sections": [{ "label": "Intro", "beat": 0 }, { "label": "Verse", "beat": 32 }, { "label": "Chorus", "beat": 96 }],
    "energy": [0.2, 0.25, "… 48 values …"],
    "cues": [{ "beat": 92, "kind": "build" }, { "beat": 96, "kind": "drop", "strength": 1 }]
  }
}
```

The audio at `source.url` must allow cross-origin fetches (the app decodes it with Web Audio).
