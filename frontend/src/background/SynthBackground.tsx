import { useEffect, useRef } from 'react';
import { attachMain, attachSky, workerSupported, type Backdrop } from './host';
import { isQuiet, useQuiet } from '../lib/quiet';
import { isCalm, useSettings } from '../lib/settings';
import '../styles/background.css';

/**
 * Full-screen living backdrop: deep space where motes of light settle into cymatic figures, with
 * ribbons of light and a colour bloom that follow the music. Drawn on the graphics chip in a
 * worker with the stage's sky shaders where the browser can (inside the 3D stage during play);
 * otherwise on 2D canvases on the main thread.
 */
export function SynthBackground() {
  const root = useRef<HTMLDivElement>(null);
  const pulse = useRef<HTMLDivElement>(null);
  const vignette = useRef<HTMLDivElement>(null);
  const backdrop = useRef<Backdrop | null>(null);
  const { calm } = useSettings();
  // Behind the Generate dialog the sky holds still, as when calm: the dialog has its own light,
  // and the listening pass needs the graphics chip for the video and the capture (lib/quiet.ts).
  const quiet = useQuiet();
  const still = () => isCalm() || isQuiet();
  const gpu = workerSupported();

  useEffect(() => {
    const el = root.current!;
    // The canvases are made here, not by React: a canvas handed to a worker can't be handed over
    // again, and React's dev mode mounts every effect twice.
    const make = () => document.createElement('canvas');
    if (gpu) {
      // One canvas: the bloom and the vignette are drawn into it too.
      const sky = make();
      el.prepend(sky);
      const b = attachSky(sky, still());
      backdrop.current = b;
      return () => { b.destroy(); backdrop.current = null; sky.remove(); };
    }
    const base = make(), sand = make(), ink = make();
    el.prepend(base, sand);
    pulse.current!.after(ink);
    const els = { base, sand, ink, pulse: pulse.current!, vignette: vignette.current! };
    const b = attachMain(els, still);
    backdrop.current = b;
    return () => { b.destroy(); backdrop.current = null; base.remove(); sand.remove(); ink.remove(); };
  }, [gpu]);

  useEffect(() => { backdrop.current?.setCalm(calm || quiet); }, [calm, quiet]);

  return (
    <div className={`synth-bg${gpu ? ' is-gpu' : ''}`} aria-hidden="true" ref={root}>
      {!gpu && <div className="synth-bg__pulse" ref={pulse} />}
      {!gpu && <div className="synth-bg__vignette" ref={vignette} />}
    </div>
  );
}
