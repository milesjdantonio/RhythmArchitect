import { describe, expect, it, vi } from 'vitest';
import { FollowClock } from '../../src/audio/clock';
import { PROFILES, frameGate, gameProfile, isWebKit, setPerf } from '../../src/lib/perf';

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

  it("is A (WebGL) on Safari's engine even with WebGPU: its WebGPU draws the stage wrongly", () => {
    const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
    const iosChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1';
    const macChrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
    expect([safari, iosChrome, macChrome, edge].map((ua) => isWebKit(ua))).toEqual([true, true, false, false]);
    vi.stubGlobal('navigator', { gpu: {}, userAgent: safari });
    expect(gameProfile()).toBe('unified');
    vi.stubGlobal('navigator', { gpu: {}, userAgent: macChrome });
    expect(gameProfile()).toBe('webgpu');
    vi.unstubAllGlobals();
  });

  it('sets the note speed by difficulty and tempo', async () => {
    const { TRAVEL, fallTime, noteSpeed } = await import('../../src/game/engine');
    expect(fallTime('hard')).toBeCloseTo(TRAVEL.hard);
    expect(noteSpeed('easy')).toBeCloseTo(1);
    // Each difficulty falls faster than the last, by about the same step.
    const order = (['easy', 'medium', 'hard', 'ultra'] as const).map((d) => fallTime(d, 128));
    for (let i = 1; i < 4; i++) expect(order[i] / order[i - 1]).toBeGreaterThan(0.8), expect(order[i] / order[i - 1]).toBeLessThan(0.9);
    // Faster songs fall faster, part of the way, within limits.
    expect(fallTime('medium', 180)).toBeLessThan(fallTime('medium', 120));
    expect(fallTime('medium', 180)).toBeCloseTo(TRAVEL.medium * (120 / 180) ** 0.4);
    expect(fallTime('medium', 400)).toBeCloseTo(TRAVEL.medium * 0.8);
    expect(fallTime('medium', 40)).toBeCloseTo(TRAVEL.medium * 1.2);
  });
});
