import { describe, expect, it } from 'vitest';
import { InputReview, TOLERATED } from '../../mock-server/review';

// The mock's copy of the controller's review (backend InputReviewTests: the same cases).
const chart = (n: number) => Array.from({ length: n }, (_, i) => ({ lane: i % 4, time: i * 0.5 }));

describe("the controller's review of a run", () => {
  it('passes a run played in real time', () => {
    let wall = 0;
    const r = new InputReview(chart(40), () => wall);
    let run = '';
    for (let i = 0; i < 40; i++) {
      wall = i * 500;
      expect(r.review({ lane: i % 4, time: i * 0.5 + 0.01 })).toBeNull();
      expect(r.review({ time: i * 0.5 + 0.2 })).toBeNull();
      run += 'P';
    }
    r.reviewRun(run);
    expect(r.passed).toBe(true);
  });

  it('turns down malformed inputs, out of order, past the end and double presses', () => {
    const r = new InputReview(chart(8), () => 100_000);
    for (const bad of [[1, 2], { lane: 4, time: 1 }, { lane: 1.5, time: 1 }, { lane: '0', time: 1 }, { lane: 0, time: -1 }, { lane: 0 }, { time: '1' }, { lane: 0, time: 1, cheat: true }, null]) {
      expect(r.review(bad)).toBe('malformed');
    }
    expect(r.review({ time: 3 })).toBeNull();
    expect(r.review({ lane: 2, time: 2.8 })).toBeNull();
    expect(r.review({ lane: 1, time: 2 })).toBe('out of order');
    expect(r.review({ lane: 2, time: 2.805 })).toBe('double press');
    expect(r.review({ time: 40 })).toBe('past the end');
    expect(r.toJSON()).toMatchObject({ passed: false, refused: 12 });
    // Malformed and past the end flag the run; a step back or a double press now and then doesn't,
    // only when they keep coming.
    expect(r.toJSON().flags.map((f) => f.check)).toEqual(['malformed', 'past the end']);
    for (let i = 0; i < TOLERATED; i++) r.review({ lane: 1, time: 1 });
    expect(r.toJSON().flags.map((f) => f.check)).toEqual(['malformed', 'past the end', 'out of order']);
  });

  it("counts the end from the song's length when it runs on after its last note", () => {
    const r = new InputReview(chart(8), () => 1e9, 100);
    expect(r.review({ time: 120 })).toBeNull();
    expect(r.review({ time: 131 })).toBe('past the end');
  });

  it('flags a run faster than real time, more presses than hands make, and hits nobody pressed for', () => {
    let wall = 0;
    const fast = new InputReview(chart(400), () => wall);
    fast.review({ time: 0 });
    wall = 1000;
    fast.review({ time: 2 });
    expect(fast.passed).toBe(true);
    fast.review({ time: 150 });
    expect(fast.toJSON().flags[0].check).toBe('too fast');

    const mash = new InputReview(chart(8), () => 1e9);
    for (let i = 0; i < 60; i++) mash.review({ lane: i % 4, time: 1 + i * 0.015 });
    expect(mash.toJSON().flags[0].check).toBe('too many presses');

    const forged = new InputReview(chart(40), () => 1e9);
    for (let i = 0; i < 5; i++) forged.review({ lane: i % 4, time: i * 0.5 });
    forged.reviewRun('PPPPPMMM');
    expect(forged.passed).toBe(true);
    forged.reviewRun('P'.repeat(30));
    expect(forged.why()).toMatch(/^unpressed hits/);
  });
});
