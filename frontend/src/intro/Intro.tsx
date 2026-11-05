import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { wakeAudio } from '../audio/playback';
import { KEYS, laneForCode } from '../game/engine';
import { bus } from '../lib/bus';
import { CHARGE_MS, FLIGHT_MS } from '../lib/entrance';
import { isCalm } from '../lib/settings';
import { RiveAnim, type RiveHandle } from '../rive/RiveAnim';
import { EASE_OUT } from '../lib/motion';
import type { WorldIntro } from './WorldIntro';

/** WebGL for the world; without it the intro falls back to its Rive art. */
const hasWebGL = () => {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
};
// The world (three.js) starts downloading as soon as the app loads, so it's there for the opening.
const worldChunk = typeof window !== 'undefined' && shouldShowIntroNow() && hasWebGL() ? import('./WorldIntro') : null;
function shouldShowIntroNow() {
  try { return sessionStorage.getItem('rythm-architect:intro') !== 'skip' && !new URLSearchParams(location.search).has('nointro'); } catch { return true; }
}

/** Tests and tools skip the intro with sessionStorage['rythm-architect:intro'] = 'skip'. */
const SKIP = 'rythm-architect:intro';

/** The intro plays every time the page loads (add ?nointro to the address to skip it). */
export function shouldShowIntro() {
  try {
    return sessionStorage.getItem(SKIP) !== 'skip' && !new URLSearchParams(location.search).has('nointro');
  } catch {
    return true;
  }
}

/**
 * The opening when the game starts: three seconds as it builds, then it waits for a click (the
 * click also lets the menu's music start). A world of light filling the screen (src/intro/
 * WorldIntro.ts, three.js), a planet that gathers out of scattered points under the stars, with
 * orbit rings and arcs of light flying between its continents; the title (wordmark.riv, the same
 * file as the menu's wordmark) gathers beneath it. The world doesn't follow the pointer (a soft light does); D F J K (or
 * arrows, 1-4) send a ripple of their colour across it, fire arcs and kick the title; a click, or
 * any other key, goes in. Without WebGL, intro.riv's orbit over four pillars stands in.
 *
 * The way in has two beats. The charge (CHARGE_MS): a ring of light opens where you clicked, the
 * world draws in and brightens, its rings spin up and every arc fires. Then the launch, one
 * continuous move into the menu, which is already mounted behind (App.tsx): a shockwave bursts
 * out of the world, the planet flies apart past the camera as it dives through, a flash, the veil
 * lifts, and the title flies along an arc to the menu's wordmark, shrinking as it goes, while the
 * panels build themselves around it. When it lands, both copies flash and the menu's copy takes over.
 */
