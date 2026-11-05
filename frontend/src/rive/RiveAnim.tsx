// Mounts a generated .riv file (public/rive/) on a canvas over fallback content. If the runtime
// or the file fails, the fallback stays and nothing else breaks (same contract as TerraSim's
// js/rive.js). With reduced motion the animation settles and pauses after each change.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Alignment, Fit, Layout, Rive, RuntimeLoader, type StateMachineInput } from '@rive-app/canvas';
import wasmUrl from '@rive-app/canvas/rive.wasm?url';
import { MENU_FPS } from '../lib/perf';
import { isCalm } from '../lib/settings';

RuntimeLoader.setWasmUrl(wasmUrl);
Rive.suppressDeprecationWarnings = ['default-state-machine', 'state-machine-inputs', 'state-machines-param'];

/**
 * On the menus Rive draws at most MENU_FPS (perf.ts). Its runtime schedules every animation's
 * frames through one function; that function is wrapped here so a request is carried to a later
 * frame until the cap allows one. Animations keep their speed (Rive advances by the time passed).
 * Gameplay (body[data-scene=play]) and the intro (data-scene=intro) draw at the screen's rate.
 */
RuntimeLoader.awaitInstance().then((runtime) => {
  const rt = runtime as unknown as { requestAnimationFrame(cb: FrameRequestCallback): number; cancelAnimationFrame(id: number): void };
  const request = rt.requestAnimationFrame.bind(rt), cancel = rt.cancelAnimationFrame.bind(rt);
  const live = new Map<number, number>(); // our request → the runtime's request for it now
  const iv = 1000 / MENU_FPS;
  let nextId = 0, lastTs = Number.NaN, lastOk = true, slot = Number.NaN;
  // The same slots as perf.ts frameGate: all animations draw on the same frames.
  const allow = (ts: number) => {
    if (ts === lastTs) return lastOk;
    lastTs = ts;
    const scene = document.body.dataset.scene;
    if (scene === 'play' || scene === 'intro') { slot = Number.NaN; return (lastOk = true); }
    if (!(ts - slot <= iv && slot - ts <= iv * 2)) slot = ts;
    if (ts < slot - 1.5) return (lastOk = false);
    slot += iv;
    return (lastOk = true);
  };
  rt.requestAnimationFrame = (cb) => {
    const id = ++nextId;
    const go = (ts: number) => {
      if (!allow(ts)) { live.set(id, request(go)); return; }
      live.delete(id);
      cb(ts);
    };
    live.set(id, request(go));
    return id;
  };
  rt.cancelAnimationFrame = (id) => {
    const c = live.get(id);
    if (c !== undefined) { cancel(c); live.delete(id); }
  };
}).catch(() => { /* no runtime: the fallbacks show */ });

export type RiveFile = 'intro' | 'attract' | 'cover' | 'logo' | 'wordmark' | 'composing' | 'hit' | 'hold' | 'combo' | 'result' | 'difficulty' | 'cassette';

export interface RiveHandle {
  fire(name: string): void;
  set(name: string, value: number | boolean): void;
  readonly ready: boolean;
  /** Sleepy slots: keep drawing while `on` (a hold), then settle and sleep. */
  stayAwake(on: boolean): void;
}

interface Props {
  src: RiveFile;
  stateMachine: string;
  artboard?: string;
  /** Inputs to keep in sync with props (numbers and booleans). */
  inputs?: Record<string, number | boolean>;
  fit?: 'contain' | 'cover';
  className?: string;
  style?: CSSProperties;
  /** Shown until the animation loads, and instead of it if loading fails. */
  fallback?: ReactNode;
  label?: string;
  /** Pause while idle and wake on each input (saves a canvas redraw every frame). */
  sleepy?: boolean;
}

