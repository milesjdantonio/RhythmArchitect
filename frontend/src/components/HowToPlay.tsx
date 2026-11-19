// How to play: a dialog of short topics, each with a moving diagram (the lanes, a hold, the timing
// windows, the combo, Overdrive, the signal, the four difficulties, practice). Opened from the
// menu's ? button and the start card (openHowToPlay); mounted once, in App.
//
// The diagrams loop on the Web Animations API (transforms and opacity only, so they cost the page
// next to nothing), only the open topic's run, and Calm visuals (or the system's reduced motion)
// shows each one still, at a telling moment. Every number comes from the game's own rules.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Difficulty } from '../api/types';
import { DIFFICULTIES } from '../api/types';
import { laneHue } from '../game/render';
import { HIT_WINDOWS, fallTime, noteSpeed, OVERDRIVE_GRACE, OVERDRIVE_LENGTH, MAX_OVERDRIVE } from '../game/engine';
import { HOLD_CHARGE, MAX_COMBO_MULTIPLIER, PERFECTS_TO_CHARGE } from '../game/score';
import { OVERDRIVE_LOOKS } from '../game/overdrive';
import { keyLabel, laneKeyList, useBinds } from '../lib/keys';
import { isCalm } from '../lib/settings';
import { Icon } from './Icon';

// ---- Opening it from anywhere --------------------------------------------------------------

let open = false;
const listeners = new Set<() => void>();
const setOpen = (v: boolean) => { open = v; listeners.forEach((l) => l()); };
/** Opens How to play (the menu's ? button, the start card). */
export const openHowToPlay = () => setOpen(true);
const useOpen = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => open);

// ---- The diagrams' clock -------------------------------------------------------------------

/** A keyframe at a time (seconds into the loop). */
type At = [number, Keyframe];

/**
 * Loops `frames` on `el`: `loop` seconds long, its time 0 at `start` seconds into the loop. Still
 * (calm): paused at `still` seconds instead.
 */
function play(el: Element | null | undefined, frames: At[], loop: number, start: number, still: number | null, out: Animation[]) {
  if (!el || typeof el.animate !== 'function') return;
  const kf = frames.map(([t, k]) => ({ ...k, offset: Math.min(1, Math.max(0, t / loop)) }));
  const s = ((start % loop) + loop) % loop;
  const a = el.animate(kf, { duration: loop * 1000, iterations: Infinity, delay: (s - loop) * 1000, fill: 'both' });
  if (still !== null) { a.pause(); a.currentTime = (still % loop) * 1000; }
  out.push(a);
}