export function Intro({ onEnter, onDone }: { onEnter: () => void; onDone: () => void }) {
  const rive = useRef<RiveHandle>(null);
  const word = useRef<RiveHandle>(null);
  const art = useRef<HTMLDivElement>(null);
  const light = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLDivElement>(null);
  const titleFly = useRef<HTMLDivElement>(null);
  const leavingRef = useRef(false);
  // idle → charge (just clicked) → leave (the burst and the flight to the menu)
  const [phase, setPhase] = useState<'idle' | 'charge' | 'leave'>('idle');
  // Where the click landed: the charge's ring of light opens there.
  const [spark, setSpark] = useState<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  // The title gathers once the orbit has formed.
  const [titleOn, setTitleOn] = useState(false);
  const [lit, setLit] = useState([0, 0, 0, 0]);
  // Where the pointer is: only the soft light follows it (the world and the art stay put).
  const pointer = useRef({ px: innerWidth / 2, py: innerHeight / 2 });
  const [useWorld, setUseWorld] = useState(() => !!worldChunk);
  // The opening's clock starts with the world's first frame (or at once without it).
  const [began, setBegan] = useState(() => !worldChunk);
  const worldHost = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const world = useRef<WorldIntro | null>(null);

  // While the opening plays, Rive draws at the screen's full rate (the menus cap it: RiveAnim).
  useEffect(() => {
    document.body.dataset.scene ??= 'intro';
    return () => { if (document.body.dataset.scene === 'intro') delete document.body.dataset.scene; };
  }, []);

  // The world: loaded in its own chunk (three.js), placed so the planet sits where the art was.
  useEffect(() => {
    if (!useWorld) return;
    let live = true;
    let off = () => {};
    (worldChunk ?? import('./WorldIntro')).then(({ WorldIntro }) => {
      if (!live || !worldHost.current) return;
      const w = new WorldIntro(worldHost.current);
      world.current = w;
      const place = () => {
        const r = stage.current?.getBoundingClientRect();
        // Big: about half the screen's height, its lower edge just under the top of the title.
        if (r) w.place((r.left + r.width / 2) / innerWidth, (r.top + r.height * 0.33) / innerHeight, Math.min(0.56, (r.height * 0.6) / innerHeight));
      };
      place();
      addEventListener('resize', place);
      off = () => removeEventListener('resize', place);
      if (isCalm()) { for (let i = 0; i < 200; i++) w.frame(); } else w.start();
      setBegan(true);
    }).catch(() => { if (live) { setUseWorld(false); setBegan(true); } });
    return () => { live = false; off(); world.current?.destroy(); world.current = null; };
  }, [useWorld]);

  useEffect(() => {
    if (!began) return;
    const a = setTimeout(() => setTitleOn(true), 1300);
    const b = setTimeout(() => setReady(true), 1500);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [began]);

  // The title's flight to the menu's wordmark: X and Y on separate elements with different
  // easings, so it lifts first and then sweeps across, an arc rather than a straight line.
  const fly = useCallback((): Promise<void> | null => {
    const from = title.current, inner = titleFly.current;
    const to = document.querySelector<HTMLElement>('.ai-wordmark');
    if (!from || !inner || !to) return null;
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    if (!a.width || !b.width || b.bottom < 0 || b.top > innerHeight) return null;
    const s = b.width / a.width;
    const opts = { duration: FLIGHT_MS, fill: 'forwards' as const };
    const x = from.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${(b.left - a.left).toFixed(1)}px)` }],
      { ...opts, easing: 'cubic-bezier(0.62, 0, 0.18, 1)' });
    inner.animate([{ transform: 'translateY(0) scale(1)' }, { transform: `translateY(${(b.top - a.top).toFixed(1)}px) scale(${s.toFixed(4)})` }],
      { ...opts, easing: 'cubic-bezier(0.4, 0, 0.12, 1)' });
    return x.finished.then(() => {}, () => {});
  }, []);

  // The launch: the world bursts and the menu comes in while the title flies to it.
  const launch = useCallback(() => {
    setPhase('leave');
    rive.current?.fire('go');
    word.current?.fire('flash');
    bus.emit('cue', { kind: 'drop', strength: 1 });
    // Measure before the menu re-renders, then let it start coming in on this same frame.
    const flight = isCalm() ? null : fly();
    onEnter();
    const land = () => {
      word.current?.fire('flash');
      bus.emit('beat', { downbeat: true });
      onDone();
    };
    if (flight) flight.then(land);
    else setTimeout(land, isCalm() ? 200 : 650);
  }, [fly, onEnter, onDone]);

  // The click (or a key): the charge, then the launch.
  const enter = useCallback((at?: { x: number; y: number }) => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    wakeAudio().catch(() => {}); // in the click itself, so the menu's music may play (built once the title lands)
    setTitleOn(true);
    rive.current?.fire('tap');
    if (isCalm()) { launch(); return; }
    const r = stage.current?.getBoundingClientRect();
    setSpark(at ?? (r ? { x: r.left + r.width / 2, y: r.top + r.height * 0.33 } : { x: innerWidth / 2, y: innerHeight / 2 }));
    setPhase('charge');
    world.current?.go();
    word.current?.fire('beat');
    bus.emit('hit', { judgement: 'perfect', x: 0.5 });
    setTimeout(launch, CHARGE_MS);
  }, [launch]);

  const lane = useCallback((l: number) => {
    if (leavingRef.current) return;
    rive.current?.fire(`lane${l}`);
    world.current?.pulse(l);
    word.current?.fire('beat');
    setLit((v) => v.map((n, i) => (i === l ? n + 1 : n)));
    bus.emit('hit', { judgement: 'perfect', x: 0.36 + l * 0.093 });
  }, []);

  // Keys: lanes light up; anything else goes in. Once on the way in, keys belong to the menu.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (leavingRef.current || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.code === 'Tab') return;
      const l = laneForCode(e.code);
      e.preventDefault();
      if (l >= 0) lane(l); else enter();
    };
    addEventListener('keydown', down);
    return () => removeEventListener('keydown', down);
  }, [enter, lane]);

  // A soft light follows the pointer.
  useEffect(() => {
    if (isCalm()) return;
    let raf = 0;
    const tick = () => {
      const P = pointer.current;
      if (light.current) light.current.style.transform = `translate(${P.px.toFixed(0)}px, ${P.py.toFixed(0)}px)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const move = (e: React.PointerEvent) => {
    if (leavingRef.current) return;
    const P = pointer.current;
    P.px = e.clientX;
    P.py = e.clientY;
  };

  return (
    <motion.div className={`intro${phase !== 'idle' ? ' is-charging' : ''}${phase === 'leave' ? ' is-leaving' : ''}`} role="dialog" aria-modal="true" aria-label="Rythm Architect"
      onPointerMove={move} onPointerDown={(e) => enter({ x: e.clientX, y: e.clientY })}
      initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.7, ease: EASE_OUT } }}
      exit={{ opacity: 0, transition: { delay: 0.2, duration: 0.16, ease: 'linear' } }}>
      <div className="intro-veil" aria-hidden />
      {useWorld && <div className="intro-world" ref={worldHost} aria-hidden />}
      <div className="intro-light" ref={light} aria-hidden />
      {spark && (
        <div className="intro-spark" style={{ left: spark.x, top: spark.y }} aria-hidden>
          <span className="is-a" /><span className="is-b" /><span className="is-core" />
        </div>
      )}
      <div className="intro-flash" aria-hidden />
      <div className="intro-stage" ref={stage}>
        <div className="intro-push">
          <div className="intro-art" ref={art}>
            {!useWorld && (
              <RiveAnim ref={rive} src="intro" stateMachine="Intro" className="intro-anim"
                fallback={<div className="intro-fallback"><span className="if-ring" /><span className="if-ring r2" /><span className="if-core" /></div>} />
            )}
          </div>
        </div>
        <div className="intro-title" ref={title}>
          <div className="intro-title-fly" ref={titleFly}>
            {titleOn && <RiveAnim ref={word} src="wordmark" stateMachine="Wordmark" className="intro-word" label="Rythm Architect"
              fallback={<span className="wordmark-fallback">Rythm<span>Architect</span></span>} />}
          </div>
        </div>
      </div>
      <div className={`intro-prompt ${ready ? 'is-ready' : ''}`}>
        <p className="intro-press">Click to start</p>
        <div className="intro-keys" aria-label="Lane keys">
          {KEYS.map((k, i) => <kbd key={`${k.code}-${lit[i]}`} className={lit[i] ? 'is-lit' : ''} style={{ '--i': i } as React.CSSProperties}>{k.label}</kbd>)}
        </div>
      </div>
      <button type="button" className="sr-only" onClick={() => enter()} autoFocus>Enter Rythm Architect</button>
    </motion.div>
  );
}
