import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { Judgement } from '../game/engine';
import { RiveAnim, type RiveHandle } from '../rive/RiveAnim';
import { perf } from '../lib/perf';

export interface BurstHandle { fire(kind: Judgement): void }
export interface HoldHandle { start(): void; end(ok: boolean): void }

const STYLES = 5;

/** Picks a random style, never the same one twice in a row on the same pad. */
function nextStyle(last: number) {
  let v = Math.floor(Math.random() * STYLES);
  if (v === last) v = (v + 1 + Math.floor(Math.random() * (STYLES - 1))) % STYLES;
  return v;
}

/**
 * The hit.riv burst on one pad: five styles per judgement, chosen at random for every hit.
 * A CSS ring stands in if Rive can't load.
 */
export const HitBurst = forwardRef<BurstHandle, { style?: React.CSSProperties }>(function HitBurst({ style }, ref) {
  const rive = useRef<RiveHandle>(null);
  const last = useRef(-1);
  const [css, setCss] = useState<{ kind: Judgement; n: number } | null>(null);
  useImperativeHandle(ref, () => ({
    fire(kind) {
      if (rive.current?.ready) {
        if (kind !== 'miss') {
          last.current = nextStyle(last.current);
          rive.current.set('variant', last.current);
        }
        rive.current.fire(kind);
      } else {
        setCss((c) => ({ kind, n: (c?.n ?? 0) + 1 }));
      }
    },
  }));
  return (
    <RiveAnim ref={rive} src="hit" stateMachine="Hit" className="hit-burst" style={style} sleepy={perf().rive === 'sleep'}
      fallback={css ? <span key={css.n} className={`burst-css burst-${css.kind}`} /> : null} />
  );
});

/** The hold.riv loop on one pad while a long tile is held: five styles, then a bloom or a fizzle. */
export const HoldFx = forwardRef<HoldHandle, object>(function HoldFx(_props, ref) {
  const rive = useRef<RiveHandle>(null);
  const last = useRef(-1);
  const [css, setCss] = useState(false);
  useImperativeHandle(ref, () => ({
    start() {
      if (rive.current?.ready) {
        last.current = nextStyle(last.current);
        rive.current.set('variant', last.current);
        rive.current.stayAwake(true);
        rive.current.set('holding', true);
      } else setCss(true);
    },
    end(ok) {
      if (rive.current?.ready) {
        rive.current.stayAwake(false);
        rive.current.set('holding', false);
        rive.current.fire(ok ? 'done' : 'broken');
      } else setCss(false);
    },
  }));
  return <RiveAnim ref={rive} src="hold" stateMachine="Hold" className="hold-fx" sleepy={perf().rive === 'sleep'} fallback={css ? <span className="hold-css" /> : null} />;
});
