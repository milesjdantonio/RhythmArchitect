// The dev tools' autoplay bot: off, or on, playing every note perfectly (the user, Nov 20: two
// options only; a "human" and a "sloppy" bot were dropped).

export type BotMode = 'off' | 'perfect';

/** When the bot presses (seconds from the note), whether it skips the note, and if it lets a hold go early. */
export function botPlan(_mode: BotMode, _idx: number) {
  return { skip: false, jitter: 0, early: false };
}
