// The dev tools' autoplay bot: how it plays each note. Deterministic per note (no randomness at
// run time), so a "human" or "sloppy" run misses the same notes every time.

export type BotMode = 'off' | 'perfect' | 'human' | 'sloppy';

/** When the bot presses (seconds from the note), whether it skips the note, and if it lets a hold go early. */
export function botPlan(mode: BotMode, idx: number) {
  if (mode === 'perfect') return { skip: false, jitter: 0, early: false };
  const r = ((idx * 2654435761) >>> 0) / 4294967296;
  const r2 = ((idx * 40503 + 7) % 97) / 97;
  if (mode === 'human') return { skip: r < 0.03, jitter: (r2 - 0.5) * 0.06, early: false };
  return { skip: r < 0.16, jitter: (r2 - 0.5) * 0.14, early: r > 0.75 };
}
