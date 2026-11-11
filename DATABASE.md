# Database Decision and Migration Plan

**Status:** Decision recorded; implementation has not started.  
**Decision:** Use **Supabase PostgreSQL** as Rhythm Architect's database and keep the existing **Render** deployment for the Java Spring Boot backend.

## 1. Final decision

Rhythm Architect will use:

- **Supabase** to host the PostgreSQL database.
- **Render** to continue hosting the existing backend service.
- **The existing frontend and REST API** without an intentional API redesign as part of the database migration.

The backend will connect directly to Supabase PostgreSQL. Supabase is the database host; it does not replace the Java backend or require moving the application off Render.

### Why Supabase

- A managed PostgreSQL database with a visual dashboard.
- A free tier suitable for development and an early, small deployment.
- Room to add authentication and user-specific data later.
- PostgreSQL supports structured relational data as well as JSONB, which fits the current song/chart data model.
- AI coding tools can help build the schema and integration, while the database remains standard PostgreSQL.

The free plan's published limits have included **500 MB of database storage**, **1 GB file storage**, and **5 GB monthly egress**. Limits and plan terms can change, so verify the current [Supabase pricing page](https://supabase.com/pricing) before relying on them. Free projects may also pause after a period of inactivity.

## 2. Target architecture

```text
Browser / Frontend
       |
       | HTTP requests to existing API
       v
Render
Java Spring Boot backend
       |
       | PostgreSQL connection (server-side only)
       v
Supabase
PostgreSQL database
```

The frontend should continue calling the backend API. It should **not** connect directly to PostgreSQL or receive database credentials.

## 3. Current state

The backend currently uses a JSON-file-backed song store:

- `SongStore.java` loads and saves songs in a JSON file.
- `rythm.songs-file` / `SONGS_FILE` configures the file location.
- The API already exposes song listing, creation, retrieval, updates, deletion, search, favorites, library, and score-related operations.
- Song objects contain song metadata and chart data, along with fields such as `best`, `plays`, and `favorite`.
- The backend currently does not use a PostgreSQL driver or a database repository.

This means the main migration is a backend storage change. Preserve the existing API contract wherever practical so the frontend does not need a simultaneous rewrite.

**Important deployment consideration:** a normal Render service filesystem should not be treated as durable database storage. A JSON file can be lost when an instance is replaced unless persistent storage is deliberately configured. Moving persistent data to Supabase avoids relying on the backend container's local filesystem.

## 4. Data design direction

Use PostgreSQL tables for queryable records and **JSONB** for the larger, flexible song/chart payload.

A sensible initial design is:

### `songs`

| Column | Purpose |
| --- | --- |
| `id` | Stable primary key matching the existing song ID |
| `title` | Searchable song title |
| `artist` | Artist name |
| `created_at` | Creation timestamp |
| `song_data` | JSONB containing the complete song object, including charts and other flexible fields |

The exact indexed columns and constraints should be confirmed against the current Java models and API behavior during implementation. Avoid duplicating the same data in separate columns and JSONB unless there is a clear query or integrity reason.

### User-specific data — add when accounts are implemented

When Rhythm Architect has multiple users, personal data should belong to the user rather than be stored as shared song properties:

- `users` — account identity/profile data, linked to the chosen authentication provider.
- `scores` — user ID, song ID, difficulty, score, and timestamp (with an agreed rule for best score).
- `favorites` — user ID and song ID, with a unique constraint on the pair.

Do not make one user's favorites, best scores, or play history visible to every user. The current `favorite`, `best`, and `plays` fields are part of the existing single-library data shape; decide how to transition them when user accounts are designed. Do not silently reinterpret or discard existing values during the first migration.

## 5. Connection and security decisions

- Store the Supabase database connection string in **Render environment variables**, never in source control or frontend code.
- Use the Supabase **Session Pooler** connection for the long-running Spring Boot service when the Render environment needs IPv4 compatibility. Copy the exact connection details shown in the Supabase dashboard; do not guess the project host, username, or password.
- Use TLS/SSL as required by the connection details supplied by Supabase.
- Keep database credentials server-side. Never expose the database password, Supabase service-role key, or other privileged credentials to the browser.
- Use a dedicated database role with only the permissions the backend needs where practical.
- Do not commit real secrets in `.env`, application properties, logs, screenshots, or documentation.

