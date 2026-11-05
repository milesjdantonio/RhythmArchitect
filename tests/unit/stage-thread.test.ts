import { afterEach, describe, expect, it, vi } from 'vitest';
import { setPerf } from '../../src/lib/perf';
import { ORDER, cancelFrame, nextFrame } from '../../src/lib/ticker';
import { packNote, unpackNote } from '../../src/stage/proxy';
import type { StageNote } from '../../src/stage/Stage3D';

describe('the stage worker\'s note state', () => {
  it('packs every judgement, hold and hold result into a byte and back', () => {
    const cases: Partial<StageNote>[] = [
      {}, { judged: 'perfect' }, { judged: 'great', holding: true }, { judged: 'good', holdResult: 'done' },
      { judged: 'miss', holdResult: 'broken' }, { judged: 'perfect', holding: true, holdResult: undefined },
    ];
    for (const c of cases) {
      const n: StageNote = { lane: 0, time: 1, end: 1, hold: true, ...c };
      const back: StageNote = { lane: 0, time: 1, end: 1, hold: true, judged: 'good', holding: true, holdResult: 'done' };
      unpackNote(back, packNote(n));
      expect([back.judged, !!back.holding, back.holdResult]).toEqual([n.judged, !!n.holding, n.holdResult]);
    }
  });
});

describe('the shared frame loop (option 6)', () => {
  // A fake animation frame the tests advance by hand.
  let frames: FrameRequestCallback[] = [];
  const tick = (ts: number) => { const f = frames; frames = []; f.forEach((cb) => cb(ts)); };
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  afterEach(() => { setPerf('classic'); frames = []; });

  it('runs every job on one frame, clock first and extras last, and skips cancelled ones', () => {
    setPerf('unified');
    const ran: string[] = [];
    nextFrame(() => ran.push('ui'), ORDER.ui);
    nextFrame(() => ran.push('game'), ORDER.game);
    const id = nextFrame(() => ran.push('cancelled'), ORDER.scene);
    nextFrame(() => ran.push('clock'), ORDER.clock);
    cancelFrame(id);
    expect(frames).toHaveLength(1); // one browser frame request for all of them
    tick(1000);
    expect(ran).toEqual(['clock', 'game', 'ui']);
  });

  it('is plain requestAnimationFrame in the previous build', () => {
    setPerf('classic');
    nextFrame(() => {}, ORDER.game);
    nextFrame(() => {}, ORDER.ui);
    expect(frames).toHaveLength(2);
  });
});
