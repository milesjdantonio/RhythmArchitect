// Performance profiles: how the game screen draws. The game picks one at startup (gameProfile):
// B, "one stage" on WebGPU, where the browser has WebGPU, else A, the same on WebGL. `classic` is
// the game before that rework, kept as /demo's reference; /demo switches between all three so they
// can be compared on the same run.

export type ProfileId = 'classic' | 'unified' | 'webgpu';

export interface PerfProfile {
  id: ProfileId;
  name: string;
  blurb: string;
  /**
   * The page's backdrop during play: drawn every frame on the main thread as today ('live'), the
   * same drawing on its own thread ('worker'), drawn inside the 3D stage ('stage'), moving but
   * cheaper ('lite': no full-screen filter or blend, 1× light layer, thinner glows), held on its
   * last frame ('still'), or hidden ('off').
   */
  backdrop: 'live' | 'worker' | 'stage' | 'lite' | 'still' | 'off';
  /** Frames per second at most, for the game, the stage and the backdrop together (0: the display's rate). */
  fpsCap: number;
  /** One shared frame loop for every main-thread animation (`lib/ticker.ts`). */
  ticker: boolean;
  /** The 3D stage's pixel ratio cap, and its floor when adaptive. */
  dpr: number;
  minDpr: number;
  antialias: boolean;
  /** Lower the stage's resolution (and effects) while frames run long, raise it when there's room. */
  adaptive: boolean;
  /** The share of the stage's particle pools in use (sparks, world points, dust). */
  fx: number;
  /** Skip drawing dead sparks and upload only what changed; compile shaders while loading. */
  lean3d: boolean;
  /** Soft effects (glows, sparks, world points, the backdrop's light) drawn at half resolution. */
  halfFx: boolean;
  /** The stage's graphics API: WebGL, or WebGPU (falling back to WebGL where it's missing). */
  renderer: 'webgl' | 'webgpu';
  /** Where the stage draws: on the main thread, or in a worker on an OffscreenCanvas. */
  stageThread: 'main' | 'worker';
  /** An opaque stage canvas (the page doesn't composite a see-through full-screen layer). */
  opaque: boolean;
  /** Judgement words: a React list per hit, or a fixed pool animated with transform and opacity. */
  popups: 'react' | 'pooled';
  /** HUD numbers: on every hit, or at most ten times a second. */
  hudHz: number;
  /**
   * The hit and hold bursts on the pads: Rive always running, Rive asleep when idle, not mounted
   * (the stage's own sparks), or the same Rive art baked to sprite sheets and drawn by the stage.
   */
  rive: 'all' | 'sleep' | 'off' | 'baked';
  /** The whole-screen scale punch on hits. */
  punch: boolean;
  /** The YouTube clock: nudged in steps (the old way) or eased by running slightly fast or slow. */
  clock: 'nudge' | 'slew';
  /** How many frames between measurements of the video's slot (1 = every frame). */
  dockEvery: number;
  /**
   * The page's big moments (combo callout, section banner, countdown): animated with blur and
   * letter-spacing as designed ('full'), or the same look with only transform and opacity moving
   * ('lite'): no blur, spacing tightened with a horizontal scale. Blur and spacing make the browser
   * repaint on the graphics chip the stage is drawing with, and the stage drops frames.
   */
  uiFx: 'full' | 'lite';
}

const CURRENT: PerfProfile = {
  id: 'classic', name: 'Previous build', blurb: 'The game before the one-stage rework, for reference.',
  backdrop: 'live', fpsCap: 0, ticker: false, dpr: 1.75, minDpr: 1.75, antialias: true, adaptive: false, fx: 1, lean3d: false, halfFx: false,
  renderer: 'webgl', stageThread: 'main', opaque: false, popups: 'react', hudHz: 0, rive: 'all', punch: true, clock: 'nudge', dockEvery: 1, uiFx: 'full',
};

/**
 * The fixes both game profiles keep: pooled judgement words, the HUD at ten updates a second,
 * sleeping Rive, dead sparks skipped and shaders compiled while loading, and the eased video clock
 * with the smooth start. (The video's slot is measured every frame: measured less often, the video
 * lagged its spot while a dialog animated, and could drop under YouTube's 200 px.)
 */
const LEAN = { lean3d: true, popups: 'pooled', hudHz: 10, rive: 'sleep', clock: 'slew', dockEvery: 1 } as const;

/** Everything that makes "one stage": see the README's performance lab. */
const ONE_STAGE = {
  ...LEAN, backdrop: 'stage', ticker: true, fpsCap: 0, rive: 'baked', halfFx: true, stageThread: 'worker', opaque: true,
} as const;

