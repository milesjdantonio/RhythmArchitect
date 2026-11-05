import { useEffect, useRef } from 'react';
import { attachMain, attachSky, attachWorker, workerSupported, type Backdrop } from './host';
import { isCalm, useSettings } from '../lib/settings';
import { perf } from '../lib/perf';
import './background.css';

/**
 * Whether the backdrop draws in a worker on 2D canvases (backdrop: 'worker', where supported).
 */
export const backdropInWorker = () => perf().backdrop === 'worker' && workerSupported();
/**
 * Whether the backdrop draws on the graphics chip in a worker (backdrop: 'stage', the game's
 * profiles): on the menus with the stage's sky shaders, and inside the 3D stage during play.
 */
export const backdropOnGpu = () => perf().backdrop === 'stage' && workerSupported();

/** Full-screen living backdrop: deep space where motes of light settle into cymatic figures, with
 * ribbons of light and a colour bloom that follow the music. On the main thread, or (perf
 * profiles) on its own thread; the parent remounts it (a key) when that choice changes. */
export function SynthBackground() {
  const root = useRef<HTMLDivElement>(null);
  const pulse = useRef<HTMLDivElement>(null);
  const vignette = useRef<HTMLDivElement>(null);
  const backdrop = useRef<Backdrop | null>(null);
  const { calm } = useSettings();
  const gpu = backdropOnGpu();

  useEffect(() => {
    const el = root.current!;
    // The canvases are made here, not by React: a canvas handed to a worker can't be handed over
    // again, and React's dev mode mounts every effect twice.
    const make = () => document.createElement('canvas');
    if (gpu) {
      // One canvas: the bloom and the vignette are drawn into it too.
      const sky = make();
      el.prepend(sky);
      const b = attachSky(sky, isCalm());
      backdrop.current = b;
      return () => { b.destroy(); backdrop.current = null; sky.remove(); };
    }
    const base = make(), sand = make(), ink = make();
    el.prepend(base, sand);
    pulse.current!.after(ink);
    const els = { base, sand, ink, pulse: pulse.current!, vignette: vignette.current! };
    const b = backdropInWorker() ? attachWorker(els, isCalm()) : attachMain(els, isCalm);
    backdrop.current = b;
    return () => { b.destroy(); backdrop.current = null; base.remove(); sand.remove(); ink.remove(); };
  }, [gpu]);

  useEffect(() => { backdrop.current?.setCalm(calm); }, [calm]);

  return (
    <div className={`synth-bg${gpu ? ' is-gpu' : ''}`} aria-hidden="true" ref={root}>
      {!gpu && <div className="synth-bg__pulse" ref={pulse} />}
      {!gpu && <div className="synth-bg__vignette" ref={vignette} />}
    </div>
  );
}