/** Runs `setup` (it adds its animations to the list) while mounted; cancels them after. */
function useLoops(setup: (out: Animation[], still: number | null) => void, deps: unknown[], stillAt: number) {
  useLayoutEffect(() => {
    const out: Animation[] = [];
    setup(out, isCalm() ? stillAt : null);
    return () => out.forEach((a) => a.cancel());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const HOUSE: [number, number] = [196, 272];
const hueOf = (lane: number) => laneHue(lane, 4, HOUSE);

// ---- Lanes: tiles falling to the line, keys lighting as they're hit ------------------------

interface DemoTile { lane: number; at: number; len?: number; judge?: string; miss?: boolean }

/**
 * Four lanes and the hit line: each tile falls for `fall` seconds and reaches the line at `at`,
 * its key lights (held for a hold's length) and a ring bursts. Loops every `loop` seconds.
 */
function Lanes({ tiles, loop, fall, still, small = false, hues }: {
  tiles: DemoTile[]; loop: number; fall: number; still: number; small?: boolean; hues?: (lane: number) => number;
}) {
  const binds = useBinds();
  const keys = laneKeyList(binds);
  const wraps = useRef<(HTMLDivElement | null)[]>([]);
  const rings = useRef<(HTMLSpanElement | null)[]>([]);
  const glows = useRef<(HTMLSpanElement | null)[]>([]);
  const judges = useRef<(HTMLSpanElement | null)[]>([]);
  useLoops((out, s) => {
    tiles.forEach((t, i) => {
      const len = t.len ?? 0;
      const gone = fall + len + 0.02;
      // The tile (its wrapper is the zone's height, the tile at its foot): from above the zone to
      // the line, then (a hold) on past it while it's held.
      play(wraps.current[i], [
        [0, { transform: 'translateY(-100%)', opacity: 1 }],
        [fall, { transform: 'translateY(0%)', opacity: 1 }],
        ...(t.miss ? [[fall + 0.25, { transform: `translateY(${(0.25 / fall) * 100}%)`, opacity: 0 }] as At]
          : len ? [[fall + len, { transform: `translateY(${(len / fall) * 100}%)`, opacity: 1 }] as At, [gone, { transform: `translateY(${(len / fall) * 100}%)`, opacity: 0 }] as At]
          : [[fall + 0.01, { transform: 'translateY(0%)', opacity: 0 }] as At]),
        [loop, { transform: 'translateY(0%)', opacity: 0 }],
      ], loop, t.at - fall, s, out);
      if (t.miss) {
        play(judges.current[i], [[0, { opacity: 1, transform: 'translateY(0)' }], [0.5, { opacity: 1, transform: 'translateY(-3px)' }], [0.75, { opacity: 0 }], [loop, { opacity: 0 }]], loop, t.at + 0.1, s, out);
        return;
      }
      play(rings.current[i], [[0, { opacity: 0.95, transform: 'scale(0.5)' }], [0.4, { opacity: 0, transform: 'scale(1.9)' }], [loop, { opacity: 0, transform: 'scale(1.9)' }]], loop, t.at, s, out);
      play(glows.current[i], [[0, { opacity: 1 }], [len, { opacity: 1 }], [len + 0.2, { opacity: 0 }], [loop, { opacity: 0 }]], loop, t.at, s, out);
      if (t.judge) play(judges.current[i], [[0, { opacity: 1, transform: 'translateY(0)' }], [0.5, { opacity: 1, transform: 'translateY(-3px)' }], [0.75, { opacity: 0 }], [loop, { opacity: 0 }]], loop, t.at, s, out);
    });
  }, [tiles, loop, fall], still);
  const h = hues ?? hueOf;
  return (
    <div className={`htp-lanes${small ? ' is-small' : ''}`} aria-hidden>
      <div className="htp-zone">
        {[0, 1, 2, 3].map((l) => <span key={l} className="htp-lane" style={{ '--h': h(l), left: `${l * 25}%` } as React.CSSProperties} />)}
        {tiles.map((t, i) => (
          <div key={i} ref={(e) => { wraps.current[i] = e; }} className="htp-wrap" style={{ left: `${t.lane * 25}%`, '--h': h(t.lane) } as React.CSSProperties}>
            {t.len ? <span className="htp-hold" style={{ height: `${(t.len / fall) * 100}%` }} /> : null}
            <span className="htp-tile" />
          </div>
        ))}
        <span className="htp-line" />
      </div>
      <div className="htp-under">
        {tiles.map((t, i) => (
          <span key={i} ref={(e) => { rings.current[i] = e; }} className="htp-ring" style={{ left: `${t.lane * 25 + 12.5}%`, '--h': h(t.lane) } as React.CSSProperties} />
        ))}
        {!small && tiles.map((t, i) => (t.judge || t.miss) && (
          <span key={`j${i}`} ref={(e) => { judges.current[i] = e; }} className={`htp-judge${t.miss ? ' is-miss' : ''}`} style={{ left: `${t.lane * 25 + 12.5}%` }}>{t.miss ? 'Miss' : t.judge}</span>
        ))}
      </div>
      {!small && (
        <div className="htp-keys">
          {keys.map((k, l) => (
            <span key={k.code} className="htp-key" style={{ '--h': h(l) } as React.CSSProperties}>
              <kbd>{k.label}</kbd>
              {tiles.map((t, i) => t.lane === l && <span key={i} ref={(e) => { glows.current[i] = e; }} className="htp-glow" />)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- The topics ----------------------------------------------------------------------------

const TAPS: DemoTile[] = [
  { lane: 0, at: 0.6, judge: 'Perfect' }, { lane: 2, at: 1.1, judge: 'Perfect' }, { lane: 1, at: 1.6, judge: 'Good' },
  { lane: 3, at: 2.1, judge: 'Perfect' }, { lane: 0, at: 2.6, judge: 'Perfect' }, { lane: 1, at: 3.1, miss: true }, { lane: 2, at: 3.6, judge: 'Perfect' },
];
const HOLDS: DemoTile[] = [
  { lane: 1, at: 0.5, len: 1.2, judge: 'Perfect' }, { lane: 3, at: 0.9, judge: 'Perfect' }, { lane: 2, at: 2.2, len: 0.8, judge: 'Perfect' },
  { lane: 0, at: 2.2, judge: 'Perfect' }, { lane: 3, at: 3.4, judge: 'Good' },
];

/** The same bar of music on each difficulty (a 120 BPM song): Easy keeps a few, Ultra all of it. */
const LADDER: Record<Difficulty, DemoTile[]> = (() => {
  const ultra: DemoTile[] = [
    { lane: 0, at: 0 }, { lane: 3, at: 0 }, { lane: 1, at: 0.25 }, { lane: 2, at: 0.5 }, { lane: 1, at: 0.75 }, { lane: 0, at: 1, len: 0.5 },
    { lane: 2, at: 1.25 }, { lane: 3, at: 1.5 }, { lane: 2, at: 1.75 }, { lane: 1, at: 2 }, { lane: 2, at: 2 }, { lane: 0, at: 2.25 },
    { lane: 3, at: 2.5 }, { lane: 2, at: 2.75 }, { lane: 1, at: 3 }, { lane: 0, at: 3.25 }, { lane: 2, at: 3.5 }, { lane: 3, at: 3.75 },
  ];
  const pick = (ts: number[], chords = false) => ultra.filter((t, i) => ts.includes(t.at) && (chords || ultra.findIndex((u) => u.at === t.at) === i));
  return {
    easy: pick([0, 1, 2, 3]).map((t) => ({ ...t, len: undefined })),
    medium: pick([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]),
    hard: pick([0, 0.5, 1, 1.25, 1.5, 2, 2.5, 2.75, 3, 3.5], true),
    ultra,
  };
})();

function ComboDemo() {
  const pips = useRef<(HTMLSpanElement | null)[]>([]);
  const miss = useRef<HTMLSpanElement>(null);
  const LOOP = 6, STEP = 0.8, BREAK = 4.6;
  useLoops((out, s) => {
    pips.current.forEach((p, i) => play(p, [[0, { opacity: 1, transform: 'scale(1.12)' }], [0.2, { opacity: 1, transform: 'scale(1)' }], [BREAK - i * STEP - STEP, { opacity: 1, transform: 'scale(1)' }],
      [BREAK - i * STEP - STEP + 0.05, { opacity: 0.18, transform: 'scale(1)' }], [LOOP, { opacity: 0.18, transform: 'scale(1)' }]], LOOP, STEP * (i + 1), s, out));
    play(miss.current, [[0, { opacity: 1 }], [0.8, { opacity: 1 }], [1.1, { opacity: 0 }], [LOOP, { opacity: 0 }]], LOOP, BREAK, s, out);
  }, [], 4.2);
  return (
    <div className="htp-combo" aria-hidden>
      {Array.from({ length: MAX_COMBO_MULTIPLIER }, (_, i) => (
        <span key={i} className={`htp-pip${i === MAX_COMBO_MULTIPLIER - 1 ? ' is-fever' : ''}`} ref={(e) => { pips.current[i] = e; }}>
          <b>×{i + 1}</b><small>{i === 0 ? 'start' : `${i * 10} in a row`}</small>
        </span>
      ))}
      <span className="htp-miss" ref={miss}>Miss: back to ×1</span>
    </div>
  );
}

function OverdriveDemo() {
  const binds = useBinds();
  const bar = useRef<HTMLSpanElement>(null);
  const key = useRef<HTMLSpanElement>(null);
  const lv = useRef<(HTMLSpanElement | null)[]>([]);
  const LOOP = 9;
  useLoops((out, s) => {
    // Fill (0-3 s), full: press (3-3.6 s), it runs, the bar counts the 48 tiles down (to 8 s), ends: empty.
    play(bar.current, [[0, { transform: 'scaleX(0)' }], [3, { transform: 'scaleX(1)' }], [3.6, { transform: 'scaleX(1)' }], [8, { transform: 'scaleX(0.02)' }], [8.2, { transform: 'scaleX(0)' }], [LOOP, { transform: 'scaleX(0)' }]], LOOP, 0, s, out);
    play(key.current, [[0, { opacity: 0.35, transform: 'scale(1)' }], [3, { opacity: 0.35, transform: 'scale(1)' }], [3.05, { opacity: 1, transform: 'scale(1.08)' }], [3.5, { opacity: 1, transform: 'scale(0.94)' }], [3.7, { opacity: 0.35, transform: 'scale(1)' }], [LOOP, { opacity: 0.35, transform: 'scale(1)' }]], LOOP, 0, s, out);
    lv.current.forEach((e, i) => play(e, [[0, { opacity: 1 }], [1.4, { opacity: 1 }], [1.6, { opacity: 0.3 }], [LOOP, { opacity: 0.3 }]], LOOP, 3.6 + i * 1.5, s, out));
  }, [], 5);
  return (
    <div className="htp-od" aria-hidden>
      <div className="htp-od-row">
        <span className="htp-od-bar"><span ref={bar} /></span>
        <span className="htp-od-key" ref={key}><kbd>{keyLabel(binds.overdrive)}</kbd></span>
      </div>
      <div className="htp-od-levels">
        {[1, 2, 3].map((l, i) => {
          const look = OVERDRIVE_LOOKS[l];
          const stripes = look.lanes.map((h, k) => (look.mono ? (k % 2 ? '#0b0b0f' : '#f2f2f6') : `hsl(${h} 100% 66%)`));
          return (
            <span key={l} className={`htp-od-level${look.mono ? ' is-mono' : ''}`} ref={(e) => { lv.current[i] = e; }}>
              <span className="htp-od-swatch" style={{ background: `linear-gradient(90deg, ${stripes.map((c, k) => `${c} ${k * 25}% ${(k + 1) * 25}%`).join(', ')})` }} />
              <b>{['I', 'II', 'III'][i]} · {look.name}</b><small>×{MAX_COMBO_MULTIPLIER + l} at full combo</small>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function SignalDemo() {
  const bar = useRef<HTMLSpanElement>(null);
  const marks = useRef<(HTMLSpanElement | null)[]>([]);
  const LOOP = 7;
  const events: [number, string][] = [[1.2, 'Miss'], [3.4, 'Stray key'], [4.6, 'Miss']];
  useLoops((out, s) => {
    play(bar.current, [[0, { transform: 'scaleX(1)' }], [1.2, { transform: 'scaleX(1)' }], [1.3, { transform: 'scaleX(0.86)' }], [3.4, { transform: 'scaleX(0.9)' }],
      [3.5, { transform: 'scaleX(0.87)' }], [4.6, { transform: 'scaleX(0.89)' }], [4.7, { transform: 'scaleX(0.75)' }], [6.6, { transform: 'scaleX(0.8)' }], [LOOP, { transform: 'scaleX(1)' }]], LOOP, 0, s, out);
    marks.current.forEach((m, i) => play(m, [[0, { opacity: 1 }], [0.9, { opacity: 1 }], [1.2, { opacity: 0 }], [LOOP, { opacity: 0 }]], LOOP, events[i][0], s, out));
  }, [], 4.8);
  return (
    <div className="htp-signal" aria-hidden>
      <span className="htp-signal-bar"><span ref={bar} /></span>
      <div className="htp-signal-marks">{events.map(([, t], i) => <span key={i} ref={(e) => { marks.current[i] = e; }}>{t}</span>)}</div>
    </div>
  );
}

function TimingDemo({ windowsMs }: { windowsMs: [number, number, number] }) {
  const [p, g, e] = windowsMs;
  const x = (ms: number) => 50 + (ms / e) * 46;
  return (
    <svg className="htp-timing" viewBox="0 0 100 34" role="img" aria-label={`Perfect within ${p} ms of the note, Good within ${g} ms, Early or Late within ${e} ms`}>
      <rect x={x(-e)} y="8" width={x(e) - x(-e)} height="10" rx="1.5" className="w-el" />
      <rect x={x(-g)} y="8" width={x(g) - x(-g)} height="10" className="w-good" />
      <rect x={x(-p)} y="8" width={x(p) - x(-p)} height="10" className="w-perfect" />
      <line x1="50" x2="50" y1="4" y2="22" className="w-line" />
      <text x={x(-(g + e) / 2)} y="28">Early</text>
      <text x={x(-(p + g) / 2)} y="28">Good</text>
      <text x="50" y="28">Perfect</text>
      <text x={x((p + g) / 2)} y="28">Good</text>
      <text x={x((g + e) / 2)} y="28">Late</text>
      <text x={x(-e)} y="5" className="w-ms">−{e} ms</text>
      <text x="50" y="3" className="w-ms">the note</text>
      <text x={x(e)} y="5" className="w-ms">+{e} ms</text>
      <circle cx="50" cy="13" r="2.2" className="w-dot" />
    </svg>
  );
}

function PracticeDemo() {
  const nums = useRef<(HTMLSpanElement | null)[]>([]);
  useLoops((out, s) => {
    nums.current.forEach((n, i) => play(n, [[0, { opacity: 1, transform: 'scale(1.25)' }], [0.5, { opacity: 1, transform: 'scale(1)' }], [0.7, { opacity: 0, transform: 'scale(0.9)' }], [3, { opacity: 0 }]], 3, i * 0.7, s, out));
  }, [], 0.2);
  return (
    <div className="htp-practice" aria-hidden>
      <div className="htp-loop">
        <span className="htp-loop-track"><span className="htp-loop-span" /></span>
        <span className="htp-loop-labels"><span>Start 0:42</span><span>End 1:02</span></span>
        <span className="htp-loop-speeds"><span>50%</span><span className="is-on">75%</span><span>100%</span></span>
      </div>
      <div className="htp-count">{['3', '2', '1', 'Go'].map((n, i) => <span key={n} ref={(e) => { nums.current[i] = e; }}>{n}</span>)}</div>
    </div>
  );
}

function Ladder() {
  return (
    <div className="htp-ladder">
      {DIFFICULTIES.map((d) => (
        <figure key={d} className={`htp-rung is-${d}`}>
          <Lanes tiles={LADDER[d]} loop={4} fall={fallTime(d)} still={1.6} small />
          <figcaption><b>{d}</b><span className="mono">speed {noteSpeed(d).toFixed(1)}×</span></figcaption>
        </figure>
      ))}
    </div>
  );
}

interface Topic { id: string; title: string; demo: () => ReactNode; body: ReactNode }

function topics(overdriveKey: string, laneKeys: string): Topic[] {
  return [
    {
      id: 'tiles', title: 'Tiles',
      demo: () => <Lanes tiles={TAPS} loop={4} fall={1.3} still={2.62} />,
      body: <>
        <p>Every tile is a note in the song, at the moment you hear it. Press its lane's key (<kbd>{laneKeys}</kbd>) as it reaches the line.</p>
        <p className="muted">The song is the sound: hitting a tile makes none. On a touch screen, tap the lanes.</p>
      </>,
    },
    {
      id: 'holds', title: 'Holds',
      demo: () => <Lanes tiles={HOLDS} loop={4.4} fall={1.3} still={1.2} />,
      body: <>
        <p>A long tile is a sound that rings. Press it as it reaches the line and keep the key down until its tail passes.</p>
        <p className="muted">Held to the end it pays a bonus (more the longer it is) and charges Overdrive. Let go early and it breaks.</p>
      </>,
    },
    {
      id: 'timing', title: 'Timing',
      demo: () => <TimingDemo windowsMs={[HIT_WINDOWS.perfect, HIT_WINDOWS.great, HIT_WINDOWS.good].map((w) => Math.round(w * 1000)) as [number, number, number]} />,
      body: <>
        <p>The closer to the note, the more it's worth: <b>Perfect</b> 100, <b>Good</b> 75, <b>Early</b> or <b>Late</b> 50, all ×10 on the score.</p>
        <p className="muted">These are Ultra's windows; each easier difficulty gives a little more room. Sync is automatic: if a song still feels off, Settings → Resync.</p>
      </>,
    },
    {
      id: 'combo', title: 'Combo',
      demo: () => <ComboDemo />,
      body: <>
        <p>Hits in a row build your combo. Every 10 raises the multiplier, up to <b>×{MAX_COMBO_MULTIPLIER}</b>: <b>Fever</b>. Every 25 lights up the stage.</p>
        <p className="muted">A miss drops it back to ×1.</p>
      </>,
    },
    {
      id: 'overdrive', title: 'Overdrive',
      demo: () => <OverdriveDemo />,
      body: <>
        <p>Accurate hits charge the bar: a Perfect most, a held-out hold too (about {PERFECTS_TO_CHARGE} Perfects in a row; hold {HOLD_CHARGE}). When it's full, press <kbd>{overdriveKey}</kbd>: +1 on the multiplier for {OVERDRIVE_LENGTH} tiles.</p>
        <p>Fill it again while it runs and press again to stack it, up to {MAX_OVERDRIVE} levels: ×{MAX_COMBO_MULTIPLIER + MAX_OVERDRIVE}.</p>
        <p className="muted">One miss ends every level, except in the {OVERDRIVE_GRACE} seconds after each press (time to get back to the lanes). When it ends, the bar starts again from empty.</p>
      </>,
    },
    {
      id: 'signal', title: 'Signal',
      demo: () => <SignalDemo />,
      body: <>
        <p>The signal bar is your life. Misses take a chunk; hits give a little back. Pressing a key with no tile (a stray) costs some too, so mashing can't clear a song.</p>
        <p className="muted">If it runs out, the signal is lost and the run ends. Settings → No fail keeps you playing.</p>
      </>,
    },
    {
      id: 'difficulty', title: 'Difficulty',
      demo: () => <Ladder />,
      body: <>
        <p>The same song, four ways. <b>Easy</b> is one note at a time, <b>Medium</b> closer together, <b>Hard</b> adds chords of two and taps under holds, <b>Ultra</b> is every note the map has.</p>
        <p className="muted">Harder difficulties fall faster, and so do faster songs. The start card shows each map's speed.</p>
      </>,
    },
    {
      id: 'practice', title: 'Practice',
      demo: () => <PracticeDemo />,
      body: <>
        <p>On the start card, <b>Practice a part</b>: drag the start and end of a loop and pick 50%, 75% or 100% speed. It loops until you stop; nothing is saved and you can't fail.</p>
        <p className="muted"><kbd>Esc</kbd> pauses any time; resuming counts you back in, 3, 2, 1.</p>
      </>,
    },
  ];
}

/** The How to play dialog (mounted once, in App). */
export function HowToPlayDialog() {
  const isOpen = useOpen();
  const ref = useRef<HTMLDialogElement>(null);
  const binds = useBinds();
  const [tab, setTab] = useState('tiles');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (isOpen && !d.open) d.showModal();
    if (!isOpen && d.open) d.close();
  }, [isOpen]);
  const list = topics(keyLabel(binds.overdrive), laneKeyList(binds).map((k) => k.label).join(' '));
  const i = Math.max(0, list.findIndex((t) => t.id === tab));
  const topic = list[i];
  const go = (n: number) => { const j = (n + list.length) % list.length; setTab(list[j].id); tabs.current[j]?.focus(); };
  const close = () => setOpen(false);
  return (
    <dialog ref={ref} className="dialog htp" onClose={close} onClick={(e) => { if (e.target === ref.current) close(); }} aria-labelledby="htp-title">
      <div className="dialog-head">
        <h2 id="htp-title">How to play</h2>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={close} aria-label="Close how to play"><Icon name="close" /></button>
      </div>
      {isOpen && (
        <div className="htp-body">
          <div className="htp-tabs" role="tablist" aria-label="Topics" aria-orientation="vertical"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
              if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
            }}>
            {list.map((t, j) => (
              <button key={t.id} ref={(e) => { tabs.current[j] = e; }} type="button" role="tab" id={`htp-tab-${t.id}`} aria-controls="htp-panel"
                aria-selected={t.id === topic.id} tabIndex={t.id === topic.id ? 0 : -1} className={t.id === topic.id ? 'is-on' : ''} onClick={() => setTab(t.id)}>
                <span className="mono">{String(j + 1).padStart(2, '0')}</span> {t.title}
              </button>
            ))}
          </div>
          <section className="htp-panel" id="htp-panel" role="tabpanel" aria-labelledby={`htp-tab-${topic.id}`} key={topic.id}>
            <div className="htp-demo">{topic.demo()}</div>
            <div className="htp-text">{topic.body}</div>
          </section>
        </div>
      )}
      <div className="dialog-foot">
        <span className="muted htp-step mono">{i + 1} / {list.length}</span>
        <div className="htp-nav">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(i - 1)} disabled={i === 0}><Icon name="back" size={16} /> Back</button>
          {i < list.length - 1
            ? <button type="button" className="btn btn-primary btn-sm" onClick={() => go(i + 1)}>Next: {list[i + 1].title}</button>
            : <button type="button" className="btn btn-primary btn-sm" onClick={close}>Got it</button>}
        </div>
      </div>
    </dialog>
  );
}
