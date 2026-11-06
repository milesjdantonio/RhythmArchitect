import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../api/client';
import type { Difficulty, Song } from '../api/types';
import { learnFromRun } from '../audio/syncer';
import { audioLevels, handOverPreview, pauseAudio, prepareSong, previewSong, resumeAudio, setDuck, songMelody, songTime, startSong, stopSong, unlockAudio, windDown, type PreviewHandle } from '../audio/playback';
import { VideoError, YT_STATE, ytIntent, ytOnState, ytStarted } from '../audio/youtube';
import { ComboCallout, type Callout } from '../components/play/ComboCallout';
import { DevTools, type DevEffect, type DevProbe } from '../components/play/DevTools';
import { PlayHud, type HudState } from '../components/play/PlayHud';
import { PauseCard, StartCard } from '../components/play/PlayCards';
import { botPlan, type BotMode } from '../game/autoplay';
import { Icon } from '../components/Icon';
import { Loader } from '../components/Loader';
import { Results, type RunResult } from '../components/play/Results';
import { Game, KEYS, fallTime, gradeFor, laneForCode, type GameEvent, type Judgement } from '../game/engine';
import { drawField, laneHue, layoutFor, type Layout } from '../game/render';
import type { RiveHandle } from '../rive/RiveAnim';
import { FAIL_SECONDS, Stage3D } from '../stage/Stage3D';
import { StageProxy } from '../stage/proxy';
import { bus } from '../lib/bus';
import { href, navigate, parse } from '../lib/router';
import { getSettings, setSettings, useSettings } from '../lib/settings';
import { deleteSong, fetchSong, upsert } from '../library/songs';
import { EASE_OUT } from '../lib/motion';
import { frameGate, perf } from '../lib/perf';
import { ORDER, cancelFrame, nextFrame } from '../lib/ticker';
import { JudgePool, type JudgePoolHandle } from '../components/play/JudgePool';
import { forward } from '../background/host';

type Phase = 'loading' | 'ready' | 'starting' | 'playing' | 'paused' | 'failing' | 'results' | 'error';
/** A judgement word's kind. */
type PopupKind = Judgement | 'hold';
/** The stage's hit burst and hold glow on one pad. */
interface BurstHandle { fire(kind: Judgement): void }
interface HoldHandle { start(): void; end(ok: boolean): void }
/** Centred over the far end of the lanes: a new section, and the finale (fever = gold). */
interface Banner { id: number; kind: 'fever' | 'section'; big: string; small?: string }

const JUDGE_TEXT: Record<Judgement, string> = { perfect: 'Perfect', great: 'Great', good: 'Good', miss: 'Miss' };
const MILESTONE = 25;
/** How many times a second the HUD's numbers update. */
const HUD_HZ = 10;

