# Ideas to add later

These are the future additions described in the project notes, collected here so they can be
considered independently of the current MVP.

## Done

- **Practice mode** (Nov 17): pick a part of a song on the start card, loop it, slow it to 50-100%;
  nothing is saved. See [README.md](../README.md#a-change-feature-not-in-the-mvp-practice-mode).
- **Overdrive** (Nov 17): a charge earned by accurate hits; Space sets it off. It changes scoring:
  +1 on the multiplier per level, stacked up to five levels (×10 with the combo's ×5), with its own
  look per level. See [README.md](../README.md#idea-overdrive-a-power-up-you-earn).
- **Durable song storage** (Nov 17): the backend keeps the song bank in Supabase when it's set up,
  taking in the existing JSON songs the first time. See [supabase.md](supabase.md) and
  [DATABASE.md](../DATABASE.md).

## Still to do

1. **Controller-backed play**: send play sessions and inputs through the Java `Main` controller,
   with the browser engine kept as an offline fallback (Next Steps 3-4 in the README; `Main` is
   Darsh's).

## Dropped

- **User accounts**: removed from the plan (Nov 17). Scores and favourites stay shared by the one
  song bank.
- **Multiplayer**: considered and dropped earlier.
