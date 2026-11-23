import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../api/client';
import type { Difficulty, Song } from '../api/types';
import { learnFromRun } from '../audio/syncer';
import { COUNT_BEATS, audioLevels, handOverPreview, overdriveSweep, pauseAudio, playbackRate, prepareSong, previewSong, resumeAudio, setDuck, songMelody, songTime, startSong, stopSong, unlockAudio, windDown, type PreviewHandle } from '../audio/playback';
import { VideoError, YT_STATE, ytDuration, ytIntent, ytLoadedFraction, ytOnState, ytRawTime, ytStarted, ytState } from '../audio/youtube';
import { LagWatch, connectionInfo } from '../game/lag';
import { LagCard, type LagView } from '../components/play/LagCard';
import { ComboCallout, type Callout } from '../components/play/ComboCallout';
import { DevTools, type DevEffect, type DevProbe } from '../components/play/DevTools';
import { PlayHud, type HudState } from '../components/play/PlayHud';
import { OverdriveFx, type OverdriveFxHandle } from '../components/play/OverdriveFx';
import { DropFx, type DropFxHandle } from '../components/play/DropFx';
import { dropAt, type DropZone } from '../mapping/cues';
import { songDrops } from '../mapping/drops';
import { createStore, useStore, type Store } from '../lib/store';
import { PauseCard, StartCard, type Practice } from '../components/play/PlayCards';
import { botPlan, type BotMode } from '../game/autoplay';
import { Icon } from '../components/Icon';
import { Loader } from '../components/Loader';
import { Results, type RunResult } from '../components/play/Results';
import { openHowToPlay } from '../components/HowToPlay';
import { ControllerLink, type LinkStatus } from '../game/controllerLink';
import type { PlayState } from '../api/types';
import { Game, MAX_OVERDRIVE, OVERDRIVE_LENGTH, OVERDRIVE_LOW, fallTime, gradeFor, laneForCode, multiplierFor, type GameEvent, type Judgement } from '../game/engine';
import { OVERDRIVE_LOOKS, overdriveCss, overdriveHues } from '../game/overdrive';
import { POINT_SCALE, holdBonus } from '../game/score';
import { getBinds, keyLabel, laneKeyList, useBinds } from '../lib/keys';
import { useServer } from '../lib/server';
import { drawField, laneHue, layoutFor, type Layout } from '../game/render';
import type { RiveHandle } from '../rive/RiveAnim';
import { FAIL_SECONDS, Stage3D } from '../stage/Stage3D';
import { StageProxy } from '../stage/proxy';
import { graphicsLevel } from '../lib/graphics';
import { SlowWatch } from '../game/slow';
import { bus } from '../lib/bus';
import { href, navigate, parse } from '../lib/router';
import { getSettings, setSettings, useSettings } from '../lib/settings';
import { deleteSong, fetchSong, isTestSong, upsert } from '../library/songs';
import { EASE_OUT } from '../lib/motion';
import { frameGate, perf } from '../lib/perf';
import { ORDER, cancelFrame, nextFrame } from '../lib/ticker';
import { JudgePool, type JudgePoolHandle } from '../components/play/JudgePool';
import { forward } from '../background/host';
import { themeHues } from '../background/themes';

/**
 * resuming: back from the pause, counting 3, 2, 1 before the song carries on. buffering: a
 * YouTube song's video stalled, the game held until enough has loaded; lagging: it keeps stalling,
 * the "your connection is slow" card (game/lag.ts).
 */
type Phase = 'loading' | 'ready' | 'starting' | 'playing' | 'paused' | 'resuming' | 'buffering' | 'lagging' | 'failing' | 'results' | 'error';
/** A judgement word's kind. */
type PopupKind = Judgement | 'hold';
/** The stage's hit burst and hold glow on one pad. */
interface BurstHandle { fire(kind: Judgement): void }
interface HoldHandle { start(): void; end(ok: boolean): void }
/** Centred over the far end of the lanes: a new section, and the finale (fever = gold). */
interface Banner { id: number; kind: 'fever' | 'section'; big: string; small?: string }

