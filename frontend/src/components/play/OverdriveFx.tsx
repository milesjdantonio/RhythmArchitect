import { forwardRef, useImperativeHandle, useRef } from 'react';
import { OVERDRIVE_LOOKS, OVERDRIVE_ROMAN, overdriveHue, overdriveSat, overdriveVars } from '../../game/overdrive';
import { OVERDRIVE_GRACE } from '../../game/score';

export interface OverdriveFxHandle {
  /** Overdrive went up to `level`: the edges flash in its colour. */
  levelUp(level: number): void;
  /** Overdrive ended (`broken`: by a miss): what it added (points), counted out on the right. */
  end(level: number, gain: number, broken?: boolean): void;
  /** A miss in the grace didn't end it: the countdown flashes. */
  held(): void;
  /** Back to nothing showing (a restart). */
  reset(): void;
}

interface Props {
  /** The charge is full and it can go up: the cue to press the key. `level`: Overdrive's level now. */
  ready: boolean;
  level: number;
  keyName: string;
  /** Seconds of Overdrive's grace left (misses forgiven), 0 when there's none. */
  safe: number;
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const WORD = 'Overdrive';
/** Where each letter falls when it breaks (x px, y px, degrees): fixed, so it reads the same each time. */
const FALL = [[-14, 70, -24], [6, 96, 18], [-4, 60, -10], [12, 110, 30], [-10, 84, -18], [8, 66, 12], [-6, 104, -30], [14, 78, 22], [-12, 92, -14]];

/**
 * Overdrive across the whole screen, over the stage and under the HUD. Each level up the screen's
 * edges flash in the level's colour (the middle, where the tiles fall, stays clear; the shockwaves
 * are the stage's, on its graphics thread: big rings here cost the page frames at the moment it
 * matters). From level 2, light streams down both sides. While the charge is full, a cue on the
 * right of the lanes calls for the key in the next level's colour; when it runs out, the points it
 * added are counted out there. When it ends, its name: broken by a miss, it slams in red and its
 * letters crack and fall away while the screen's sides flash red; run out, it dissolves upward in
 * the level's colour. Built once and kept: a level up or an end only restarts animations (transform
 * and opacity), so nothing new is laid out or painted in the middle of a song.
 */
export const OverdriveFx = forwardRef<OverdriveFxHandle, Props>(function OverdriveFx({ ready, level, keyName, safe }, ref) {
  const safeEl = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const tally = useRef<HTMLDivElement>(null);
  const tallyNum = useRef<HTMLSpanElement>(null);
  const tallyWord = useRef<HTMLSpanElement>(null);
  const lost = useRef<HTMLDivElement>(null);
  const lostSub = useRef<HTMLSpanElement>(null);
  const letters = useRef<(HTMLSpanElement | null)[]>([]);
  const edge = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    levelUp(lv) {
      const el = root.current;
      if (!el) return;
      el.style.setProperty('--fx', String(overdriveHue(lv, 1, 0)));
      el.style.setProperty('--fxs', `${overdriveSat(lv)}%`);
      el.dataset.level = String(lv);
      tally.current?.getAnimations().forEach((a) => a.cancel());
      if (reduced()) return;
      flash.current?.animate([{ opacity: 0 }, { opacity: Math.min(1, 0.3 + lv * 0.05), offset: 0.12 }, { opacity: 0 }], { duration: 480 + lv * 60, easing: 'ease-out' });
    },
    end(lv, gain, broken = false) {
      // Its name, lost (broken) or spent (run out).
      const box = lost.current;
      if (box) {
        box.style.setProperty('--fx', String(broken ? 352 : overdriveHue(lv || 1, 1, 0)));
        box.style.setProperty('--fxs', `${broken ? 100 : overdriveSat(lv || 1)}%`);
        box.classList.toggle('is-broken', broken);
        lostSub.current!.textContent = broken ? 'Lost' : 'Spent';
        [box, edge.current, lostSub.current, ...letters.current].forEach((el) => el?.getAnimations().forEach((a) => a.cancel()));
        if (reduced()) {
          box.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 1400 });
        } else if (broken) {
          // Slams in, shudders, holds, cracks: the letters fall away one after another, the line under them drops.
          box.animate([{ opacity: 0, transform: 'scale(1.25)' }, { opacity: 1, transform: 'scale(1)', offset: 0.08 },
            { opacity: 1, transform: 'translateX(-6px)', offset: 0.12 }, { opacity: 1, transform: 'translateX(5px)', offset: 0.16 },
            { opacity: 1, transform: 'none', offset: 0.2 }, { opacity: 1, transform: 'none', offset: 0.9 }, { opacity: 0, transform: 'none' }], { duration: 1600, easing: 'ease-out' });
          letters.current.forEach((el, i) => {
            const [x, y, r] = FALL[i % FALL.length];
            el?.animate([{ transform: 'none', opacity: 1 }, { transform: 'none', opacity: 1, offset: 0.34 + i * 0.025 },
              { transform: `translate(${x}px, ${y}px) rotate(${r}deg)`, opacity: 0 }], { duration: 1600, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)' });
          });
          lostSub.current?.animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none', offset: 0.12 },
            { opacity: 1, transform: 'none', offset: 0.6 }, { opacity: 0, transform: 'translateY(30px)' }], { duration: 1600, easing: 'ease-in' });
          edge.current?.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.1 }, { opacity: 0.35, offset: 0.35 }, { opacity: 0 }], { duration: 900, easing: 'ease-out' });
        } else {
          // Run out: it fades in and drifts up, letter by letter, into nothing.
          box.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 1500 });
          letters.current.forEach((el, i) => el?.animate([{ transform: 'translateY(6px)', opacity: 0 }, { transform: 'none', opacity: 1, offset: 0.15 },
            { transform: 'none', opacity: 1, offset: 0.4 + i * 0.03 }, { transform: 'translateY(-26px)', opacity: 0 }], { duration: 1500, easing: EASE }));
          lostSub.current?.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: 1500 });
        }
      }
      const t = tally.current;
      if (!t || gain <= 0) return;
      // Broken by a miss, it reads red; run out, in the level's colour.
      t.style.setProperty('--fx', String(broken ? 352 : overdriveHue(lv || 1, 1, 0)));
      t.style.setProperty('--fxs', `${broken ? 100 : overdriveSat(lv || 1)}%`);
      t.classList.toggle('is-broken', broken);
      tallyNum.current!.textContent = `+${Math.round(gain).toLocaleString()}`;
      tallyWord.current!.textContent = `${broken ? 'Broken by a miss' : 'Overdrive spent'}${lv ? ` · peak ${OVERDRIVE_ROMAN[lv]}` : ''}`;
      t.getAnimations().forEach((a) => a.cancel());
      t.animate([
        { opacity: 0, transform: 'translateX(40px) scale(0.96)' },
        { opacity: 1, transform: 'none', offset: 0.12 },
        { opacity: 1, transform: 'none', offset: 0.78 },
        { opacity: 0, transform: 'translateY(-24px)' },
      ], { duration: reduced() ? 1800 : 2200, easing: EASE });
    },
    held() {
      if (reduced()) return;
      safeEl.current?.animate([{ transform: 'scale(1.18)', filter: 'brightness(1.8)' }, { transform: 'none', filter: 'none' }], { duration: 420, easing: EASE });
    },
    reset() {
      for (const el of [flash.current, tally.current, lost.current, edge.current, lostSub.current, ...letters.current]) el?.getAnimations().forEach((a) => a.cancel());
    },
  }), []);

  // The cue names what pressing does now: start it, or take it up a level (the top can't be).
  const next = Math.min(OVERDRIVE_LOOKS.length - 1, level + 1);
  const cue = level ? `Overdrive ${OVERDRIVE_ROMAN[next]}` : 'Overdrive ready';
  return (
    <div ref={root} className="odfx" aria-hidden>
      <div ref={flash} className="odfx-flash" />
      <div ref={edge} className="odfx-lost-edge" />
      <div className="odfx-rails"><i /></div>
      <div className={`odfx-ready ${ready ? 'is-on' : ''} ${OVERDRIVE_LOOKS[next].prism ? 'is-prism' : ''}`} style={overdriveVars(next, 1, 0, ['--fx', '--fxs']) as React.CSSProperties}>
        <span className="odfx-ready-word">{cue}</span>
        <span className="odfx-ready-name">{OVERDRIVE_LOOKS[next].name}</span>
        <kbd>{keyName}</kbd>
      </div>
      {/* The grace: for a few seconds after each press a miss doesn't end Overdrive. */}
      <div ref={safeEl} className={`odfx-safe ${safe > 0 ? 'is-on' : ''}`}>
        <span className="odfx-safe-word">Misses forgiven</span>
        <span className="odfx-safe-num mono">{Math.ceil(safe)}s</span>
        <span className="odfx-safe-bar"><i style={{ transform: `scaleX(${Math.min(1, safe / OVERDRIVE_GRACE)})` }} /></span>
      </div>
      <div ref={lost} className="odfx-lost">
        <span className="odfx-lost-word">{[...WORD].map((c, i) => <span key={i} ref={(e) => { letters.current[i] = e; }}>{c}</span>)}</span>
        <span ref={lostSub} className="odfx-lost-sub">Lost</span>
      </div>
      <div ref={tally} className="odfx-tally">
        <span ref={tallyNum} className="odfx-tally-num mono">+0</span>
        <span ref={tallyWord} className="odfx-tally-word">Overdrive spent</span>
      </div>
    </div>
  );
});
