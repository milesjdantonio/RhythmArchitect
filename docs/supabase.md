# Keeping the song bank in Supabase

By default the Spring Boot backend keeps every song, favourite and best score in a JSON file
(`backend/.data/songs.json`). On Render that file lives on a disk that is wiped whenever the
service restarts or redeploys. With Supabase set up, the bank lives in a Postgres table instead
and survives restarts.

How it works (`backend/.../songs/SupabaseSongs.java`, used by `SongStore`):

- The backend talks to Supabase's REST API with a **secret key that stays on the server**. The
  browser never talks to Supabase, and the table has Row Level Security on with no policies, so
  the public keys can't read or write it.
- **First run (empty table):** the backend copies in what its JSON file has, or the built-in songs
  if there is no file. Nothing already mapped is lost.
- **After that:** each change (a new song, a favourite, a best score) sends only the songs that
  changed, and a deleted song is deleted from the table.
- **Supabase unreachable when the server starts:** the backend logs a warning and uses the JSON
  file for that run, so the game keeps working.
- **Neither variable set:** the JSON file, exactly as before.

The mock server (`npm run dev` without `VITE_API_BASE_URL`) always uses `frontend/.data/songs.json`.

## Set it up (about 5 minutes)

1. **Make a project.** Sign in at <https://supabase.com/dashboard>, click **New project**, name it
   (for example `rythm-architect`), set a database password (keep it; the app doesn't need it), and
   pick the region closest to where the backend runs (Render's region). The free plan is enough.
2. **Make the table.** In the project, open **SQL Editor**, paste all of
   [`docs/supabase.sql`](supabase.sql), and click **Run**. You should see "Success. No rows
   returned". **Table Editor** now lists `songs`.
3. **Copy the URL and the secret key.** Open **Project Settings**.
   - **Data API** (or **API**): copy the **Project URL**, like `https://abcdefghijkl.supabase.co`.
   - **API Keys**: copy a **secret** key (`sb_secret_...`; create one if none is listed). On older
     projects, the **service_role** key under *Legacy API keys* works too. Don't use the
     publishable or `anon` key: the table refuses it.
4. **Give them to the backend** as environment variables:

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | the Project URL |
   | `SUPABASE_SERVICE_KEY` | the secret key |
   | `SUPABASE_TABLE` | optional; `songs` by default |

   - **On your machine (PowerShell)**, from `backend/`:
     ```powershell
     $env:SUPABASE_URL = "https://abcdefghijkl.supabase.co"
     $env:SUPABASE_SERVICE_KEY = "sb_secret_..."
     .\mvnw spring-boot:run
     ```
     (Git Bash: `SUPABASE_URL=... SUPABASE_SERVICE_KEY=... ./mvnw spring-boot:run`.) In VS Code or
     IntelliJ, add them to the run configuration's environment instead.
   - **On Render:** the backend service → **Environment** → **Add Environment Variable**, add the
     two, then **Save, rebuild, and deploy**.
5. **Check it.** The backend's log says
   `Started the song bank in Supabase at https://... (table songs) with N songs (from ...)` the
   first time, and `Read N songs from Supabase` after that. In Supabase, **Table Editor → songs**
   shows a row per song. Favourite a song in the game, refresh the table, and its row's `data`
   has `"favorite": true`.

**Keep the secret key secret.** It bypasses Row Level Security. Put it only in the backend's
environment (never in `frontend/.env*`, never in a `VITE_` variable, never in git). If it leaks,
delete it in **API Keys** and make a new one.

## If something goes wrong

- **Check it from a browser:** open `https://<your backend>/api/health`. It answers at once:
  - `"database": "connected"` and `"storage": "supabase"`: songs and scores are saved in Supabase.
  - `"database": "failing"`, with a `"problem"` in plain words. Fix that problem; the backend tries
    Supabase again every minute, and the songs it kept in its own file meanwhile go up when it
    answers.
  - `"storage": "starting"`: the bank hasn't been read yet (a moment after the server wakes).
- **What the problems mean:**
  - "the publishable (anon) key": `SUPABASE_SERVICE_KEY` must be the secret key (`sb_secret_...`)
    or the legacy `service_role` key. The publishable key can't get past Row Level Security, so it
    reads an empty table and can't write.
  - "the songs table isn't there": step 2 wasn't run (or `SUPABASE_TABLE` names another table).
  - "permission denied": run all of `docs/supabase.sql` again (its `grant` lines). Projects set up
    not to expose new tables to the Data API need them.
  - "refused the key": the key is mistyped, deleted, or from another project.
  - "Couldn't connect": check the URL. It is `https://<ref>.supabase.co` (a URL pasted with
    `/rest/v1` on the end works too, but not the dashboard's URL).
- **Starting over:** in the SQL Editor run `truncate public.songs;`. The next start fills it again
  from the JSON file or the built-in songs.
- **Free projects pause after a week without use.** Open the dashboard and click **Restore**. Until
  then the backend falls back to its file (and changes made meanwhile stay in that file).
