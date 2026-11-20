import { describe, expect, it } from 'vitest';
import { CARDS_BEFORE_WAIT, HEAVY_MS, LagWatch, READY_AHEAD, STRONG_AHEAD } from '../../src/game/lag';

describe('a YouTube song lagging (game/lag.ts)', () => {
  it('measures how far ahead the video has loaded and how fast it loads', () => {
    const w = new LagWatch();
    // A 200 s song at 30 s, 20% loaded (40 s), then 50 s two seconds later: 5 s of song a second.
    w.sample(0, 30, 0.2, 200);
    expect(w.ahead).toBe(10);
    expect(w.rate).toBeNull(); // not enough to tell yet
    w.sample(2000, 30, 0.25, 200);
    expect(w.ahead).toBe(20);
    expect(w.rate).toBeCloseTo(5);
    w.sample(4000, 31, 1, 200);
    expect(w.complete).toBe(true);
    expect(w.rate).toBeNull();
  });

  it('carries on once enough is loaded ahead; a long stall, or one soon after another, brings up the card', () => {
    const w = new LagWatch();
    w.sample(0, 60, 0.31, 200); // 2 s ahead
    w.startStall(0);
    expect(w.ready).toBe(false);
    expect(w.heavy(HEAVY_MS - 1)).toBe(false);
    expect(w.heavy(HEAVY_MS)).toBe(true);
    w.sample(1000, 60, (60 + READY_AHEAD) / 200, 200);
    expect(w.ready).toBe(true);
    w.endStall(1000);
    expect(w.heavy(1500)).toBe(false); // not stalled
    // Again ten seconds later: at once.
    w.startStall(11_000);
    expect(w.heavy(11_000)).toBe(true);
    expect(w.stalls).toBe(2);
  });

  it(`after ${CARDS_BEFORE_WAIT} cards, Continue waits for a strong connection`, () => {
    const w = new LagWatch();
    for (let i = 0; i < CARDS_BEFORE_WAIT; i++) w.showCard();
    w.sample(0, 50, 0.3, 200); // 10 s ahead
    w.sample(2000, 50, 0.31, 200); // 1 s of song a second: keeping up, barely
    expect(w.mustWait).toBe(true);
    w.sample(4000, 50, 0.3 + (STRONG_AHEAD + 2) / 200, 200);
    expect(w.ahead).toBeGreaterThanOrEqual(STRONG_AHEAD);
    expect(w.strong).toBe(true);
    expect(w.mustWait).toBe(false);
  });
});