export function Play({ songId, difficulty }: { songId: string; difficulty: Difficulty }) {
  // The perf profile, fixed for the life of the screen.
  const [pf] = useState(perf);
  const judgePool = useRef<JudgePoolHandle>(null);
  const hudAt = useRef(0);
  const [song, setSong] = useState<Song | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [hud, setHud] = useState<HudState>({ score: 0, combo: 0, accuracy: 1, health: 1, multiplier: 1, progress: 0, counts: { perfect: 0, great: 0, good: 0, miss: 0 } });
  const [banner, setBanner] = useState<Banner | null>(null);
  const [callout, setCallout] = useState<Callout | null>(null);
  /** Screen space the left HUD panel covers. */
  const [inset, setInsetState] = useState(0);
  const [section, setSection] = useState('');
  const [clock, setClock] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [saving, setSaving] = useState<'saving' | 'saved' | 'error' | 'skipped'>('saving');
  const [prevBest, setPrevBest] = useState<number | undefined>();
  const [layout, setLayout] = useState<Layout | null>(null);
  const [use3d] = useState(() => Stage3D.supported());
  const [bot, setBotState] = useState<BotMode>('off');
  const { devTools } = useSettings();

  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // The stage on this thread, or a stand-in for the stage drawing in a worker.
  const stage = useRef<Stage3D | StageProxy | null>(null);
  const game = useRef<Game | null>(null);
  const beat0 = useRef(0);
  const raf = useRef(0);
  const lastFrame = useRef(performance.now());
  const pressed = useRef<boolean[]>([false, false, false, false]);
  const flash = useRef<number[]>([0, 0, 0, 0]);
  const beatPulse = useRef(0);
  // The 2D fallback's climb: when bands of light started up the walls (song seconds), newest last.
  const climb2d = useRef({ starts: [] as number[], now: 0, level: 0, avg: 0, last: -9 });
  const addClimb = (delay: number, count: number) => {
    const c = climb2d.current;
    for (let k = 0; k < count; k++) c.starts.push(c.now + delay + k * 0.12);
    if (c.starts.length > 8) c.starts.splice(0, c.starts.length - 8);
  };
  const pointerLane = useRef(new Map<number, number>());
  const bursts = useRef<(BurstHandle | null)[]>([]);
  const holds = useRef<(HoldHandle | null)[]>([]);
  const combo = useRef<RiveHandle>(null);
  const panel = useRef<HTMLElement>(null);
  const insetRef = useRef(0);
  const offsets = useRef<number[]>([]);
  const phaseRef = useRef<Phase>('loading');
  phaseRef.current = phase;
  const botRef = useRef<BotMode>('off');
  const botIdx = useRef(0);
  const botRelease = useRef<number[]>([0, 0, 0, 0]);
  const assisted = useRef(false);
  const fever = useRef(false);
  /** While the signal drops after a fail: when it started, and the clock slowing to a stop. */
  const failing = useRef<{ start: number; last: number; t: number } | null>(null);
  /** The finale has played (the song ended and the run cleared it). */
  const cleared = useRef(false);
  const fps = useRef({ value: 60, frames: 0, since: performance.now() });
  const lastIntensity = useRef(0);
  const songEnergy = useRef(0);

  const setBot = useCallback((m: BotMode) => {
    botRef.current = m;
    setBotState(m);
    if (m !== 'off' && (phaseRef.current === 'playing' || phaseRef.current === 'paused')) assisted.current = true;
  }, []);

  // Load the song, and its audio so Start is instant.
  useEffect(() => {
    let live = true;
    setPhase('loading');
    fetchSong(songId)
      .then(async (s) => {
        if (!live) return;
        // On stage first (a YouTube song's player needs its spot on screen), then ready to start.
        setSong(s);
        setPrevBest(s.best?.[difficulty]?.score);
        try {
          await prepareSong(s);
        } catch (e) {
          if (live) { setError(e instanceof VideoError ? e.message : "This song's audio couldn't be loaded."); setPhase('error'); }
          return;
        }
        if (live) setPhase('ready');
      })
      .catch(() => { if (live) { setError("This song couldn't be loaded. It may have been deleted."); setPhase('error'); } });
    return () => { live = false; };
  }, [songId, difficulty]);

  // The end screen's quiet replay of the song. Leaving for the menu with this song on stage, it is
  // handed over and plays on from where it is (the menu takes it as its preview); otherwise it stops.
  const replay = useRef<PreviewHandle | null>(null);
  const releaseReplay = useCallback(() => {
    const p = replay.current;
    replay.current = null;
    if (!p) return false;
    const to = parse(location.hash);
    if (to.name === 'home' && to.songId === songId && p.live()) handOverPreview(p);
    else p.stop();
    return true;
  }, [songId]);

  // Scene: dim the backdrop, tint it, tidy up on the way out.
  useEffect(() => {
    document.body.dataset.scene = 'play';
    return () => {
      delete document.body.dataset.scene;
      bus.emit('fever', { on: false });
      cancelFrame(raf.current);
      if (!releaseReplay()) stopSong();
      resumeAudio().catch(() => {});
      bus.emit('hues', null);
      bus.emit('intensity', 0.15);
    };
  }, []);
  useEffect(() => { if (song) bus.emit('hues', song.hues); }, [song]);
  useEffect(() => bus.on('beat', ({ downbeat }) => {
    beatPulse.current = 1;
    stage.current?.onBeat(downbeat);
    // 2D fallback: the climb answers accents only (a downbeat louder than the recent music).
    const c = climb2d.current;
    if (downbeat && c.level > c.avg * 1.3 + 0.06 && c.now - c.last > 1.4) { c.last = c.now; addClimb(0, 1); }
  }), []);
  useEffect(() => {
    const offs = [
      bus.on('cue', ({ kind }) => { if (kind === 'drop') addClimb(0, 3); }),
      bus.on('section', () => addClimb(0, 2)),
      bus.on('fever', ({ on }) => { if (on) addClimb(0, 4); }),
      bus.on('milestone', () => addClimb(0, 3)),
    ];
    return () => offs.forEach((o) => o());
  }, []);
  useEffect(() => bus.on('cue', ({ kind, strength }) => stage.current?.cue(kind, strength)), []);
  useEffect(() => bus.on('section', ({ label, index }) => {
    setSection(label);
    stage.current?.section();
    if (index > 0 && phaseRef.current === 'playing') setBanner({ id: Date.now(), kind: 'section', big: label });
  }), []);

  // The stage draws the backdrop: it hears what the page's backdrop hears.
  useEffect(() => forward((e) => stage.current?.skyEvent(e)), []);

  // The stage draws the hit bursts and hold glows on the pads (the Rive art, baked).
  useEffect(() => {
    for (let l = 0; l < 4; l++) {
      bursts.current[l] = { fire: (kind) => stage.current?.burst(l, kind) };
      holds.current[l] = { start: () => stage.current?.holdFx(l, true), end: (ok) => stage.current?.holdFx(l, false, ok) };
    }
  }, []);

  // The 3D stage (or the 2D canvas when WebGL is missing).
  useEffect(() => {
    if (!song) return;
    if (use3d && host.current) {
      const opts = { mode: 'play' as const, hues: song.hues };
      const s = StageProxy.supported() ? new StageProxy(host.current, opts) : new Stage3D(host.current, opts);
      s.setTiming(60 / song.bpm, fallTime(difficulty));
      stage.current = s;
      // The page's backdrop answers the sky: its grains scatter from where a burst appears.
      s.onSky = (x, y, strength) => bus.emit('sky', { x: x / innerWidth, y: y / innerHeight, strength });
      s.frame(-4, []);
      return () => { s.destroy(); stage.current = null; };
    }
    const fit = () => {
      const c = canvas.current;
      if (!c) return;
      const dpr = Math.min(2, devicePixelRatio || 1);
      c.width = Math.round(innerWidth * dpr);
      c.height = Math.round(innerHeight * dpr);
      c.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
      setLayout(layoutFor(innerWidth, innerHeight, 4, insetRef.current));
    };
    fit();
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, [song, difficulty, use3d]);

  // The left panel covers part of the screen (wide screens). The lanes stay centred; the 2D lanes
  // narrow to clear it, and the results card centres in the space beside it.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const measure = () => {
      const v = innerWidth > 900 ? Math.round(el.getBoundingClientRect().right + 16) : 0;
      if (v === insetRef.current) return;
      insetRef.current = v;
      setInsetState(v);
      if (!use3d) setLayout(layoutFor(innerWidth, innerHeight, 4, v));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    addEventListener('resize', measure);
    return () => { ro.disconnect(); removeEventListener('resize', measure); };
  }, [song, use3d]);

  /** Screen position of a lane's pad, from the 3D stage or the 2D layout. */
  const anchor = useCallback((lane: number) => {
    if (stage.current) return stage.current.receptor(lane);
    const L = layout;
    return L ? { x: L.left + L.laneW * (lane + 0.5), y: L.hitY } : { x: innerWidth / 2, y: innerHeight * 0.8 };
  }, [layout]);

  /** The whole screen takes the hit: a tiny scale punch (a big one on milestones). */
  const impact = useCallback((strength: number) => {
    const el = host.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const s = 1 + 0.006 * strength;
    el.animate([{ transform: `scale(${s})` }, { transform: 'scale(1)' }], { duration: 90 + strength * 50, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }, []);

  const popup = useCallback((lane: number, kind: PopupKind, text: string, sub?: string) => {
    const a = anchor(lane);
    judgePool.current?.show({
      lane, text, sub, x: a.x, y: a.y, miss: kind === 'miss', perfect: kind === 'perfect', hold: kind === 'hold',
      color: kind === 'miss' || !song ? undefined : `hsl(${laneHue(lane, 4, song.hues)} 100% 80%)`,
    });
  }, [anchor, song]);

  const finish = useCallback(async () => {
    const g = game.current;
    if (!g || !song) return;
    cancelFrame(raf.current);
    stopSong();
    const accuracy = g.accuracy;
    const grade = gradeFor(accuracy, g.failed);
    const meanOffsetMs = offsets.current.length >= 8 ? (offsets.current.reduce((a, b) => a + b, 0) / offsets.current.length) * 1000 : null;
    const r: RunResult = {
      score: g.stats.score, accuracy, maxCombo: g.stats.maxCombo, counts: { ...g.stats.counts }, grade, failed: g.failed, total: g.stats.total, meanOffsetMs, assisted: assisted.current,
      reached: g.failed ? { at: Math.max(0, failing.current?.t ?? songTime(beat0.current)), of: (song.lengthBeats * 60) / song.bpm } : undefined,
    };
    setResult(r);
    setPhase('results');
    bus.emit('intensity', g.failed ? 0.05 : 0.5);
    if (assisted.current) { setSaving('skipped'); return; }
    setSaving('saving');
    // The Map Syncer: hits that were steadily early or late move a YouTube song's map for next time
    // (saved before the score, so the two saves can't undo each other).
    const offset = await learnFromRun(song, offsets.current).catch(() => null);
    if (offset !== null) setSong((s) => (s && s.id === song.id ? { ...s, source: { ...s.source, offset } } : s));
    try {
      const updated = await api.submitScore(song.id, { difficulty, score: r.score, accuracy, maxCombo: r.maxCombo, grade });
      upsert(updated);
      setSaving('saved');
    } catch {
      setSaving('error');
    }
  }, [song, difficulty]);

  /**
   * The run failed: the signal drops. The music winds down like a tape stopping, the tiles slow
   * to a halt, the lanes go dark from the outside in and the camera sags (Stage3D.fail); then
   * the results. The frame loop keeps drawing until it's over.
   */
  const dropSignal = useCallback(() => {
    if (failing.current) return;
    const now = performance.now();
    failing.current = { start: now, last: now, t: songTime(beat0.current) };
    pressed.current = [false, false, false, false];
    for (let l = 0; l < 4; l++) { stage.current?.setPressed(l, false); holds.current[l]?.end(false); }
    judgePool.current?.clear();
    setBanner(null);
    setCallout(null);
    stage.current?.fail();
    windDown(FAIL_SECONDS);
    bus.emit('fever', { on: false });
    bus.emit('miss', { x: 0.5 });
    bus.emit('intensity', 0.05);
    setPhase('failing');
  }, []);

  // Hitting a tile makes no sound: the song is the sound. Every hit is light and motion instead.
  const handle = useCallback((events: GameEvent[]) => {
    const g = game.current;
    if (!g || !song) return;
    let hudChanged = false;
    for (const e of events) {
      if (e.type === 'judge') {
        hudChanged = true;
        const lane = e.note.lane;
        const x = anchor(lane).x / innerWidth;
        bursts.current[lane]?.fire(e.judgement);
        if (e.judgement === 'miss') {
          stage.current?.miss(lane);
          bus.emit('miss', { x });
          popup(lane, 'miss', JUDGE_TEXT.miss);
        } else {
          flash.current[lane] = 1;
          stage.current?.hit(lane, e.judgement);
          impact(e.judgement === 'perfect' ? 1 : e.judgement === 'great' ? 0.6 : 0.3);
          bus.emit('hit', { judgement: e.judgement, x });
          offsets.current.push(e.delta);
          if (offsets.current.length > 400) offsets.current.splice(0, 100);
          popup(lane, e.judgement, JUDGE_TEXT[e.judgement], e.judgement === 'perfect' ? undefined : e.delta < 0 ? 'early' : 'late');
          combo.current?.fire('bump');
          const c = g.stats.combo;
          if (c > 0 && c % MILESTONE === 0) {
            stage.current?.milestone(c);
            bus.emit('milestone', { combo: c });
            impact(1.2);
            setCallout({ id: c, kind: 'combo', value: c });
          }
        }
      } else if (e.type === 'holdStart') {
        holds.current[e.note.lane]?.start();
      } else if (e.type === 'holdEnd') {
        holds.current[e.note.lane]?.end(e.ok);
        hudChanged = true;
        if (e.ok) { popup(e.note.lane, 'hold', 'Held', `+${Math.round(60 * Math.max(1, e.note.end - e.note.time) * 2)}`); stage.current?.hit(e.note.lane, 'great'); }
        else { popup(e.note.lane, 'miss', 'Let go'); bursts.current[e.note.lane]?.fire('miss'); stage.current?.miss(e.note.lane); }
      } else if (e.type === 'comboBreak') {
        combo.current?.fire('break');
      } else if (e.type === 'fail') {
        dropSignal();
      }
    }
    if (hudChanged) {
      const s = g.stats;
      const level = s.combo === 0 ? 0 : g.multiplier;
      // (The HUD's numbers: the frame loop copies the stats a few times a second.)
      combo.current?.set('level', level);
      const on = level >= 4;
      if (on && !fever.current) setCallout({ id: Date.now(), kind: 'fever', value: 4 });
      if (on !== fever.current) bus.emit('fever', { on });
      fever.current = on;
      stage.current?.setFever(on);
    }
  }, [song, popup, dropSignal, anchor, impact, pf]);

  // `at`: the song time of the press, when it isn't now (the autoplay bot presses at its planned
  // moment, so a slow frame doesn't make a perfect run late).
  const press = useCallback((lane: number, at?: number) => {
    const g = game.current;
    if (!g) return;
    pressed.current[lane] = true;
    stage.current?.setPressed(lane, true);
    handle(g.press(lane, at ?? songTime(beat0.current)));
  }, [handle]);
  const release = useCallback((lane: number) => {
    const g = game.current;
    if (!g) return;
    pressed.current[lane] = false;
    stage.current?.setPressed(lane, false);
    handle(g.release(lane, songTime(beat0.current)));
  }, [handle]);

  /** Autoplay: presses each note on time (or like a person, or badly) and lets go after. */
  const botStep = useCallback((g: Game, t: number) => {
    const mode = botRef.current;
    for (let l = 0; l < 4; l++) if (botRelease.current[l] && t >= botRelease.current[l]) { botRelease.current[l] = 0; release(l); }
    if (mode === 'off') return;
    while (botIdx.current < g.notes.length) {
      const n = g.notes[botIdx.current];
      const plan = botPlan(mode, n.idx);
      if (t < n.time + plan.jitter) break;
      botIdx.current++;
      if (plan.skip || n.judged) continue;
      if (botRelease.current[n.lane]) { botRelease.current[n.lane] = 0; release(n.lane); }
      press(n.lane, n.time + plan.jitter);
      botRelease.current[n.lane] = n.hold ? (plan.early ? n.time + 0.2 : n.end + 0.02) : t + 0.06;
    }
  }, [press, release]);

  // The frame loop.
  // `ts`: requestAnimationFrame's timestamp (shared with the backdrop, for the frame cap).
  const loop = useCallback((ts?: number) => {
    const g = game.current;
    if (!g || !song) return;
    if (ts !== undefined && !frameGate(ts)) { raf.current = nextFrame(loop, ORDER.game); return; }
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastFrame.current) / 1000);
    lastFrame.current = now;
    const f = fps.current;
    f.frames++;
    if (now - f.since >= 500) { f.value = (f.frames * 1000) / (now - f.since); f.frames = 0; f.since = now; }
    const fail = failing.current;
    if (fail) {
      // The clock slows to a stop with the music; nothing is judged any more.
      const k = Math.min(1, (now - fail.start) / 1000 / FAIL_SECONDS);
      fail.t += ((now - fail.last) / 1000) * Math.pow(1 - k, 1.5);
      fail.last = now;
      if (stage.current) stage.current.frame(fail.t, g.notes);
      else if (canvas.current && layout) {
        drawField(canvas.current.getContext('2d')!, layout, {
          now: fail.t, speed: layout.hitY / fallTime(difficulty), spb: 60 / song.bpm, notes: g.notes,
          pressed: [false, false, false, false], flash: [0, 0, 0, 0], hues: song.hues, keys: KEYS.map((x) => x.label), beatPulse: 0, climbs: [],
        });
      }
      if (k >= 1) { finish(); return; }
      raf.current = nextFrame(loop, ORDER.game);
      return;
    }
    const t = songTime(beat0.current);
    // The bot also catches up after a pause, so skip it while it is off and nothing is held.
    if (botRef.current !== 'off' || botRelease.current.some(Boolean)) botStep(g, t);
    else { while (botIdx.current < g.notes.length && g.notes[botIdx.current].time < t) botIdx.current++; }
    handle(g.update(t));
    for (let i = 0; i < 4; i++) flash.current[i] *= 0.86;
    beatPulse.current *= 0.9;
    const s = stage.current;
    if (s) {
      for (let l = 0; l < 4; l++) if (g.isHolding(l)) s.holding(l, dt);
      s.setLevels(audioLevels());
      // `now`: when the song time was read (a stage in a worker carries it on from then).
      if (s instanceof StageProxy) s.frame(t, g.notes, now); else s.frame(t, g.notes);
    } else if (canvas.current && layout) {
      const c = climb2d.current;
      const lv = audioLevels().level;
      c.avg += (lv - c.avg) * Math.min(1, Math.max(0, t - c.now) * 0.6);
      c.level = lv;
      c.now = t;
      const speed = layout.hitY / fallTime(difficulty);
      drawField(canvas.current.getContext('2d')!, layout, {
        now: t, speed, spb: 60 / song.bpm, notes: g.notes, pressed: pressed.current.map((p, i) => p || g.isHolding(i)),
        flash: flash.current, hues: song.hues, keys: KEYS.map((k) => k.label), beatPulse: beatPulse.current, climbs: c.starts,
      });
    }
    // The backdrop's energy follows the song (its loudness), a few times a second.
    if (now - lastIntensity.current > 250) {
      lastIntensity.current = now;
      const lv = audioLevels().level;
      songEnergy.current += (lv - songEnergy.current) * 0.35;
      bus.emit('intensity', Math.min(1, 0.2 + songEnergy.current * 0.9));
    }
    const total = g.endTime || 1;
    // The HUD: one React update for everything, HUD_HZ times a second.
    if (now - hudAt.current >= 1000 / HUD_HZ) {
      hudAt.current = now;
      const s = g.stats;
      const progress = Math.max(0, Math.min(1, t / total));
      setClock((c) => (Math.floor(Math.max(0, t)) !== c ? Math.floor(Math.max(0, t)) : c));
      setHud((h) => (h.score === s.score && h.combo === s.combo && h.health === s.health && h.counts.miss === s.counts.miss && Math.abs(progress - h.progress) <= 0.004 ? h
        : { score: s.score, combo: s.combo, accuracy: g.accuracy, health: s.health, multiplier: g.multiplier, progress, counts: { ...s.counts } }));
    }
    if (g.finished && !g.failed && !cleared.current && t > g.endTime + 0.2) {
      // The finale: light on every lane, then the results.
      cleared.current = true;
      const full = g.stats.counts.miss === 0;
      stage.current?.clear(full);
      if (!stage.current) addClimb(0, 4);
      bus.emit('milestone', { combo: g.stats.combo });
      setBanner({ id: Date.now(), kind: 'fever', big: full ? 'Full combo' : 'Clear', small: full ? 'Every note' : undefined });
    }
    if (g.finished && !g.failed && t > g.endTime + 1.9) { finish(); return; }
    raf.current = nextFrame(loop, ORDER.game);
  }, [layout, song, difficulty, handle, finish, botStep, pf]);

  const start = useCallback(async () => {
    if (!song || phaseRef.current === 'starting') return;
    setPhase('starting');
    await unlockAudio();
    const chart = song.charts[difficulty];
    const g = new Game(chart, song.bpm, difficulty, { noFail: getSettings().noFail });
    game.current = g;
    pressed.current = [false, false, false, false];
    flash.current = [0, 0, 0, 0];
    offsets.current = [];
    botIdx.current = 0;
    botRelease.current = [0, 0, 0, 0];
    assisted.current = botRef.current !== 'off';
    fever.current = false;
    failing.current = null;
    cleared.current = false;
    stage.current?.revive();
    judgePool.current?.clear();
    setResult(null);
    setBanner(null);
    setCallout(null);
    setSection('');
    setClock(0);
    for (let l = 0; l < 4; l++) holds.current[l]?.end(true);
    setHud({ score: 0, combo: 0, accuracy: 1, health: 1, multiplier: 1, progress: 0, counts: { perfect: 0, great: 0, good: 0, miss: 0 } });
    combo.current?.set('level', 0);
    stage.current?.setFever(false);
    const spb = 60 / song.bpm;
    const travel = fallTime(difficulty);
    stage.current?.setTiming(spb, travel);
    const leadInBeats = Math.max(4, Math.ceil((travel + 0.4) / spb / 4) * 4);
    try {
      // Synth songs play every note of the map themselves, so each tile is a note you hear.
      beat0.current = await startSong(song, {
        leadInBeats,
        onCount: (n) => setCount(n <= 3 ? n : null),
        autoMelody: song.source.kind === 'synth' ? songMelody(song) : undefined,
      });
    } catch (e) {
      if (e instanceof VideoError) { setError(e.message); setPhase('error'); }
      return; // otherwise the player left (or restarted) while the track was loading
    }
    setPhase('playing');
    bus.emit('intensity', 0.3);
    // Test hook (dev builds only): lets the Playwright bot read the clock and the tiles.
    if (import.meta.env.DEV) (window as unknown as { __rythm: unknown }).__rythm = { time: () => songTime(beat0.current), game: g };
    lastFrame.current = performance.now();
    cancelFrame(raf.current);
    raf.current = nextFrame(loop, ORDER.game);
  }, [song, difficulty, loop]);

  // Keep the running loop pointing at the latest closure.
  useEffect(() => {
    if (phase !== 'playing' && phase !== 'failing') return;
    cancelFrame(raf.current);
    raf.current = nextFrame(loop, ORDER.game);
    return () => cancelFrame(raf.current);
  }, [loop, phase]);

  useEffect(() => { if (count === 0) { const t = setTimeout(() => setCount(null), 600); return () => clearTimeout(t); } }, [count]);
  useEffect(() => { if (banner) { const t = setTimeout(() => setBanner(null), banner.kind === 'section' ? 1600 : 1500); return () => clearTimeout(t); } }, [banner]);
  // The end screen: the song plays again, quietly, from the top (round again when it ends).
  // A YouTube song plays in the results card (in the stars' place).
  useEffect(() => {
    if (phase !== 'results' || !song) return;
    let live = true;
    const go = () => {
      previewSong(song, () => { if (live) go(); }).then((p) => { if (live) replay.current = p; else p.stop(); }).catch(() => {});
    };
    const t = setTimeout(() => { setDuck(0.32); go(); }, 1400);
    // Back up to full volume as it goes (on the menu it carries on as the song's preview).
    return () => { live = false; clearTimeout(t); releaseReplay(); setDuck(1); };
  }, [phase, song]);
  useEffect(() => { if (callout) { const t = setTimeout(() => setCallout(null), 1700); return () => clearTimeout(t); } }, [callout]);

  const pause = useCallback(async () => {
    if (phaseRef.current !== 'playing') return;
    cancelFrame(raf.current);
    // A stage in a worker carries the time on by itself: stop it where the game stopped.
    if (stage.current instanceof StageProxy) stage.current.hold();
    await pauseAudio();
    pressed.current = [false, false, false, false];
    for (let l = 0; l < 4; l++) stage.current?.setPressed(l, false);
    setPhase('paused');
  }, []);

  const resume = useCallback(async () => {
    await resumeAudio();
    lastFrame.current = performance.now();
    setPhase('playing');
  }, []);

  // A YouTube song paused from inside its player (or by YouTube) pauses the game too.
  useEffect(() => ytOnState((st) => {
    // Only once the video has played: a "paused" before that is YouTube starting up (ytStarted).
    if (st === YT_STATE.PAUSED && ytIntent() === 'play' && ytStarted() && phaseRef.current === 'playing') pause();
  }), [pause]);

  const restart = useCallback(async () => {
    stopSong();
    await resumeAudio();
    start();
  }, [start]);

  const toggleDev = useCallback(() => setSettings({ devTools: !getSettings().devTools }), []);

  // Keyboard.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Backquote') { e.preventDefault(); toggleDev(); return; }
      if ((e.target as HTMLElement)?.closest?.('.devtools')) return;
      if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
      const p = phaseRef.current;
      if (p === 'ready' && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); start(); return; }
      if (p === 'results' && e.code === 'KeyR') { restart(); return; }
      if (p === 'results' && e.code === 'Escape') { navigate(href.song(songId, difficulty)); return; }
      if (e.code === 'Escape' || e.code === 'KeyP') { if (p === 'playing') pause(); else if (p === 'paused') resume(); return; }
      if (p === 'paused' && e.code === 'Space') { e.preventDefault(); resume(); return; }
      if (p !== 'playing' || !game.current) return;
      const lane = laneForCode(e.code);
      if (lane < 0) return;
      e.preventDefault();
      press(lane);
    };
    const up = (e: KeyboardEvent) => {
      if (phaseRef.current !== 'playing') return;
      const lane = laneForCode(e.code);
      if (lane >= 0) release(lane);
    };
    const blur = () => pause();
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', blur); };
  }, [start, restart, pause, resume, press, release, toggleDev]);

  // Touch and mouse: each pointer owns the lane it went down in.
  const laneAt = (clientX: number) => {
    if (stage.current) return stage.current.laneAt(clientX);
    if (!layout) return -1;
    const lane = Math.floor((clientX - layout.left) / layout.laneW);
    return lane >= 0 && lane < 4 ? lane : -1;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (phase === 'ready') { start(); return; }
    if (phase !== 'playing') return;
    const lane = laneAt(e.clientX);
    if (lane < 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointerLane.current.set(e.pointerId, lane);
    press(lane);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const lane = pointerLane.current.get(e.pointerId);
    pointerLane.current.delete(e.pointerId);
    if (lane !== undefined) release(lane);
  };

  const probe = useMemo<DevProbe>(() => ({
    game: () => game.current,
    // The song's clock while a run is on (slowing to a stop as the signal drops); none before or after.
    time: () => {
      const p = phaseRef.current;
      if (failing.current) return failing.current.t;
      return game.current && (p === 'playing' || p === 'paused' || p === 'starting') ? songTime(beat0.current) : null;
    },
    // A stage in a worker: the frames it draws, not the page's loop.
    fps: () => (stage.current instanceof StageProxy ? stage.current.fps : fps.current.value),
    particles: () => stage.current?.particleCount ?? null,
    offsets: () => offsets.current,
    renderer: use3d ? '3D' : '2D',
    fx: (kind: DevEffect) => {
      const s = stage.current;
      if (kind === 'milestone') {
        // Alternates 50 and 100, so both tiers can be seen.
        const v = (callout?.value ?? 100) === 100 ? 50 : 100;
        s?.milestone(v); bus.emit('milestone', { combo: v }); setCallout({ id: Date.now(), kind: 'combo', value: v });
      }
      else if (kind === 'fever') { const on = !fever.current; fever.current = on; s?.setFever(on); bus.emit('fever', { on }); if (on) setCallout({ id: Date.now(), kind: 'fever', value: 4 }); }
      else if (kind === 'section') { s?.section(true); setBanner({ id: Date.now(), kind: 'section', big: 'Section' }); }
      else if (kind === 'miss') { for (let l = 0; l < 4; l++) s?.miss(l); bus.emit('miss', { x: 0.5 }); }
      else if (kind === 'climb') { for (let k = 0; k < 4; k++) s?.climb(0, 1.2, { delay: k * 3 }); }
      else bus.emit('cue', { kind, strength: 1 });
      // While nothing is playing, show the effect anyway.
      if (s && phaseRef.current !== 'playing') {
        const t0 = performance.now();
        const spin = () => { s.frame(game.current ? songTime(beat0.current) : -4, game.current?.notes ?? []); if (performance.now() - t0 < 1800 && phaseRef.current !== 'playing') requestAnimationFrame(spin); };
        requestAnimationFrame(spin);
      }
    },
    retime: () => { if (song) stage.current?.setTiming(60 / song.bpm, fallTime(difficulty)); },
    deleteMap: async () => { await deleteSong(songId); navigate(href.home()); },
  }), [use3d, song, difficulty, songId, callout]);

  if (phase === 'error') {
    return (
      <div className="play-error" role="alert">
        <motion.div className="play-error-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE_OUT }}>
          <svg className="flatline" viewBox="0 0 240 40" aria-hidden><path d="M0 20 H92 L104 6 L114 32 L122 20 H240" /></svg>
          <h1>{song?.source.kind === 'youtube' ? "The video won't play" : song ? "The track won't load" : 'Map not found'}</h1>
          <p className="muted">{error}</p>
          <div className="play-error-actions">
            <button type="button" className="btn btn-primary" onClick={() => location.reload()}><Icon name="retry" /> Try again</button>
            <a className="btn btn-ghost" href={song ? href.song(song.id, difficulty) : href.home()}><Icon name="back" size={16} /> Back</a>
          </div>
        </motion.div>
      </div>
    );
  }

  const centre = song ? (anchor(1).x + anchor(2).x) / 2 : innerWidth / 2;
  const hitY = song ? anchor(0).y : innerHeight * 0.8;

  return (
    <div className={`play ${devTools ? 'has-dev' : ''} ${hud.multiplier >= 4 && hud.combo > 0 && phase === 'playing' ? 'is-fever' : ''} ${phase === 'failing' || (phase === 'results' && result?.failed) ? 'is-failing' : ''}`} style={song ? ({ '--hA': song.hues[0], '--hB': song.hues[1], '--inset': `${inset}px` } as React.CSSProperties) : undefined}>
      <div ref={host} className="play-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        role="application" aria-label="Playfield, 4 lanes. Keys D F J K.">
        {!use3d && <canvas ref={canvas} className="play-canvas" />}
      </div>

      {song && (
        <>
          <PlayHud song={song} difficulty={difficulty} section={section} hud={hud} clock={clock} bot={bot} devTools={devTools}
            canPause={phase === 'playing'} onDev={toggleDev} onPause={pause} combo={combo} panel={panel} />
          <ComboCallout callout={callout} step={MILESTONE} />

          <AnimatePresence>
            {banner && (
              <motion.div key={banner.id} className={`banner banner-${banner.kind}`} style={{ left: centre, top: banner.kind === 'section' ? hitY * 0.2 : hitY * 0.36 }}
                initial={{ opacity: 0, scale: banner.kind === 'section' ? 1 : 0.7, x: '-50%', y: '-50%' }}
                animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                exit={pf.uiFx === 'lite'
                  ? { opacity: 0, scale: banner.kind === 'section' ? 1 : 1.35, x: '-50%', y: '-50%' }
                  : { opacity: 0, scale: banner.kind === 'section' ? 1 : 1.35, x: '-50%', y: '-50%', filter: 'blur(6px)' }}
                transition={{ duration: 0.5, ease: EASE_OUT }}>
                {pf.uiFx === 'lite'
                  // Lite (profile B): final spacing, tightening by scale (no layout every frame).
                  ? <motion.span className={`banner-big ${banner.big.length > 6 ? 'is-wide' : ''}`} style={{ letterSpacing: banner.big.length > 6 ? '0.2em' : '0.4em', display: 'inline-block' }} initial={{ scaleX: banner.big.length > 6 ? 1.5 : 1.6 }} animate={{ scaleX: 1 }} transition={{ duration: 0.9, ease: EASE_OUT }}>{banner.big}</motion.span>
                  : <motion.span className={`banner-big ${banner.big.length > 6 ? 'is-wide' : ''}`} initial={{ letterSpacing: '0.9em' }} animate={{ letterSpacing: banner.big.length > 6 ? '0.2em' : '0.4em' }} transition={{ duration: 0.9, ease: EASE_OUT }}>{banner.big}</motion.span>}
                {banner.small && <span className="banner-small">{banner.small}</span>}
              </motion.div>
            )}
          </AnimatePresence>

          <JudgePool ref={judgePool} />

          <AnimatePresence>
            {count !== null && phase === 'playing' && (
              <motion.div key={count} className="countdown" initial={{ opacity: 0, scale: 1.5 }} animate={{ opacity: 1, scale: 1 }} exit={pf.uiFx === 'lite' ? { opacity: 0, scale: 0.8 } : { opacity: 0, scale: 0.8, filter: 'blur(8px)' }} transition={{ duration: 0.3, ease: EASE_OUT }}
                style={{ left: centre, top: hitY * 0.42, x: '-50%', y: '-50%' }}>
                <span>{count === 0 ? 'Go' : count}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {phase === 'failing' && (
              <motion.div key="signal" className="signal-lost" aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.5 } }}
                style={{ '--fail-s': `${FAIL_SECONDS}s`, top: hitY * 0.46 } as React.CSSProperties}>
                <span className="signal-line" />
                <span className="signal-word">Signal lost</span>
              </motion.div>
            )}
          </AnimatePresence>

          {devTools && (
            <DevTools song={song} difficulty={difficulty} probe={probe} bot={bot} onBot={setBot} section={section} onClose={toggleDev} />
          )}
        </>
      )}

      <AnimatePresence>
        {(phase === 'ready' || phase === 'starting') && song && (
          <StartCard key="start" song={song} difficulty={difficulty} starting={phase === 'starting'} milestone={MILESTONE} onStart={start} />
        )}
        {phase === 'paused' && (
          <PauseCard key="paused" at={clock} of={song ? (song.lengthBeats * 60) / song.bpm : 0} onResume={resume} onRestart={restart} onQuit={() => navigate(href.song(songId, difficulty))} />
        )}
        {phase === 'loading' && (
          <Loader key="loading" title={song?.title} artist={song?.artist} hues={song?.hues}
            status={!song ? 'Loading the map' : song.source.kind === 'youtube' ? 'Getting the video ready' : 'Loading the track'} />
        )}
      </AnimatePresence>

      {phase === 'results' && result && song && (
        <Results song={song} difficulty={difficulty} result={result} previousBest={prevBest} saving={saving} onRetry={() => { if (!result.assisted) setPrevBest(Math.max(prevBest ?? 0, result.failed ? 0 : result.score) || undefined); restart(); }} />
      )}
    </div>
  );
}