const JUDGE_TEXT: Record<Judgement, string> = { perfect: 'Perfect', great: 'Great', good: 'Good', miss: 'Miss' };
const MILESTONE = 25;
const EMPTY_HUD: HudState = { score: 0, combo: 0, accuracy: 1, health: 1, multiplier: 1, progress: 0, counts: { perfect: 0, great: 0, good: 0, miss: 0 }, charge: 0, overdrive: 0, overdriveLeft: 0, odGain: 0, odSafe: 0 };
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
  // The run panel's numbers (ten times a second) live in a store the panel and the Overdrive layer
  // read, so this whole screen doesn't re-render with them: it follows `look` (fever, Overdrive's
  // level, running out), which changes a few times a song.
  const hudStore = useMemo(() => createStore<HudState>({ ...EMPTY_HUD, counts: { ...EMPTY_HUD.counts } }), []);
  const setHud = hudStore.set;
  const [look, setLook] = useState({ fever: false, od: 0, low: false });
  useEffect(() => hudStore.subscribe(() => {
    const h = hudStore.get();
    const next = { fever: multiplierFor(h.combo) >= 5, od: h.overdrive, low: h.overdrive > 0 && h.overdriveLeft <= OVERDRIVE_LOW / OVERDRIVE_LENGTH };
    setLook((l) => (l.fever === next.fever && l.od === next.od && l.low === next.low ? l : next));
  }), [hudStore]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [callout, setCallout] = useState<Callout | null>(null);
  /** Screen space the left HUD panel covers. */
  const [inset, setInsetState] = useState(0);
  const [section, setSection] = useState('');
  const [clock, setClock] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [saving, setSaving] = useState<'saving' | 'saved' | 'error' | 'skipped'>('saving');
  // The run whose score was kept: the results ask how it felt (once a run).
  const [kept, setKept] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');
  const [prevBest, setPrevBest] = useState<number | undefined>();
  const [layout, setLayout] = useState<Layout | null>(null);
  // The 3D stage, unless WebGL is missing or the graphics are set to Simple (lib/graphics.ts).
  const [use3d] = useState(() => Stage3D.supported() && graphicsLevel() !== 'simple');
  const [bot, setBotState] = useState<BotMode>('off');
  const { devTools } = useSettings();
  const binds = useBinds();
  // A sleeping song server: the loader says so while the map waits for it.
  const server = useServer();
  const waking = server.state === 'waking' || server.state === 'down';
  /** The dev tools' Overdrive preview: the level the stage shows (looks only, no score). */
  const devOd = useRef(0);
  /** Overdrive across the screen (the flash, shockwaves, the ready cue, the tally). */
  const odFx = useRef<OverdriveFxHandle>(null);
  /** Overdrive's bonus when this Overdrive started (what it has added is the bonus since), and its level. */
  const odFrom = useRef(0);
  const odLevel = useRef(0);
  /** A miss in Overdrive's grace was just told (overdriveHeld): its popup says so. */
  const held = useRef(false);
  /** Whether the stage is showing the charge as full (kept in step with the game every frame). */
  const odReady = useRef(false);
  /**
   * Practice mode: a stretch of the song on a loop, maybe slowed down. Nothing is saved, there is
   * no fail, and each time round starts over (a fresh score). Null: a normal run.
   */
  const practiceRef = useRef<Practice | null>(null);
  /** What the start card would start (Enter starts the same): null for the whole song. */
  const chosenPractice = useRef<Practice | null>(null);
  const onChoose = useCallback((p: Practice | null) => { chosenPractice.current = p; }, []);
  const [practice, setPractice] = useState<Practice | null>(null);
  const loops = useRef(0);

  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // The stage on this thread, or a stand-in for the stage drawing in a worker.
  const stage = useRef<Stage3D | StageProxy | null>(null);
  const game = useRef<Game | null>(null);
  // The controller (main.Main on the server): every press and the clock go to it; what it counted shows on the panel.
  const link = useRef<ControllerLink | null>(null);
  const modelStore = useMemo(() => createStore<ModelView>(null), []);
  const setModel = modelStore.set;
  useEffect(() => () => link.current?.stop(), []);
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
  // Slow moments (dev tools): what was set off when the frames fell (game/slow.ts).
  const slow = useRef(new SlowWatch());
  const lastIntensity = useRef(0);
  const songEnergy = useRef(0);
  /**
   * The song's drops (where drop mode plays: the stage's lasers, the edges, the badge), and the one
   * playing now (-1: none), followed on the song's clock every frame, so pausing, practice loops and
   * restarts stay right. `level`: the 2D fallback's drop, eased.
   */
  const drops = useRef<DropZone[]>([]);
  const dropNow = useRef({ index: -1, level: 0 });
  const dropFx = useRef<DropFxHandle>(null);

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
        // A best on the old points (before main.Score's rules) isn't one to beat.
        const b = s.best?.[difficulty];
        setPrevBest(b?.rules === 'overdrive' ? b.score : undefined);
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
      bus.emit('overdrive', { level: 0 });
      bus.emit('drop', { strength: 0 });
      bus.emit('intensity', 0.15);
    };
  }, []);
  useEffect(() => { if (song) bus.emit('hues', song.hues); }, [song]);
  useEffect(() => { drops.current = song ? songDrops(song) : []; }, [song]);
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
      const opts = { mode: 'play' as const, hues: song.hues, light: graphicsLevel() === 'light' };
      const s = StageProxy.supported() ? new StageProxy(host.current, opts) : new Stage3D(host.current, opts);
      s.setTiming(60 / song.bpm, fallTime(difficulty, song.bpm));
      // The sky takes the song's colours, unless the Background setting holds a theme.
      const held = themeHues(getSettings().backdrop);
      if (held) s.skyEvent({ type: 'hues', hues: held });
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
    // While Overdrive runs, the words take its colours too.
    const od = game.current?.overdriveLevel ?? 0;
    const color = !song ? '' : od ? overdriveCss(od, lane, songTime(beat0.current), 84) : `hsl(${laneHue(lane, 4, song.hues)} 100% 80%)`;
    judgePool.current?.show({
      lane, text, sub, x: a.x, y: a.y, miss: kind === 'miss', perfect: kind === 'perfect', hold: kind === 'hold',
      color: kind === 'miss' || kind === 'hold' || !song ? undefined : color,
    });
  }, [anchor, song]);

  const finish = useCallback(async () => {
    const g = game.current;
    if (!g || !song) return;
    cancelFrame(raf.current);
    const end = songTime(beat0.current);
    stopSong();
    // The controller's count of the run (its last answer), for the results.
    const counted = link.current;
    const finished = counted ? counted.finish(g.failed ? end : end + 1).then((s) => { setModel({ state: s, status: counted.status }); return s; }) : null;
    const accuracy = g.accuracy;
    // The grade is the score against the chart's best (score.ts gradeFor, parScore).
    const grade = gradeFor(g.stats.score, g.par, g.failed);
    const meanOffsetMs = offsets.current.length >= 8 ? (offsets.current.reduce((a, b) => a + b, 0) / offsets.current.length) * 1000 : null;
    const r: RunResult = {
      score: g.stats.score, par: g.par, accuracy, maxCombo: g.stats.maxCombo, counts: { ...g.stats.counts }, grade, failed: g.failed, total: g.stats.total, meanOffsetMs, assisted: assisted.current,
      reached: g.failed ? { at: Math.max(0, failing.current?.t ?? songTime(beat0.current)), of: (song.lengthBeats * 60) / song.bpm } : undefined,
      overdrive: g.overdriveStats,
    };
    setResult(r);
    setKept(null);
    setPhase('results');
    bus.emit('intensity', g.failed ? 0.05 : 0.5);
    if (assisted.current || isTestSong(song.id)) { setSaving('skipped'); return; }
    setSaving('saving');
    setSaveError('');
    // The Map Syncer: hits that were steadily early or late move a YouTube song's map for next time
    // (saved before the score, so the two saves can't undo each other).
    const offset = await learnFromRun(song, offsets.current).catch(() => null);
    if (offset !== null) setSong((s) => (s && s.id === song.id ? { ...s, source: { ...s.source, offset } } : s));
    try {
      // The controller has the whole run first: the score is kept only from the run it reviewed.
      await finished?.catch(() => null);
      const play = counted?.runId ?? undefined;
      const updated = await api.submitScore(song.id, { difficulty, score: r.score, accuracy, maxCombo: r.maxCombo, grade, run: g.run, tiles: g.tiles(), ...(play ? { play } : {}) });
      upsert(updated);
      setKept(play ?? null);
      setSaving('saved');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '');
      setSaving('error');
    }
  }, [song, difficulty]);

  /**
   * The run failed: the signal drops. The music winds down like a tape stopping, the tiles slow
   * to a halt, the lanes go dark from the outside in and the camera sags (Stage3D.fail); then
   * the results. The frame loop keeps drawing until it's over.
   */
  /**
   * Drop mode follows the song's clock: entering a drop sets the stage's lasers and warp going
   * (Stage3D.setDrop), the sky's wash (the bus), the edges and the badge (DropFx); leaving one ends
   * them. Back to back drops carry straight on with the next one's strength.
   */
  const followDrop = useCallback((t: number) => {
    if (!song) return;
    const spb = 60 / song.bpm;
    const d = dropNow.current;
    const at = dropAt(drops.current, t / spb);
    const index = at ? at.index : -1;
    // (-2: the dev tools' drop mode, held until a real drop comes.)
    if (index !== d.index && !(d.index === -2 && index === -1)) {
      d.index = index;
      const strength = at ? at.zone.strength : 0;
      stage.current?.setDrop(strength);
      bus.emit('drop', { strength });
      if (at) dropFx.current?.enter(strength);
      else dropFx.current?.exit();
    }
    d.level += ((at ? at.zone.strength : d.index === -2 ? 1 : 0) - d.level) * 0.08;
  }, [song]);
  /** Out of drop mode at once (a fail, a restart, the results). */
  const endDrop = useCallback(() => {
    const d = dropNow.current;
    d.level = 0;
    if (d.index === -1) return;
    d.index = -1;
    stage.current?.setDrop(0);
    bus.emit('drop', { strength: 0 });
    dropFx.current?.exit();
  }, []);
  // Off the song (the start card, the results, an error): no drop mode.
  useEffect(() => {
    if (phase === 'ready' || phase === 'results' || phase === 'error' || phase === 'loading') endDrop();
  }, [phase, endDrop]);

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
    endDrop();
    windDown(FAIL_SECONDS);
    bus.emit('fever', { on: false });
    bus.emit('overdrive', { level: 0 });
    odFx.current?.reset();
    bus.emit('miss', { x: 0.5 });
    bus.emit('intensity', 0.05);
    if (song) bus.emit('hues', song.hues);
    setPhase('failing');
  }, [song, endDrop]);

  // Hitting a tile makes no sound: the song is the sound. Every hit is light and motion instead.
  const handle = useCallback((events: GameEvent[]) => {
    const g = game.current;
    if (!g || !song) return;
    let hudChanged = false;
    for (const e of events) {
      slow.current.note(e.type === 'judge' ? (e.judgement === 'miss' ? 'miss' : 'hit') : e.type);
      if (e.type === 'judge') {
        hudChanged = true;
        const lane = e.note.lane;
        const x = anchor(lane).x / innerWidth;
        bursts.current[lane]?.fire(e.judgement);
        if (e.judgement === 'miss') {
          stage.current?.miss(lane);
          bus.emit('miss', { x });
          popup(lane, 'miss', JUDGE_TEXT.miss, held.current ? 'Overdrive held' : undefined);
          held.current = false;
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
        if (e.ok) { popup(e.note.lane, 'hold', 'Held', `+${(holdBonus(e.note.end - e.note.time) * POINT_SCALE * g.multiplier).toLocaleString()}`); stage.current?.hit(e.note.lane, 'great'); }
        else { popup(e.note.lane, 'miss', 'Let go', held.current ? 'Overdrive held' : undefined); held.current = false; bursts.current[e.note.lane]?.fire('miss'); stage.current?.miss(e.note.lane); }
      } else if (e.type === 'comboBreak') {
        combo.current?.fire('break');
      } else if (e.type === 'stray') {
        // A key with no tile to hit: a red flicker on its pad, and the signal and charge drain.
        hudChanged = true;
        bursts.current[e.lane]?.fire('miss');
        popup(e.lane, 'miss', 'Stray');
      } else if (e.type === 'charged') {
        hudChanged = true;
      } else if (e.type === 'overdrive') {
        // Overdrive goes up a level (or, at V, is kept going): the field takes the level's colours
        // with a burst and a lunge into warp, the sky storms, the song whooshes, the screen flashes.
        hudChanged = true;
        if (!odLevel.current) odFrom.current = g.overdriveStats.bonus;
        odLevel.current = e.level;
        odReady.current = false;
        stage.current?.setOverdriveReady(false);
        stage.current?.setOverdriveLow(false);
        stage.current?.setOverdrive(e.level, true);
        bus.emit('hues', overdriveHues(e.level) ?? song.hues);
        bus.emit('overdrive', { level: e.level });
        bus.emit('milestone', { combo: g.stats.combo });
        if (!stage.current) addClimb(0, 2 + e.level);
        overdriveSweep(e.level);
        odFx.current?.levelUp(e.level);
        impact(2 + e.level * 0.4);
        setCallout({ id: Date.now(), kind: 'overdrive', value: e.level });
      } else if (e.type === 'overdriveHeld') {
        // A miss in the grace (just after the press): Overdrive carries on; the miss's popup says so.
        held.current = true;
        odFx.current?.held();
      } else if (e.type === 'overdriveLow') {
        // About to run out: the field flickers between its colours and the song's (the HUD blinks).
        stage.current?.setOverdriveLow(true);
      } else if (e.type === 'overdriveEnd') {
        hudChanged = true;
        stage.current?.setOverdriveLow(false);
        // Run out, or broken by a miss (it shatters).
        stage.current?.setOverdrive(0, false, e.broken);
        bus.emit('hues', song.hues);
        bus.emit('overdrive', { level: 0 });
        odFx.current?.end(odLevel.current, g.overdriveStats.bonus - odFrom.current, e.broken);
        odLevel.current = 0;
      } else if (e.type === 'fail') {
        dropSignal();
      }
    }
    if (hudChanged) {
      const s = g.stats;
      const level = s.combo === 0 ? 0 : multiplierFor(s.combo);
      // (The HUD's numbers: the frame loop copies the stats a few times a second.)
      combo.current?.set('level', level);
      const on = level >= 5;
      if (on && !fever.current) setCallout({ id: Date.now(), kind: 'fever', value: 5 });
      if (on !== fever.current) bus.emit('fever', { on });
      fever.current = on;
      stage.current?.setFever(on);
    }
  }, [song, popup, dropSignal, anchor, impact, pf]);

  /** The Overdrive key (or the HUD's button): sets it off with a full charge. */
  const fireOverdrive = useCallback(() => {
    const g = game.current;
    if (!g || phaseRef.current !== 'playing') return;
    handle(g.overdrive(songTime(beat0.current)));
  }, [handle]);

  // `at`: the song time of the press, when it isn't now (the autoplay bot presses at its planned
  // moment, so a slow frame doesn't make a perfect run late).
  const press = useCallback((lane: number, at?: number) => {
    const g = game.current;
    if (!g) return;
    pressed.current[lane] = true;
    stage.current?.setPressed(lane, true);
    const t = at ?? songTime(beat0.current);
    link.current?.press(lane, t);
    handle(g.press(lane, t));
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
    if (g.canOverdrive) handle(g.overdrive(t));
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
  }, [press, release, handle]);

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
    if (now - f.since >= 500) {
      f.value = (f.frames * 1000) / (now - f.since); f.frames = 0; f.since = now;
      if (phaseRef.current === 'playing') {
        const st = stage.current;
        const m = slow.current.sample({ page: f.value, stage: st instanceof StageProxy ? st.fps : f.value, res: st && 'resolution' in st ? (st as { resolution: number }).resolution : 1, song: songTime(beat0.current) }, now);
        if (m && import.meta.env.DEV) console.warn('[slow]', m);
      }
    }
    const fail = failing.current;
    if (fail) {
      // The clock slows to a stop with the music; nothing is judged any more.
      const k = Math.min(1, (now - fail.start) / 1000 / FAIL_SECONDS);
      fail.t += ((now - fail.last) / 1000) * Math.pow(1 - k, 1.5);
      fail.last = now;
      if (stage.current) stage.current.frame(fail.t, g.notes);
      else if (canvas.current && layout) {
        drawField(canvas.current.getContext('2d')!, layout, {
          now: fail.t, speed: layout.hitY / fallTime(difficulty, song.bpm), spb: 60 / song.bpm, notes: g.notes,
          pressed: [false, false, false, false], flash: [0, 0, 0, 0], hues: song.hues, keys: laneKeyList(getBinds()).map((x) => x.label), beatPulse: 0, climbs: [],
        });
      }
      if (k >= 1) { finish(); return; }
      raf.current = nextFrame(loop, ORDER.game);
      return;
    }
    const t = songTime(beat0.current);
    link.current?.tick(t);
    // The bot also catches up after a pause, so skip it while it is off and nothing is held.
    if (botRef.current !== 'off' || botRelease.current.some(Boolean)) botStep(g, t);
    else { while (botIdx.current < g.notes.length && g.notes[botIdx.current].time < t) botIdx.current++; }
    handle(g.update(t));
    followDrop(t);
    // The stage's ready beacons follow the charge (a miss or a stray can take it below full again).
    // (At the top level it can't be set off: no beacons then, however full the charge.)
    if (g.canOverdrive !== odReady.current) { odReady.current = g.canOverdrive; stage.current?.setOverdriveReady(g.canOverdrive); }
    for (let i = 0; i < 4; i++) flash.current[i] *= 0.86;
    beatPulse.current *= 0.9;
    const s = stage.current;
    if (s) {
      for (let l = 0; l < 4; l++) if (g.isHolding(l)) s.holding(l, dt);
      s.setLevels(audioLevels());
      // `now`: when the song time was read (a stage in a worker carries it on from then).
      // (Practice slows the song: the worker carries the time on at the same speed.)
      if (s instanceof StageProxy) s.frame(t, g.notes, now, playbackRate()); else s.frame(t, g.notes);
    } else if (canvas.current && layout) {
      const c = climb2d.current;
      const lv = audioLevels().level;
      c.avg += (lv - c.avg) * Math.min(1, Math.max(0, t - c.now) * 0.6);
      c.level = lv;
      c.now = t;
      const speed = layout.hitY / fallTime(difficulty, song.bpm);
      drawField(canvas.current.getContext('2d')!, layout, {
        now: t, speed, spb: 60 / song.bpm, notes: g.notes, pressed: pressed.current.map((p, i) => p || g.isHolding(i)),
        flash: flash.current, hues: g.overdriveLevel ? overdriveHues(g.overdriveLevel, t) ?? song.hues : song.hues, keys: laneKeyList(getBinds()).map((k) => k.label), beatPulse: beatPulse.current, climbs: c.starts,
        mono: OVERDRIVE_LOOKS[g.overdriveLevel]?.mono ? 1 : 0,
        drop: dropNow.current.level,
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
      const charge = g.charge, od = g.overdriveLevel, left = g.overdriveLeft;
      const odGain = od ? Math.round(g.overdriveStats.bonus - odFrom.current) : 0;
      // Overdrive's grace left (tenths of a second, so the HUD only changes when it shows).
      const odSafe = Math.ceil(g.graceLeft(t) * 10) / 10;
      setHud((h) => (h.score === s.score && h.combo === s.combo && h.health === s.health && h.counts.miss === s.counts.miss && Math.abs(progress - h.progress) <= 0.004
        && h.charge === charge && h.overdrive === od && h.overdriveLeft === left && h.odGain === odGain && h.odSafe === odSafe ? h
        : { score: s.score, combo: s.combo, accuracy: g.accuracy, health: s.health, multiplier: g.multiplier, progress, counts: { ...s.counts }, charge, overdrive: od, overdriveLeft: left, odGain, odSafe }));
    }
    if (practiceRef.current) { raf.current = nextFrame(loop, ORDER.game); return; }
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
  }, [layout, song, difficulty, handle, finish, botStep, pf, followDrop]);

  const start = useCallback(async (practiceRun?: Practice | null) => {
    if (!song || phaseRef.current === 'starting') return;
    // A practice keeps going round until the player stops it; a new start from the card is a new choice.
    const p = practiceRun === undefined ? null : practiceRun;
    if (!p || p !== practiceRef.current) loops.current = 0;
    practiceRef.current = p;
    setPractice(p);
    setPhase('starting');
    await unlockAudio();
    const whole = song.charts[difficulty];
    // Practice: only the stretch's tiles (at their real times in the song).
    const chart = p ? { ...whole, notes: whole.notes.filter((n) => n.t >= p.from && n.t < p.to) } : whole;
    const g = new Game(chart, song.bpm, difficulty, { noFail: p ? true : getSettings().noFail });
    game.current = g;
    // The run goes through the controller too (practice: a run of just the stretch, each time round).
    link.current?.stop();
    const spbOf = 60 / song.bpm;
    link.current = new ControllerLink(song.id, difficulty, (state, status) => setModel({ state, status }), () => g.run, p ? { from: p.from * spbOf, to: p.to * spbOf } : undefined);
    setModel({ state: null, status: 'starting' });
    pressed.current = [false, false, false, false];
    flash.current = [0, 0, 0, 0];
    offsets.current = [];
    botIdx.current = 0;
    botRelease.current = [0, 0, 0, 0];
    // Practice runs are never saved (as with autoplay).
    assisted.current = botRef.current !== 'off' || !!p;
    fever.current = false;
    failing.current = null;
    cleared.current = false;
    stage.current?.revive();
    endDrop();
    judgePool.current?.clear();
    setResult(null);
    setBanner(null);
    setCallout(null);
    setSection('');
    setClock(0);
    for (let l = 0; l < 4; l++) holds.current[l]?.end(true);
    setHud({ ...EMPTY_HUD, counts: { ...EMPTY_HUD.counts } });
    combo.current?.set('level', 0);
    stage.current?.setFever(false);
    stage.current?.setOverdrive(0);
    stage.current?.setOverdriveReady(false);
    stage.current?.setOverdriveLow(false);
    odReady.current = false;
    odLevel.current = 0;
    odFrom.current = 0;
    odFx.current?.reset();
    devOd.current = 0;
    bus.emit('overdrive', { level: 0 });
    bus.emit('hues', song.hues);
    const spb = 60 / song.bpm;
    const travel = fallTime(difficulty, song.bpm);
    stage.current?.setTiming(spb, travel);
    const leadInBeats = Math.max(4, Math.ceil((travel + 0.4) / spb / 4) * 4);
    try {
      // Synth songs play every note of the map themselves, so each tile is a note you hear.
      beat0.current = await startSong(song, {
        leadInBeats,
        onCount: (n) => setCount(n <= 3 ? n : null),
        autoMelody: song.source.kind === 'synth' ? songMelody(song) : undefined,
        ...(p ? {
          fromBeat: p.from, beats: p.to - p.from, rate: p.speed,
          // Round again: the same stretch, a fresh run.
          onEnd: () => { if (practiceRef.current === p && phaseRef.current === 'playing') { loops.current++; startRef.current?.(p); } },
        } : {}),
      });
      if (p && loops.current > 0) setBanner({ id: Date.now(), kind: 'section', big: `Loop ${loops.current + 1}`, small: p.label });
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

  const startRef = useRef<typeof start | null>(null);
  startRef.current = start;

  // Keep the running loop pointing at the latest closure.
  useEffect(() => {
    if (phase !== 'playing' && phase !== 'failing') return;
    cancelFrame(raf.current);
    raf.current = nextFrame(loop, ORDER.game);
    return () => cancelFrame(raf.current);
  }, [loop, phase]);

  useEffect(() => { if (count === 0) { const t = setTimeout(() => setCount(null), 600); return () => clearTimeout(t); } }, [count]);
  useEffect(() => { if (banner) slow.current.note(`banner ${banner.kind}`); }, [banner]);
  useEffect(() => { if (callout) slow.current.note(`callout ${callout.kind}`); }, [callout]);
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

  /**
   * The video stalled (a YouTube song): the game holds where it is, like a pause, while the video
   * loads ahead (pausing it doesn't stop it loading). See the lag watch below.
   */
  const stall = useCallback(async () => {
    if (phaseRef.current !== 'playing') return;
    phaseRef.current = 'buffering';
    setPhase('buffering');
    cancelFrame(raf.current);
    if (stage.current instanceof StageProxy) stage.current.hold();
    await pauseAudio();
    pressed.current = [false, false, false, false];
    for (let l = 0; l < 4; l++) stage.current?.setPressed(l, false);
  }, []);

  /**
   * Back from the pause (or a stall): 3, 2, 1 (on the song's beat, half a second to 0.75 s a
   * number) over the held stage, then the song carries on. Escape during it goes back to the pause.
   */
  const resumeTimer = useRef(0);
  const resume = useCallback(() => {
    if (phaseRef.current !== 'paused' && phaseRef.current !== 'buffering' && phaseRef.current !== 'lagging') return;
    const step = Math.min(0.75, Math.max(0.5, song ? 60 / song.bpm : 0.6)) * 1000;
    phaseRef.current = 'resuming';
    setPhase('resuming');
    let n = COUNT_BEATS;
    setCount(n);
    const tick = async () => {
      if (phaseRef.current !== 'resuming') return;
      n--;
      if (n > 0) { setCount(n); resumeTimer.current = window.setTimeout(tick, step); return; }
      setCount(null);
      await resumeAudio();
      lastFrame.current = performance.now();
      phaseRef.current = 'playing';
      setPhase('playing');
    };
    resumeTimer.current = window.setTimeout(tick, step);
  }, [song]);
  const cancelResume = useCallback(() => {
    clearTimeout(resumeTimer.current);
    setCount(null);
    phaseRef.current = 'paused';
    setPhase('paused');
  }, []);
  useEffect(() => () => clearTimeout(resumeTimer.current), []);

  // The video lagging (YouTube songs): a stall holds the game until READY_AHEAD seconds have
  // loaded ahead, then 3, 2, 1; a long stall, or one soon after another, brings up the card.
  // Sampled a few times a second while it plays too, so the card knows how fast it loads.
  const lag = useRef(new LagWatch());
  const [lagView, setLagView] = useState<LagView | null>(null);
  const isVideo = song?.source.kind === 'youtube';
  useEffect(() => {
    if (!isVideo) return;
    const id = window.setInterval(() => {
      const p = phaseRef.current, w = lag.current, now = performance.now();
      if (p !== 'playing' && p !== 'buffering' && p !== 'lagging' && p !== 'resuming') return;
      w.sample(now, ytRawTime(), ytLoadedFraction(), ytDuration());
      if (p === 'playing' && ytState() === YT_STATE.BUFFERING && ytIntent() === 'play' && ytStarted()) {
        w.startStall(now);
        void stall();
        return;
      }
      if (p === 'buffering') {
        if (w.heavy(now)) { w.showCard(); phaseRef.current = 'lagging'; setPhase('lagging'); }
        else if (w.ready) { w.endStall(now); resume(); }
      }
      if (p === 'buffering' || p === 'lagging') {
        const c = connectionInfo();
        setLagView({ ahead: w.ahead, rate: w.rate, complete: w.complete, mbps: c?.mbps ?? null, strong: w.strong, mustWait: w.mustWait, cards: w.cards });
      }
    }, 250);
    return () => clearInterval(id);
  }, [isVideo, stall, resume]);
  const lagContinue = useCallback(() => { lag.current.endStall(performance.now()); resume(); }, [resume]);

  // A YouTube song paused from inside its player (or by YouTube) pauses the game too.
  useEffect(() => ytOnState((st) => {
    // Only once the video has played: a "paused" before that is YouTube starting up (ytStarted).
    if (st === YT_STATE.PAUSED && ytIntent() === 'play' && ytStarted() && phaseRef.current === 'playing') pause();
  }), [pause]);

  const restart = useCallback(async () => {
    stopSong();
    await resumeAudio();
    start(practiceRef.current);
  }, [start]);

  const toggleDev = useCallback(() => setSettings({ devTools: !getSettings().devTools }), []);

  // Keyboard.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Backquote') { e.preventDefault(); toggleDev(); return; }
      if ((e.target as HTMLElement)?.closest?.('.devtools')) return;
      // A dialog open over the start card (How to play) has the keys.
      if (document.querySelector('dialog[open]')) return;
      if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
      const p = phaseRef.current;
      if (p === 'ready' && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); start(chosenPractice.current); return; }
      if (p === 'results' && e.code === 'KeyR') { restart(); return; }
      if (p === 'results' && e.code === 'Escape') { navigate(href.song(songId, difficulty)); return; }
      const b = getBinds();
      const bound = b.lanes.includes(e.code) || b.overdrive === e.code;
      // P pauses too, unless it's one of the player's keys.
      if (e.code === 'Escape' || (e.code === 'KeyP' && !bound)) { if (p === 'playing') pause(); else if (p === 'paused') resume(); else if (p === 'resuming') cancelResume(); return; }
      if (p === 'paused' && e.code === 'Space') { e.preventDefault(); resume(); return; }
      if (p !== 'playing' || !game.current) return;
      if (e.code === b.overdrive) { e.preventDefault(); fireOverdrive(); return; }
      const lane = laneForCode(e.code, 4, b.lanes, [b.overdrive]);
      if (lane < 0) return;
      e.preventDefault();
      press(lane);
    };
    const up = (e: KeyboardEvent) => {
      if (phaseRef.current !== 'playing') return;
      const b = getBinds();
      const lane = laneForCode(e.code, 4, b.lanes, [b.overdrive]);
      if (lane >= 0) release(lane);
    };
    const blur = () => pause();
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', blur); };
  }, [start, restart, pause, resume, cancelResume, press, release, toggleDev, fireOverdrive]);

  // Touch and mouse: each pointer owns the lane it went down in.
  const laneAt = (clientX: number) => {
    if (stage.current) return stage.current.laneAt(clientX);
    if (!layout) return -1;
    const lane = Math.floor((clientX - layout.left) / layout.laneW);
    return lane >= 0 && lane < 4 ? lane : -1;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (phase === 'ready') { start(null); return; }
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
    slow: () => slow.current,
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
      else if (kind === 'overdrive') {
        // Steps the look through the levels (no score): 1, 2, 3, 4, 5, off. Everything a real one
        // does: the stage, the sky's warp, the screen's flash, the song's whoosh, the callout.
        const lv = (devOd.current + 1) % (MAX_OVERDRIVE + 1);
        const was = devOd.current;
        devOd.current = lv;
        s?.setOverdriveLow(false);
        s?.setOverdrive(lv);
        bus.emit('hues', (lv ? overdriveHues(lv) : null) ?? song?.hues ?? null);
        bus.emit('overdrive', { level: lv });
        if (lv) {
          overdriveSweep(lv);
          odFx.current?.levelUp(lv);
          setCallout({ id: Date.now(), kind: 'overdrive', value: lv });
        } else odFx.current?.end(was, 12345);
      }
      // The charge full (the beacons and the cue) and running out (the flicker), on and off.
      else if (kind === 'odReady') { odReady.current = !odReady.current; s?.setOverdriveReady(odReady.current); setHud((h) => ({ ...h, charge: odReady.current ? 1 : 0 })); }
      else if (kind === 'odLow') { if (!devOd.current) { devOd.current = 1; s?.setOverdrive(1); bus.emit('hues', overdriveHues(1)); } s?.setOverdriveLow(true); }
      else if (kind === 'section') { s?.section(true); setBanner({ id: Date.now(), kind: 'section', big: 'Section' }); }
      else if (kind === 'miss') { for (let l = 0; l < 4; l++) s?.miss(l); bus.emit('miss', { x: 0.5 }); }
      else if (kind === 'climb') { for (let k = 0; k < 4; k++) s?.climb(0, 1.2, { delay: k * 3 }); }
      // Drop mode on and off, as a real drop plays it (until the song's own next drop or its end takes over).
      else if (kind === 'dropMode') {
        const d = dropNow.current;
        const on = d.index !== -2;
        d.index = on ? -2 : -1;
        const strength = on ? 1 : 0;
        s?.setDrop(strength);
        bus.emit('drop', { strength });
        if (on) { bus.emit('cue', { kind: 'drop', strength: 1 }); dropFx.current?.enter(1); } else dropFx.current?.exit();
      }
      else bus.emit('cue', { kind, strength: 1 });
      // While nothing is playing, show the effect anyway.
      if (s && phaseRef.current !== 'playing') {
        const t0 = performance.now();
        const spin = () => { s.frame(game.current ? songTime(beat0.current) : -4, game.current?.notes ?? []); if (performance.now() - t0 < 1800 && phaseRef.current !== 'playing') requestAnimationFrame(spin); };
        requestAnimationFrame(spin);
      }
    },
    retime: () => { if (song) stage.current?.setTiming(60 / song.bpm, fallTime(difficulty, song.bpm)); },
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
    <div className={`play ${devTools ? 'has-dev' : ''} ${look.fever && phase === 'playing' ? 'is-fever' : ''} ${look.od && phase === 'playing' ? `is-overdrive od-${look.od}${look.low ? ' od-low' : ''}` : ''} ${phase === 'failing' || (phase === 'results' && result?.failed) ? 'is-failing' : ''}`} style={song ? ({ '--hA': song.hues[0], '--hB': song.hues[1], '--inset': `${inset}px` } as React.CSSProperties) : undefined}>
      <div ref={host} className="play-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        role="application" aria-label={`Playfield, 4 lanes. Keys ${laneKeyList(binds).map((k) => k.label).join(' ')}. Overdrive ${keyLabel(binds.overdrive)}.`}>
        {!use3d && <canvas ref={canvas} className="play-canvas" />}
      </div>

      {song && (
        <>
          <DropFx ref={dropFx} />
          <LiveOverdriveFx odFx={odFx} store={hudStore} playing={phase === 'playing'} keyName={keyLabel(binds.overdrive)} />
          <PlayHud song={song} difficulty={difficulty} section={section} hud={hudStore} clock={clock} bot={bot} devTools={devTools}
            canPause={phase === 'playing'} onDev={toggleDev} onPause={pause} combo={combo} panel={panel}
            overdriveKey={keyLabel(binds.overdrive)} onOverdrive={fireOverdrive}
            practice={practice ? `Practice · ${practice.label} · ${Math.round(practice.speed * 100)}%` : undefined} model={modelStore} />
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
            {count !== null && (phase === 'playing' || phase === 'resuming') && (
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
          <StartCard key="start" song={song} difficulty={difficulty} starting={phase === 'starting'} onStart={(p) => start(p ?? null)} onChoose={onChoose} onHelp={openHowToPlay} />
        )}
        {phase === 'paused' && (
          <PauseCard key="paused" practice={practice} onStopPractice={() => { practiceRef.current = null; setPractice(null); stopSong(); resumeAudio().then(() => setPhase('ready')); }} at={clock} of={song ? (song.lengthBeats * 60) / song.bpm : 0} onResume={resume} onRestart={restart} onQuit={() => navigate(href.song(songId, difficulty))} />
        )}
        {phase === 'lagging' && lagView && (
          <LagCard key="lagging" view={lagView} onContinue={lagContinue} onMenu={() => navigate(href.song(songId, difficulty))} />
        )}
        {phase === 'buffering' && (
          <motion.div key="buffering" className="lag-loading" role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <span className="lag-loading-dot" aria-hidden />
            Loading the song… {lagView && !lagView.complete ? `${Math.floor(lagView.ahead)} s loaded ahead` : ''}
          </motion.div>
        )}
        {phase === 'loading' && (
          <Loader key="loading" title={song?.title} artist={song?.artist} hues={song?.hues}
            status={!song ? (waking ? 'Waking the song server' : 'Loading the map') : song.source.kind === 'youtube' ? 'Getting the video ready' : 'Loading the track'} />
        )}
      </AnimatePresence>

      {phase === 'results' && result && song && (
        <Results song={song} difficulty={difficulty} result={result} previousBest={prevBest} saving={saving} saveError={saveError} model={modelStore} feelRun={kept} onRetry={() => { if (!result.assisted) setPrevBest(Math.max(prevBest ?? 0, result.failed ? 0 : result.score) || undefined); restart(); }} />
      )}
    </div>
  );
}

/** What the controller (main.Main on the server) last said, and whether it's reviewing. */
export type ModelView = { state: PlayState | null; status: LinkStatus } | null;

/** The Overdrive layer, fed by the run panel's store (so only it re-renders with the numbers). */
function LiveOverdriveFx({ odFx, store, playing, keyName }: { odFx: React.Ref<OverdriveFxHandle>; store: Store<HudState>; playing: boolean; keyName: string }) {
  const hud = useStore(store);
  return (
    <OverdriveFx ref={odFx} ready={hud.charge >= 1 && hud.overdrive < MAX_OVERDRIVE && playing} level={hud.overdrive} keyName={keyName}
      safe={playing && hud.overdrive ? hud.odSafe : 0} />
  );
}