export const PROFILES: Record<ProfileId, PerfProfile> = {
  classic: CURRENT,
  unified: {
    ...CURRENT, ...ONE_STAGE, id: 'unified', name: 'A · One stage',
    blurb: 'The backdrop is drawn inside the 3D stage (one canvas), its soft glows and light at half resolution, the Rive bursts baked into sprite sheets the stage draws, and the whole stage on its own thread, at the screen\'s full rate. Every main-thread animation runs on one shared loop. WebGL.',
    renderer: 'webgl',
  },
  webgpu: {
    ...CURRENT, ...ONE_STAGE, id: 'webgpu', name: 'B · One stage, WebGPU',
    blurb: 'A, drawn with WebGPU: every stage shader rewritten in three.js\'s node language (TSL), tone-mapped per material so the light adds up as it does in A. Falls back to WebGL where the browser has no WebGPU.',
    renderer: 'webgpu', uiFx: 'lite',
  },
};

let active: PerfProfile = CURRENT;
let activeOverrides: Partial<PerfProfile> = {};
export const perfOverrides = () => activeOverrides;

/** Parses "ticker:false,fpsCap:0,backdrop:live" (numbers and booleans become numbers and booleans). */
export function parseOverrides(text: string | null): Partial<PerfProfile> {
  const out: Record<string, unknown> = {};
  for (const pair of (text ?? '').split(',')) {
    const [k, v] = pair.split(':');
    if (!k || v === undefined) continue;
    out[k.trim()] = v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : v.trim();
  }
  return out as Partial<PerfProfile>;
}
const listeners = new Set<() => void>();

export const perf = () => active;
/**
 * `overrides`: single settings changed on top of the profile, for experiments
 * (/demo?set=ticker:false,fpsCap:0). The worker gets the same ones.
 */
/**
 * The game's profile on this browser: B (WebGPU) where it has WebGPU, A (WebGL) where it doesn't.
 * (Where a worker can't draw, either still runs its stage on the main thread; see Play.tsx.)
 */
export function gameProfile(): ProfileId {
  return typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'unified';
}

