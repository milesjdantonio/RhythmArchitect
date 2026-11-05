import { useEffect, useRef, useState } from 'react';
import { KEYS } from '../game/engine';
import { bus } from '../lib/bus';
import { RiveAnim, type RiveHandle } from '../rive/RiveAnim';
import { FrameTrace } from './FrameTrace';

/**
 * What the gameplay side shows before a song is picked: the attract.riv loop (orbits of light
 * over four lanes where tiles fall and burst). It answers the player's typing: every key press
 * flares the core, and while there is text in the search the orbits speed up.
 */
export function AttractScreen({ state = 'idle' }: { state?: 'idle' | 'loading' | 'missing' }) {
  const rive = useRef<RiveHandle>(null);
  const [active, setActive] = useState(false);
  const [pulse, setPulse] = useState(0);
  useEffect(() => bus.on('typing', ({ length }) => {
    rive.current?.fire('pulse');
    setActive(length > 0);
    setPulse((n) => n + 1);
  }), []);

  return (
    <div className="attract" data-active={active || undefined}>
      <FrameTrace r={5} />
      <RiveAnim ref={rive} src="attract" stateMachine="Attract" inputs={{ active }} className="attract-anim"
        fallback={<AttractFallback pulse={pulse} />} />
      <div className="attract-copy">
        {state === 'missing' ? (
          <>
            <p className="attract-title">That map is gone</p>
            <p className="label">Name another song on the left</p>
          </>
        ) : state === 'loading' ? (
          <p className="attract-title">Loading the map</p>
        ) : (
          <>
            <p className="attract-title">Name a song to begin</p>
            <p className="label">Four lanes · Easy, Medium, Hard</p>
          </>
        )}
        <div className="attract-keys" aria-label="Keys">
          {KEYS.map((k, i) => <kbd key={k.code} style={{ '--i': i } as React.CSSProperties}>{k.label}</kbd>)}
        </div>
      </div>
    </div>
  );
}

/** Without Rive: rings of light turning over four lanes. */
function AttractFallback({ pulse }: { pulse: number }) {
  return (
    <div className="attract-fallback" aria-hidden>
      <span key={pulse} className="af-core" />
      <span className="af-ring r1" /><span className="af-ring r2" /><span className="af-ring r3" />
      <span className="af-lanes"><i /><i /><i /><i /></span>
    </div>
  );
}
