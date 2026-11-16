# Ideas to add later

These are the future additions already described in the project notes. They are collected here so
they can be considered independently of the current MVP.

1. **Practice mode** — pick a song section, loop it, and optionally slow it down without saving
   the practice run. The existing proposal is in [README.md](../README.md#A-change-feature-not-in-the-MVP-practice-mode).
2. **Overdrive** — earn a charge through accurate hits, then spend it for a temporary visual mode.
   Whether it affects score remains an open design choice. See [README.md](../README.md#idea-overdrive-a-power-up-you-earn).
3. **Controller-backed play** — send play sessions and inputs through the Java `Main` controller,
   with the browser engine retained as an offline fallback.
4. **Durable song storage** — move the deployed song bank from the ephemeral JSON file to a
   database, with a safe import of existing songs and charts.
5. **User accounts** — after durable storage is stable, add per-user scores, favourites, and play
   history with backend authorization checks.

Multiplayer was considered and explicitly dropped from the current scope. It is not included as a
planned addition here.