export const RiveAnim = forwardRef<RiveHandle, Props>(function RiveAnim(
  { src, stateMachine, artboard, inputs, fit = 'contain', className = '', style, fallback, label, sleepy = false }, ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const rive = useRef<Rive | null>(null);
  const machineInputs = useRef<Record<string, StateMachineInput>>({});
  const ready = useRef(false);
  // Kept in React state (not classList) so a changing className can't wipe them.
  const [status, setStatus] = useState<'' | 'has-rive' | 'rive-failed'>('');
  const latest = useRef(inputs);
  latest.current = inputs;

  const sleepyRef = useRef(sleepy);
  sleepyRef.current = sleepy;
  const awake = useRef(false);
  const sleepTimer = useRef(0);

  const wake = () => {
    const r = rive.current;
    if (!r) return;
    if (sleepyRef.current && !isCalm()) {
      r.play(stateMachine);
      window.clearTimeout(sleepTimer.current);
      if (!awake.current) sleepTimer.current = window.setTimeout(() => { if (!awake.current) r.pause(stateMachine); }, 1400);
      return;
    }
    if (!isCalm()) return;
    r.play(stateMachine);
    window.setTimeout(() => r.pause(stateMachine), 1400);
  };

  useImperativeHandle(ref, () => ({
    fire(name) { machineInputs.current[name]?.fire(); wake(); },
    set(name, value) {
      const i = machineInputs.current[name];
      if (i) { i.value = value; wake(); }
    },
    get ready() { return ready.current; },
    stayAwake(on) { awake.current = on; wake(); },
  }), [stateMachine]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    let r: Rive | null = null;
    let disposed = false;
    try {
      r = new Rive({
        src: `/rive/${src}.riv`,
        canvas,
        artboard,
        stateMachines: stateMachine,
        autoplay: true,
        layout: new Layout({ fit: fit === 'cover' ? Fit.Cover : Fit.Contain, alignment: Alignment.Center }),
        onLoad: () => {
          if (disposed || !r) return;
          el.prepend(canvas);
          setStatus('has-rive');
          r.resizeDrawingSurfaceToCanvas();
          machineInputs.current = {};
          for (const i of r.stateMachineInputs(stateMachine) ?? []) machineInputs.current[i.name] = i;
          for (const [k, v] of Object.entries(latest.current ?? {})) {
            const i = machineInputs.current[k];
            if (i) i.value = v;
          }
          ready.current = true;
          if (isCalm() || sleepyRef.current) window.setTimeout(() => { if (!disposed && !awake.current) r?.pause(stateMachine); }, 1600);
        },
        onLoadError: () => { if (!disposed) setStatus('rive-failed'); },
      });
    } catch {
      setStatus('rive-failed');
    }
    rive.current = r;
    const ro = new ResizeObserver(() => { try { r?.resizeDrawingSurfaceToCanvas(); } catch { /* not loaded */ } });
    ro.observe(el);
    // Stop drawing while off screen.
    const io = new IntersectionObserver(([e]) => {
      if (!r || !ready.current || isCalm()) return;
      if (e.isIntersecting) { if (!sleepyRef.current) r.play(stateMachine); } else r.pause(stateMachine);
    });
    io.observe(el);
    return () => {
      disposed = true;
      window.clearTimeout(sleepTimer.current);
      ro.disconnect();
      io.disconnect();
      ready.current = false;
      try { r?.cleanup(); } catch { /* already gone */ }
      canvas.remove();
      setStatus('');
      rive.current = null;
    };
  }, [src, stateMachine, artboard, fit]);

  // Keep number/boolean inputs in sync with props.
  useEffect(() => {
    if (!inputs) return;
    let changed = false;
    for (const [k, v] of Object.entries(inputs)) {
      const i = machineInputs.current[k];
      if (i && i.value !== v) { i.value = v; changed = true; }
    }
    if (changed) wake();
  });

  return (
    <div ref={host} className={`rive-slot ${className}${status ? ` ${status}` : ''}`} style={style} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <div className="rive-fallback">{fallback}</div>
    </div>
  );
});