export function setPerf(id: ProfileId, overrides: Partial<PerfProfile> = {}) {
  active = { ...PROFILES[id], ...overrides };
  activeOverrides = overrides;
  if (typeof document !== 'undefined') { document.body.dataset.perf = id; document.body.dataset.backdrop = active.backdrop; }
  listeners.forEach((l) => l());
}
export function onPerf(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

// ---------------------------------------------------------------- the frame cap

/**
 * Frames per second at most for the menus' moving parts (the sky, the stage preview, Rive). They
 * move slowly; drawing them at 120 Hz looks the same and leaves less of the graphics chip for
 * everything else. Gameplay and the intro draw at the screen's full rate.
 */
export const MENU_FPS = 60;

let gateTs = Number.NaN;
let gateOk = true;
let gateNext = Number.NaN;
/**
 * Whether to draw on this display frame (profiles with `fpsCap`). Every loop passes its
 * requestAnimationFrame timestamp; loops in the same frame get the same one, so they all draw on
 * the same frames and skip the same frames (never the game on one and the backdrop on the next).
 * Draw slots are kept every 1/cap seconds and a frame draws when it reaches the next slot, so 120
 * and 240 Hz screens draw every 2nd or 4th frame and 144 or 165 Hz ones average exactly 60.
 */
export function frameGate(ts: number): boolean {
  const cap = active.fpsCap;
  if (!cap) return true;
  if (ts === gateTs) return gateOk;
  gateTs = ts;
  const iv = 1000 / cap;
  // First frame, fell far behind (a stall, a hidden tab), or a new clock: start the slots here.
  if (!(ts - gateNext <= iv && gateNext - ts <= iv * 2)) gateNext = ts;
  // A frame early by up to 1.5 ms still counts (display timestamps jitter).
  if (ts < gateNext - 1.5) return (gateOk = false);
  gateNext += iv;
  return (gateOk = true);
}

// ---------------------------------------------------------------- the recorder

/** Live numbers the stage reports (shown on the meter). */
export const stageInfo = { dpr: 0, fx: 1, backend: '' as string, gpuMs: 0, cpuMs: 0, drawMs: 0, gpuTimer: false };
/** The backdrop's own work per frame (ms, smoothed) and which thread it runs on. */
export const backdropInfo = { ms: 0, thread: 'main' as 'main' | 'worker' };
export function noteBackdropTime(ms: number, thread: 'main' | 'worker') {
  backdropInfo.ms += (ms - backdropInfo.ms) * 0.1;
  backdropInfo.thread = thread;
}

/** The display's frame interval (ms). Measured by `measureRefresh` on a quiet page; 60 Hz until then. */
export let refreshMs = 1000 / 60;
/** The frame interval the game aims for: the display's, or the cap's if that is longer. */
export const targetFrameMs = () => Math.max(refreshMs, active.fpsCap ? 1000 / active.fpsCap : 0);
/**
 * Times 90 frames while nothing heavy runs and takes the median (the shortest frame is no good:
 * frame times jitter, and a 4 ms outlier would make every normal frame look like a hitch).
 */
export function measureRefresh(): Promise<number> {
  return new Promise((done) => {
    const t: number[] = [];
    let last = 0;
    const step = (now: number) => {
      if (last) t.push(now - last);
      last = now;
      if (t.length < 90) { requestAnimationFrame(step); return; }
      t.sort((a, b) => a - b);
      refreshMs = Math.max(4, t[t.length >> 1]);
      done(refreshMs);
    };
    requestAnimationFrame(step);
  });
}

export interface FrameStats {
  frames: number;
  seconds: number;
  fps: number;
  avg: number;
  p95: number;
  p99: number;
  worst: number;
  /** Frames over 1.5× the display's frame time (a visible hitch). */
  drops: number;
  /** Frames over 100 ms (the game freezes). */
  stalls: number;
  /** Frames where the song clock moved unlike the wall clock by more than 8 ms (tiles jump). */
  jumps: number;
  worstJump: number;
}

/**
 * Collects frame times and song-clock steps from the game loop. Only exists while /demo is open,
 * so the real game pays nothing (`recorder?.frame(...)`).
 */
export class Recorder {
  private times: number[] = [];
  private lastAt = 0;
  private lastSong = Number.NaN;
  private jumps = 0;
  private worstJump = 0;
  private started = 0;
  /** Dev: the clock jumps seen (ms into the run, frame ms, song ms). */
  log: number[][] = [];
  /** Dev: the slow frames (ms into the run, frame ms). */
  slow: number[][] = [];
  /** The display's frame interval (`refreshMs`, or a fixed one in tests). */
  constructor(private readonly refresh: () => number = targetFrameMs) {}

  reset() {
    this.log = [];
    this.slow = [];
    this.times = []; this.lastAt = 0; this.lastSong = Number.NaN; this.jumps = 0; this.worstJump = 0; this.started = 0;
  }

  /** One game frame: wall time (ms, performance.now) and the song time (s) it drew. */
  frame(at: number, song: number) {
    if (this.lastAt) {
      const dt = at - this.lastAt;
      this.times.push(dt);
      if (dt > this.refresh() * 1.5 && this.slow.length < 200) this.slow.push([Math.round(at - this.started), Math.round(dt * 10) / 10]);
      if (!Number.isNaN(this.lastSong)) {
        const err = Math.abs((song - this.lastSong) * 1000 - dt);
        // Under 200 ms of frame: a stall is counted as a stall, not also as a jump.
        if (dt < 200 && err > 8) { this.jumps++; this.worstJump = Math.max(this.worstJump, err); if (this.log.length < 400) this.log.push([Math.round(at - this.started), Math.round(dt * 10) / 10, Math.round((song - this.lastSong) * 10000) / 10]); }
      }
    } else this.started = at;
    this.lastAt = at;
    this.lastSong = song;
  }

  /** The stats over the last `window` frames (all of them by default). */
  stats(window = Infinity): FrameStats {
    const all = this.times;
    const t = Number.isFinite(window) ? all.slice(-window) : all;
    const n = t.length;
    if (!n) return { frames: 0, seconds: 0, fps: 0, avg: 0, p95: 0, p99: 0, worst: 0, drops: 0, stalls: 0, jumps: this.jumps, worstJump: this.worstJump };
    const sorted = Float64Array.from(t).sort();
    const sum = t.reduce((a, b) => a + b, 0);
    const pick = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))];
    let drops = 0, stalls = 0;
    for (const d of t) { if (d > this.refresh() * 1.5) drops++; if (d > 100) stalls++; }
    return {
      frames: n, seconds: (this.lastAt - this.started) / 1000, fps: (n * 1000) / sum, avg: sum / n,
      p95: pick(0.95), p99: pick(0.99), worst: sorted[n - 1], drops, stalls, jumps: this.jumps, worstJump: this.worstJump,
    };
  }

  /** Recent frame times, for the graph. */
  recent(n: number) { return this.times.slice(-n); }
  get refreshMs() { return this.refresh(); }
}

export let recorder: Recorder | null = null;
export function attachRecorder(r: Recorder | null) { recorder = r; }
