# Rythm Architect backend (Java, Spring Boot)

The real backend for the game in `../frontend`. It implements the whole contract in
[../docs/api.md](../docs/api.md), the same routes the dev mock (`frontend/mock-server/`) answers:
songs, search, favourites, the music bank, the YouTube lookup and osu! fan charts. (Beatmaps are
made in the browser: the trained mapper charts each song there, so the backend needs no AI.)

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

`./mvnw test` runs the tests (every route against a fresh bank, the osu! port, the song classes).

## Settings (environment variables)

| Variable | What it does |
|---|---|
| `YOUTUBE_API_KEY` | Lets Generate find a song's video by name. Pasted YouTube links need no key. |
| `PORT` | Port to listen on (8080). |
| `SONGS_FILE` | Where the song bank is kept (`.data/songs.json`). Seeded with the three built-in songs the first time. |
| `CORS_ORIGINS` | Pages allowed to call it (`http://localhost:*`). |

## How it's laid out

```
src/main/java/com/rhythmarchitect/backend/
  songs/    SongController (songs, scores, search, favourites, library), SongStore (the JSON bank),
            SongLists (search ranking, A to Z), NewSongCheck (what a mapped song must contain)
  sources/  SourceController (GET /api/youtube, POST /api/fan-chart), YouTubeService,
            FanChartService (osu! search and downloads), Http
  osu/      Osu: .osu parser and fan chart to song, a port of frontend/src/mapping/osu.ts
  match/    Text (how names are compared), Matching (which video / fan chart is the song)
  web/      errors as { "error": "..." }, CORS
src/main/resources/seed/songs.json   the built-in songs (exported from frontend/mock-server/songs)

../src/java/main/   the game's own classes, package main, built into the backend (build-helper in pom.xml):
  Song, Note, Queue, Node, Difficulty, NoteType, MusicNoteType, HitResult, EmptyQueueException
```

The built-in songs come from the mock. After changing them (or re-mapping them with `npm run map`),
re-export the seed from `frontend/`: `node tools/export-seed.mjs`.
