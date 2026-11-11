import { forwardRef, memo, useImperativeHandle, useRef } from 'react';

export interface JudgeShow { lane: number; miss: boolean; perfect: boolean; hold: boolean; text: string; sub?: string; x: number; y: number; color?: string }
export interface JudgePoolHandle { show(j: JudgeShow): void; clear(): void }

const SIZE = 12;
// Only transform and opacity animate (no letter-spacing, no blur), so the compositor runs it
// without touching layout or paint.
const FRAMES: Keyframe[] = [
  { opacity: 0, transform: 'translate(-50%, -8px) scale(1.5)' },
  { opacity: 1, transform: 'translate(-50%, 0) scale(0.94)', offset: 0.14 },
  { opacity: 1, transform: 'translate(-50%, 2px) scale(1.04)', offset: 0.26 },
  { opacity: 1, transform: 'translate(-50%, 3px) scale(1)', offset: 0.38 },
  { opacity: 0, transform: 'translate(-50%, 14px) scale(1)' },
];

/**
 * Judgement words from a fixed pool of elements, written directly: a hit changes no React state,
 * adds no element and lays nothing out. One word per lane at a time.
 */
export const JudgePool = memo(forwardRef<JudgePoolHandle>(function JudgePool(_props, ref) {
  const els = useRef<(HTMLSpanElement | null)[]>([]);
  const next = useRef(0);
  const byLane = useRef<(HTMLSpanElement | null)[]>([null, null, null, null]);
  // Each word's running animation, kept here: asking an element for its animations
  // (getAnimations) makes the browser recompute styles first, on every hit.
  const anims = useRef(new Map<HTMLSpanElement, Animation>());
  const stop = (el: HTMLSpanElement) => { anims.current.get(el)?.cancel(); anims.current.delete(el); };

  useImperativeHandle(ref, () => ({
    show(j) {
      const prev = byLane.current[j.lane];
      if (prev) { stop(prev); prev.style.opacity = '0'; }
      const el = els.current[next.current];
      next.current = (next.current + 1) % SIZE;
      if (!el) return;
      stop(el);
      el.className = `judge judge-lean${j.miss ? ' judge-miss' : ''}${j.perfect ? ' judge-perfect' : ''}${j.hold ? ' judge-hold' : ''}`;
      (el.firstChild as Text).data = j.text;
      const small = el.lastChild as HTMLElement;
      small.textContent = j.sub ?? '';
      small.hidden = !j.sub;
      el.style.left = `${j.x}px`;
      el.style.top = `${j.y + 40}px`;
      el.style.color = j.color ?? '';
      el.style.opacity = '0';
      anims.current.set(el, el.animate(FRAMES, { duration: j.perfect ? 760 : 700, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }));
      byLane.current[j.lane] = el;
    },
    clear() {
      for (const el of els.current) { if (el) { stop(el); el.style.opacity = '0'; } }
    },
  }), []);

  return (
    <div className="popups" aria-hidden>
      {Array.from({ length: SIZE }, (_, i) => (
        <span key={i} ref={(el) => { els.current[i] = el; }} className="judge judge-lean" style={{ opacity: 0 }}>
          {' '}<small hidden />
        </span>
      ))}
    </div>
  );
}));
