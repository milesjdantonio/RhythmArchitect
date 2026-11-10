# Rythm Architect backend (Java, Spring Boot)

The real backend for the game in `../frontend`. It implements the whole contract in
[../docs/api.md](../docs/api.md), the same routes the dev mock (`frontend/mock-server/`) answers:
songs, search, favourites, the music bank, the YouTube lookup, osu! fan charts and the AI charter.

## Run it

Needs Java 25 (Maven comes with the wrapper).

```bash
cd backend
./mvnw spring-boot:run          # http://localhost:8080   (Windows: mvnw.cmd spring-boot:run)
```

Then point the app at it (from `frontend/`, in `.env.local`):

```
VITE_API_BASE_URL=http://localhost:8080
```

and run `npm run dev` as usual. Open the app as `localhost`, not `127.0.0.1`.

`./mvnw test` runs the tests (every route against a fresh bank, the osu! port, the charter's
prompt and plan repair on `docs/samples/`).

## Settings (environment variables)

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on the AI charter (`POST /api/chart`). Without it the route answers 501 and the app uses its own charts. Server only: never put it in the app. |
| `YOUTUBE_API_KEY` | Lets Generate find a song's video by name. Pasted YouTube links need no key. |
| `PORT` | Port to listen on (8080). |
| `SONGS_FILE` | Where the song bank is kept (`.data/songs.json`). Seeded with the three built-in songs the first time. |
| `CORS_ORIGINS` | Pages allowed to call it (`http://localhost:*`). |
| `CHARTER_MODEL` / `CHARTER_EFFORT` | The charter's model (`claude-opus-5-5`) and effort (`high`). |
| `CHARTER_PER_HOUR` | AI charts each player may ask for per hour (20); the charter spends money. |

## How it's laid out

```
src/main/java/com/rhythmarchitect/backend/
  songs/    SongController (songs, scores, search, favourites, library), SongStore (the JSON bank),
            SongLists (search ranking, A to Z), NewSongCheck (what a mapped song must contain)
  sources/  SourceController (GET /api/youtube, POST /api/fan-chart), YouTubeService,
            FanChartService (osu! search and downloads), Http
  osu/      Osu: .osu parser and fan chart to song, a port of frontend/src/mapping/osu.ts
  chart/    ChartController (POST /api/chart: cache, rate limit), CharterConfig (sets up SongMapper)
  match/    Text (how names are compared), Matching (which video / fan chart is the song)
  web/      errors as { "error": "..." }, CORS
src/main/resources/seed/songs.json   the built-in songs (exported from frontend/mock-server/songs)

../src/java/main/   the game's own classes, package main, built into the backend (build-helper in pom.xml)
  SongMapper.java   the AI charter: everything that talks to Claude
  Song, Note, Queue, Node, Difficulty, NoteType, MusicNoteType, HitResult, EmptyQueueException
```

## The AI charter: SongMapper

Claude lives in [../src/java/main/SongMapper.java](../src/java/main/SongMapper.java); the backend's
`POST /api/chart` only adds the HTTP side (cache, rate limit, errors). It follows
[../docs/claude-backend.txt](../docs/claude-backend.txt). The browser sends what it measured
(the beat grid and every sound, no audio). `SongMapper.plan` asks Claude (official Java SDK,
`com.anthropic:anthropic-java`) to chart it, with:

- each difficulty split into stretches of the song (about 40 s of music for Hard, 80 s for Easy
  and Medium, on bar lines), all charted at once, one streamed call each: a whole song in one call
  took longer than the app waits (3 minutes);
- model `claude-opus-5-5`, effort `high` for Hard and `medium` for Easy and Medium, adaptive
  thinking (the model's default), 64K max tokens, a 165 s deadline for the whole plan;
- structured output, one JSON schema for every call: `notes` as one compact line
  (`12:1 15:2h 15:3`: sound id, lane, `h` for a hold), `follows`, and for Hard the relabelled
  `sections` and `cues` of its stretch;
- the system prompt and the song's sound table as a cached prefix: the first call starts alone
  and the rest start once it's under way, so they read the prefix from the cache;
- progress: with `Accept: application/x-ndjson`, `POST /api/chart` streams a line each time a
  stretch is charted, then the plan; the Generate dialog shows Easy, Medium and Hard being built;
- refusals handled: the server-side fallback (`fallbacks: "default"`, beta
  `server-side-fallback-2026-07-01`) and a check of `stop_reason` before reading the answer.

Each answer is repaired the way the browser would (unknown sounds and bad lanes dropped, at most two
notes per sound, holds only on sounds that ring) and a difficulty left nearly empty fails the plan,
so the app falls back to its own charts. Plans are cached by video and request; token use is logged.
`SongMapper.toSong(request, plan)` turns a plan into a `Song` with one `Queue<Note>` per difficulty.

The built-in songs come from the mock. After changing them (or re-mapping them with `npm run map`),
re-export the seed from `frontend/`: `node tools/export-seed.mjs`.
