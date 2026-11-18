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

/**
 * Overdrive across the whole screen, over the stage and under the HUD. Each level up the screen's
 * edges flash in the level's colour (the middle, where the tiles fall, stays clear; the shockwaves
 * are the stage's, on its graphics thread: big rings here cost the page frames at the moment it
 * matters). From level 2, light streams down both sides. While the charge is full, a cue on the
 * right of the lanes calls for the key in the next level's colour; when it runs out, the points it
 * added are counted out there. Built once and kept: a level up only restarts an animation (opacity),
 * so nothing new is laid out or painted in the middle of a song.
 */
export const OverdriveFx = forwardRef<OverdriveFxHandle, Props>(function OverdriveFx({ ready, level, keyName, safe }, ref) {
  const safeEl = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const tally = useRef<HTMLDivElement>(null);
  const tallyNum = useRef<HTMLSpanElement>(null);
  const tallyWord = useRef<HTMLSpanElement>(null);

  useImperativeHandle(ref, () => ({
    levelUp(lv) {
      const el = root.current;
      if (!el) return;
      el.style.setProperty('--fx', String(overdriveHue(lv, 1, 0)));
      el.style.setProperty('--fxs', `${overdriveSat(lv)}%`);
      el.dataset.level = String(lv);
      tally.current?.getAnimations().forEach((a) => a.cancel());
      if (reduced()) return;
      flash.current?.animate([{ opacity: 0 }, { opacity: Math.min(1, 0.55 + lv * 0.09), offset: 0.12 }, { opacity: 0 }], { duration: 480 + lv * 60, easing: 'ease-out' });
    },
    end(lv, gain, broken = false) {
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
      for (const el of [flash.current, tally.current]) el?.getAnimations().forEach((a) => a.cancel());
    },
  }), []);

  // The cue names what pressing does now: start it, or take it up a level (the top can't be).
  const next = Math.min(OVERDRIVE_LOOKS.length - 1, level + 1);
  const cue = level ? `Overdrive ${OVERDRIVE_ROMAN[next]}` : 'Overdrive ready';
  return (
    <div ref={root} className="odfx" aria-hidden>
      <div ref={flash} className="odfx-flash" />
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
      <div ref={tally} className="odfx-tally">
        <span ref={tallyNum} className="odfx-tally-num mono">+0</span>
        <span ref={tallyWord} className="odfx-tally-word">Overdrive spent</span>
      </div>
    </div>
  );
});