## 6. Implementation plan

### Phase 1 — Create and configure Supabase

1. Create a Supabase project.
2. Choose a project region appropriate for the Render service's location.
3. Save the database password securely.
4. Open the Supabase database connection settings and select the Session Pooler connection details.
5. Add the connection settings to the Render backend service as environment variables.

Suggested environment variable names (the implementation may choose a different consistent convention):

- `DB_URL`
- `DB_USERNAME`
- `DB_PASSWORD`

Do not put actual values in this document or commit them to Git.

### Phase 2 — Add database support to Spring Boot

1. Add the PostgreSQL JDBC driver.
2. Add Spring JDBC (or another deliberately selected Spring persistence approach).
3. Configure the datasource from environment variables.
4. Add Flyway for versioned database schema migrations.
5. Create the initial `songs` table and indexes.

**Recommended implementation approach:** Spring JDBC / `JdbcTemplate` with PostgreSQL JSONB is a straightforward fit for the current JSON-heavy song model. JPA is possible, but is not required just to store and retrieve the existing song objects.

### Phase 3 — Replace the JSON-backed store

1. Introduce a repository layer between the existing song service/store logic and persistence.
2. Implement database-backed song loading, creation, updates, and deletion.
3. Preserve current API response shapes and behavior.
4. Preserve search, library, favorites, and score behavior.
5. Keep the JSON implementation available temporarily as a migration/import source, not as the production source of truth after cutover.

### Phase 4 — Migrate existing data safely

1. Locate the authoritative current `songs.json` data file.
2. Back it up before any migration.
3. Build an idempotent import process that preserves existing song IDs, metadata, charts, timestamps, and current score/favorite fields.
4. Run the import against the new database.
5. Compare imported song counts and representative song/chart payloads against the source.
6. Test the application against Supabase before switching production traffic.
7. Keep the backup until the new deployment has been verified.

Do not overwrite or discard the existing JSON data during the initial migration.

### Phase 5 — Deploy and verify on Render

1. Set the database environment variables on the Render backend service.
2. Deploy the backend with the database-backed repository.
3. Verify the service can connect to Supabase.
4. Test create, list, retrieve, update, delete, search, favorites, and score endpoints.
5. Restart/redeploy the Render service and verify data remains intact.
6. Check logs for connection failures and ensure no credentials are printed.
7. Confirm the frontend still works without needing a database-specific rewrite.

### Phase 6 — Future: user accounts

Treat multi-user support as a separate phase after the database migration is stable:

1. Choose and configure an authentication approach (Supabase Auth is an option).
2. Define how authenticated users are represented and verified by the Java backend.
3. Add user-specific scores, favorites, and play history.
4. Add authorization checks so users can only access or modify their own personal data.
5. Decide how legacy global `best`, `plays`, and `favorite` values should be handled.

Do not add account complexity to the first database migration unless it is required by a separate product decision.

## 7. Completion checklist

- [ ] Supabase project created.
- [ ] Render environment variables configured.
- [ ] PostgreSQL driver and persistence dependencies added.
- [ ] Flyway migration creates the schema.
- [ ] Existing song data backed up.
- [ ] Existing songs and charts imported and verified.
- [ ] Backend reads and writes through PostgreSQL.
- [ ] Existing API behavior passes tests.
- [ ] Render redeploy/restart confirms durable storage.
- [ ] No secrets committed to the repository.
- [ ] JSON-file storage is retired only after successful verification.

## 8. Reference links

- [Supabase pricing](https://supabase.com/pricing)
- [Supabase documentation](https://supabase.com/docs)
- [Supabase database connection strings](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase connection pooling](https://supabase.com/docs/guides/database/connecting-to-postgres#connection-poolers)
- [Render environment variables](https://render.com/docs/configure-environment-variables)
- [Render and Supabase PostgreSQL connection guide](https://render.com/articles/how-to-connect-a-render-service-to-supabase-postgres)

---

**Scope note:** This document records the selected architecture and migration plan. It does not mean a Supabase project has been created, the database has been migrated, or the Render service has been reconfigured.
