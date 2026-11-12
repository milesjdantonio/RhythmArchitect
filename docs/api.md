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
| `POST /api/songs/:id/scores` | `{ difficulty, score, accuracy, maxCombo, grade, run? }` | `Song` (plays + 1; `best[difficulty]` kept if higher). Autoplay runs are never sent. `run` is the run in order (`P` `G` `E` `L` a hit as `main.HitResult`, `M` a miss, `H<ms>;` a held note held its length, `B` one let go): the server checks it against the song's chart for that difficulty (the game's model: a `Queue` of `Note`s, so no more tiles judged than the chart has, no more holds ended than it has, no hold held longer than its holds, within 2 ms) and counts it again through `main.GameScore` (`Score` with the combo multiplier and the hold bonus), and keeps that score, accuracy, max combo and grade, marked `rules: "score"`; a best without it (the old points) gives way to any such run. A `run` that isn't one, or that the chart couldn't have given: 400 "Bad run" (no play counted). |

## Search and favourites

| Route | Returns |
|---|---|
| `GET /api/search?title=&artist=` | `{ results: SongSummary[] }`: mapped songs matching what the player typed, best first, at most 8. Every filled-in field must match (case, accents and punctuation ignored). Called as the player types (debounced, earlier requests cancelled). |
| `GET /api/favorites?q=` | `{ results: SongSummary[] }`: the songs marked `favorite`, newest first; `q` filters by title or artist. |
| `GET /api/library` | `{ results: SongSummary[] }`: every mapped song, A to Z by title (then artist), case and accents ignored, numbers in order. The music bank. |

`SongSummary` is a song without its charts: `id, title, artist, bpm, lengthBeats, hues, source
{ kind, standIn? }, tiles { easy, medium, hard }, best, plays, favorite, cover?`.

## Mapping a song (it plays from YouTube)

| Route | Body | Returns |
|---|---|---|
| `GET /api/youtube?title=&artist=` | | `VideoMatch`: the video that plays the song. `title` may be a YouTube link (no API key needed; checked with oEmbed). Searching by name needs `YOUTUBE_API_KEY` on the server (else `503` with a message saying so). `422` when the video can't be embedded. |
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
- `charts.easy|medium|hard`: `{ lanes: 4, notes: [{ t, lane, pitch, len, hold? }] }`, with times
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
  of all three charts themselves (`songMelody` in frontend/src/audio/playback.ts).

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
    "hard":   { "lanes": 4, "notes": [{ "t": 0, "lane": 1, "pitch": "C5", "len": 0.5 }, { "t": 0, "lane": 3, "pitch": "A4", "len": 0.5 }] }
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
