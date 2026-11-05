import { describe, expect, it, vi } from 'vitest';
import { FollowClock } from '../../src/audio/clock';
import { PROFILES, frameGate, gameProfile, setPerf } from '../../src/lib/perf';

describe('the slewing video clock', () => {
  /** Plays 20 s with reports every 250 ms; returns the largest step between frames beyond real time, and the worst error. */
  const run = (skew = 0) => {
    let now = 0;
    const clock = new FollowClock(() => now);
    let last = Number.NaN, worstStep = 0, worstErr = 0;
    for (let ms = 0; ms <= 20_000; ms += 16) {
      now = ms;
      // The player's clock runs `skew` fast, so the follower has to keep correcting.
      const truth = (ms / 1000) * (1 + skew);
      const raw = Math.floor(truth * 4) / 4;
      const t = clock.read(raw, true);
      if (ms > 4000) {
        worstStep = Math.max(worstStep, Math.abs(t - last - 0.016));
        worstErr = Math.max(worstErr, Math.abs(t - (truth - 0.125)));
      }
      last = t;
    }
    return { worstStep, worstErr };
  };

  it('never steps (tiles move evenly) and still stays on the video', () => {
    const slew = run(0.01);
    expect(slew.worstStep).toBeLessThan(0.002);
    expect(slew.worstErr).toBeLessThan(0.15);
  });

  it('catches up a big error (a stale first report) within about a second, without a jump', () => {
    let now = 0;
    const clock = new FollowClock(() => now);
    clock.read(0, true); // anchored on a report 0.2 s behind the video
    let last = 0, worstStep = 0, errAt1500 = 1;
    for (let ms = 16; ms <= 3000; ms += 16) {
      now = ms;
      const video = ms / 1000 + 0.2;
      const t = clock.read(video, true); // exact reports: this measures the catch-up alone
      worstStep = Math.max(worstStep, Math.abs(t - last - 0.016));
      if (ms === 1504) errAt1500 = Math.abs(t - video);
      last = t;
    }
    expect(errAt1500).toBeLessThan(0.03);
    expect(worstStep).toBeLessThan(0.006); // at most 25% fast: a 16 ms frame moves 20 ms
  });

  it('settles without swinging past the video when read only once a second (frames held back)', () => {
    let now = 0;
    const clock = new FollowClock(() => now);
    clock.read(0, true); // 0.2 s behind the video
    const errs: number[] = [];
    for (let s = 1; s <= 8; s++) {
      now = s * 1000;
      const video = s + 0.2;
      errs.push(video - clock.read(video, true));
    }
    // The error shrinks every second and never changes sign (no swinging back and forth).
    for (let i = 1; i < errs.length; i++) {
      expect(Math.abs(errs[i])).toBeLessThan(Math.abs(errs[i - 1]) + 1e-9);
      expect(Math.sign(errs[i])).not.toBe(-Math.sign(errs[0]));
    }
    expect(Math.abs(errs[errs.length - 1])).toBeLessThan(0.01);
  });

  it('still jumps on a seek, and counts it', () => {
    let now = 0;
    const clock = new FollowClock(() => now);
    clock.read(0, true);
    now = 100;
    clock.read(0, true);
    now = 200;
    expect(clock.read(60, true)).toBe(60);
    expect(clock.snaps).toBe(1);
  });
});

describe('the 60 FPS cap', () => {
  /** Frames drawn in one second of a display at `hz`, with a little timestamp jitter. */
  const drawn = (hz: number) => {
    setPerf('unified', { fpsCap: 60 });
    let n = 0;
    for (let i = 1; i <= hz; i++) {
      const ts = 10_000 + (i * 1000) / hz + (i % 3 === 0 ? 0.4 : -0.3);
      if (frameGate(ts)) n++;
      // Another loop in the same display frame gets the same answer.
      expect(frameGate(ts)).toBe(frameGate(ts));
    }
    setPerf('unified');
    return n;
  };

  it('draws every frame of a 60 Hz screen, and about 60 of 120 or 144', () => {
    expect(drawn(60)).toBeGreaterThanOrEqual(59);
    expect(drawn(120)).toBeGreaterThanOrEqual(59);
    expect(drawn(120)).toBeLessThanOrEqual(61);
    expect(drawn(144)).toBeGreaterThanOrEqual(58);
    expect(drawn(144)).toBeLessThanOrEqual(61);
  });

  it('is off in the game: it draws at the full rate of the screen', () => {
    expect(PROFILES.unified.fpsCap).toBe(0);
    expect(PROFILES.webgpu.fpsCap).toBe(0);
    expect(frameGate(1)).toBe(true);
    expect(frameGate(2)).toBe(true);
  });
});

describe("the game's profile", () => {
  it('is B (WebGPU) where the browser has WebGPU, A (WebGL) where it has not', () => {
    vi.stubGlobal('navigator', { gpu: {} });
    expect(gameProfile()).toBe('webgpu');
    vi.stubGlobal('navigator', {});
    expect(gameProfile()).toBe('unified');
    vi.unstubAllGlobals();
  });

  it('keeps the note speed fixed at 0.85', async () => {
    const { NOTE_SPEED, TRAVEL, fallTime } = await import('../../src/game/engine');
    expect(NOTE_SPEED).toBe(0.85);
    expect(fallTime('hard')).toBeCloseTo(TRAVEL.hard / 0.85);
  });
});
