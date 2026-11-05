// The living backdrop: deep space where motes of light settle into cymatic figures.
//
// Layers:
//   1. base   — deep space: a dark gradient, soft clouds of the song's colours and faint stars.
//               Painted once per resize or song.
//   2. grains — motes of light on an invisible vibrating plate. They get shaken off the moving
//               parts of the plate and settle on its still "nodal" lines, so they draw Chladni
//               figures, and flow into a new figure when the plate's mode changes. Built to be
//               cheap: drawn at half resolution (the upscale doubles as a glow), trig from a
//               lookup table, analytic gradients, and short light trails instead of a glow pass.
//   3. ink    — the reactive sky, in the spirit of Tetris Effect's living stages:
//               · a field of stars streaming toward you, faster with the music, leaping into
//                 hyperspace on drops and combo milestones;
//               · rings of light rolling out from the middle on every beat;
//               · crystals that pop into the sky on every hit (and on typing in the search),
//                 turn, and fade;
//               · ripples from hits, and washes of colour for misses, drops and fever.
//   4. pulse  — a wash of the song's colours over everything that blooms with the music's
//               loudness (a DOM layer: only its opacity and scale change, so it costs nothing).
// The whole sky also breathes: it zooms a touch on every beat and its vignette opens up when
// the music gets loud; each new section of the song shifts the clouds to a new palette; fever
// turns everything gold. This all runs on the main menu (with the preview) and while playing.
//
// Reacts to the music itself, for every song: live audio levels (bass shakes the plate, highs
// brighten the grains), the map's sections (each one settles the sand into a new figure) and cues
// (builds shake harder, drops blast shockwaves and a flash of colour, breaks calm everything).
// Also: beats, hits (shockwaves from where the tile was hit), misses (a red flicker), song hues.
// While a song is played (body[data-scene=play]) half the sand rests so the game keeps its frame rate.
// Seeded randomness and "paint the still parts once" come from TerraSim's starfield.

import type { Levels } from '../audio/playback';
import { frameGate } from '../lib/perf';

/** A 2D context on the page or on a worker's OffscreenCanvas (the drawing is the same). */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * What the scene needs from wherever it runs: the page (host.ts, attachMain) or the sky worker
 * (simOnly). Everything else (the event bus, window events) is wired by the host,
 * which calls the scene's public on… methods.
 */
export interface SceneEnv {
  /** The viewport in CSS pixels and the device pixel ratio. */
  size(): { w: number; h: number; dpr: number };
  /** A song is being played (body[data-scene=play]). */
  playing(): boolean;
  levels(): Levels;
  calm(): boolean;
  raf(cb: FrameRequestCallback): number;
  cancelRaf(id: number): void;
  /** The DOM layers that follow the music: the bloom, the base layer's zoom, the vignette. */
  layers(l: { pulseOpacity: string; pulseScale: string; baseScale: string; vignette: string }): void;
  /** Only the base layer is a real canvas: the 3D stage draws the rest from shapes(). */
  simOnly?: boolean;
}

/**
 * The backdrop as shapes (SynthScene.shapes). Segments and circles are flat arrays:
 *   sand, ink: x0, y0, x1, y1, width, hue, sat, light, alpha   (9 numbers each; CSS px)
 *   circles:   x, y, radius, width, hue, sat, light, alpha       (8 numbers each)
 */
export interface SkyShapes {
  sand: number[]; ink: number[]; circles: number[];
  missFlash: number; dropFlash: number;
  hues: [number, number]; songHues: [number, number];
  pulse: number; pulseScale: number; baseScale: number; vignette: number;
  w: number; h: number;
}
export const emptyShapes = (): SkyShapes => ({
  sand: [], ink: [], circles: [], missFlash: 0, dropFlash: 0, hues: [0, 0], songHues: [0, 0],
  pulse: 0, pulseScale: 1, baseScale: 1, vignette: 1, w: 1, h: 1,
});

/** Scene events a host forwards (the same names the worker's messages use). */
export type SceneEvent =
  | { type: 'beat'; downbeat: boolean }
  | { type: 'hit'; judgement: 'perfect' | 'great' | 'good'; x: number }
  | { type: 'typing' }
  | { type: 'fever'; on: boolean }
  | { type: 'milestone' }
  | { type: 'miss'; x: number }
  | { type: 'hues'; hues: [number, number] | null }
  | { type: 'section'; index: number }
  | { type: 'cue'; kind: 'build' | 'drop' | 'break' | 'flash'; strength: number }
  | { type: 'sky'; x: number; y: number; strength: number }
  | { type: 'pointermove'; x: number; y: number }
  | { type: 'pointerdown'; x: number; y: number }
  | { type: 'pointerleave' }
  | { type: 'resize' };

const HOUSE: [number, number] = [196, 272];
const PI = Math.PI;

// Plate modes [n, m, sign]: f = cos(nπx)cos(mπy) + sign·cos(mπx)cos(nπy).
const MODES: [number, number, number][] = [
  [1, 2, 1], [2, 3, -1], [1, 4, 1], [3, 4, -1], [2, 5, 1], [3, 5, 1], [1, 6, -1],
  [4, 5, 1], [2, 7, -1], [3, 7, 1], [5, 6, -1], [4, 7, 1], [1, 5, -1], [2, 4, 1],
];

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsl(${h.toFixed(1)} ${s}% ${l}% / ${a})`;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpHue = (a: number, b: number, t: number) => {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
};
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Cosine lookup table: the sand needs ~8 trig calls per grain per frame.
const LUT_BITS = 12;
const LUT_SIZE = 1 << LUT_BITS;
const LUT_MASK = LUT_SIZE - 1;
const LUT_SCALE = LUT_SIZE / (2 * PI);
const COS = new Float32Array(LUT_SIZE).map((_, i) => Math.cos((i / LUT_SIZE) * 2 * PI));
const cosL = (x: number) => COS[(x * LUT_SCALE) & LUT_MASK];
const sinL = (x: number) => COS[((x - PI / 2) * LUT_SCALE) & LUT_MASK];

// Ripples: a wide soft band and a thin bright edge ('lite': a narrower band, a little brighter).
const WAVE_FULL = [[14, 0.07], [1, 0.55]] as const;

export class SynthScene {
  private base: Ctx2D;
  private sand: Ctx2D;
  private ink: Ctx2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private S = 1;
  private raf = 0;
  private last = 0;
  private t = 0;
  private running = false;
  private rand = seeded(20261030);

  // Sand grains, struct-of-arrays, positions in CSS pixels.
  private n = 0;
  private gx = new Float32Array(0);
  private gy = new Float32Array(0);
  private ox = new Float32Array(0);
  private oy = new Float32Array(0);
  private vx = new Float32Array(0);
  private vy = new Float32Array(0);

  private mode = 3;
  private nextMode = 3;
  private morph = 1;
  private modeClock = 0;
  private downbeats = 0;

  private hues: [number, number] = [...HOUSE];
  private targetHues: [number, number] = [...HOUSE];
  private kick = 0;
  // After a click, a hit or a drop scatters the sand, it is pulled back hard for a moment, so the
  // figure re-forms in about a second instead of drifting back over many.
  private recover = 0;
  private beatFlash = 0;
  private missFlash = 0;
  private lastBeatAt = -10;
  private ambient = 0;
  private beatsSeen = 0;
  private dropFlash = 0;
  private buildUntil = -1;
  private calmUntil = -1;
  private music = 0; // smoothed audio level
  private bass = 0;
  private high = 0;
  private lastPulse = '';
  // Stars streaming toward the viewer (x, y across, z depth 0..1).
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private sz = new Float32Array(0);
  private warp = 0; // extra speed: drops, milestones, hits
  private rings: { age: number; strength: number }[] = [];
  private crystals: { x: number; y: number; size: number; rot: number; spin: number; age: number; life: number; hue: number; sides: number; active: boolean }[] =
    Array.from({ length: 28 }, () => ({ x: 0, y: 0, size: 0, rot: 0, spin: 0, age: 0, life: 1, hue: 0, sides: 4, active: false }));
  private crystalNext = 0;
  private fever = 0;
  private feverTarget = 0;
  private shift = 0; // palette drift, one step per section

  private waves: { x: number; y: number; age: number; hue: number; strength: number }[] = [];
  private pointer = { x: -9999, y: -9999, px: 0, py: 0, tpx: 0, tpy: 0, active: false, movedAt: -9 };

  constructor(ctx: { base: Ctx2D; sand: Ctx2D; ink: Ctx2D }, private env: SceneEnv) {
    // Dev only: lets tools measure the sand (how far grains sit from the figure's lines).
    if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __synth?: unknown }).__synth = this;
    this.base = ctx.base;
    this.sand = ctx.sand;
    this.ink = ctx.ink;
    this.resize();
  }

  /** One event from the page (the host forwards the bus, the pointer and resizes). */
  handle(e: SceneEvent) {
    switch (e.type) {
      case 'beat': this.beat(e.downbeat); break;
      case 'hit': {
        const hue = e.judgement === 'perfect' ? this.hues[1] : e.judgement === 'great' ? this.hues[0] : 268;
        const k = e.judgement === 'perfect' ? 1 : e.judgement === 'great' ? 0.75 : 0.5;
        this.shock(e.x * this.w, this.h * 0.86, hue, k * 0.45);
        if (this.rand() < 0.25) this.crystal(e.x * this.w + (this.rand() - 0.5) * this.w * 0.5, this.h * (0.12 + this.rand() * 0.6), lerpHue(this.hues[0], this.hues[1], this.rand()), 0.5 + k * 0.4);
        break;
      }
      case 'typing': this.crystal(this.w * (0.04 + this.rand() * 0.42), this.h * (0.1 + this.rand() * 0.8), lerpHue(this.hues[0], this.hues[1], this.rand()), 0.5); break;
      case 'fever': this.feverTarget = e.on ? 1 : 0; break;
      case 'milestone':
        for (let k = 0; k < 3; k++) this.crystal(this.w * (0.75 + this.rand() * 0.2), this.h * (0.15 + this.rand() * 0.3), lerpHue(this.hues[0], this.hues[1], this.rand()), 0.9);
        break;
      case 'miss': this.missFlash = 1; this.kick = Math.max(this.kick, 1.2); this.shock(e.x * this.w, this.h * 0.86, 350, 0.5); break;
      case 'hues': this.targetHues = e.hues ? [...e.hues] : [...HOUSE]; this.shift = 0; this.drawBase(); break;
      case 'section': this.changeMode(); this.beatFlash = 1; if (e.index > 0) { this.shift = (this.shift + 34) % 360; this.drawBase(); } break;
      case 'cue': this.cue(e.kind, e.strength); break;
      case 'sky':
        // The sky behind the track: grains scatter from each burst; a storm shakes the whole plate.
        this.shock(e.x * this.w, e.y * this.h, lerpHue(this.hues[0], this.hues[1], this.rand()), Math.min(1.4, 0.35 + e.strength * 0.55));
        if (e.strength > 1.2) {
          this.warp = Math.max(this.warp, 1.6);
          this.beatFlash = 1;
          this.kick = Math.max(this.kick, 1.4);
          for (let k = 0; k < 6; k++) this.crystal(this.w * this.rand(), this.h * (0.1 + this.rand() * 0.7), lerpHue(this.hues[0], this.hues[1], this.rand()), 1.2);
        } else if (this.rand() < 0.5) {
          this.crystal(e.x * this.w, e.y * this.h, lerpHue(this.hues[0], this.hues[1], this.rand()), 0.6 + e.strength * 0.5);
        }
        break;
      case 'pointermove': {
        const P = this.pointer;
        P.x = e.x; P.y = e.y; P.active = true; P.movedAt = this.t;
        P.tpx = (e.x / Math.max(1, this.w)) * 2 - 1; P.tpy = (e.y / Math.max(1, this.h)) * 2 - 1;
        break;
      }
      case 'pointerdown': this.shock(e.x, e.y, this.hues[1], 0.55); break;
      case 'pointerleave': this.pointer.active = false; break;
      case 'resize': this.resize(); break;
    }
  }

  destroy() {
    this.stop();
  }

  start() {
    if (this.running) return;
    if (this.env.calm()) { this.still(); return; }
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      if (!frameGate(now)) { this.raf = this.env.raf(loop); return; }
      const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
      this.last = now;
      // During play the 3D stage draws the sky: the backdrop is hidden and does no work.
      if (!this.held) {
        this.update(dt);
        this.draw();
      }
      this.raf = this.env.raf(loop);
    };
    this.raf = this.env.raf(loop);
  }

  stop() {
    this.running = false;
    this.env.cancelRaf(this.raf);
  }

  /** Settles the sand into a figure and draws one still frame (motion turned off). */
  still() {
    this.stop();
    this.morph = 1;
    this.mode = this.nextMode;
    for (let i = 0; i < 220; i++) this.step(1 / 60, 0.3, false);
    const g = this.sand;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    this.drawSand(true);
    this.ink.setTransform(1, 0, 0, 1, 0, 0);
    this.ink.clearRect(0, 0, this.ink.canvas.width, this.ink.canvas.height);
  }

  // ---------- reactions ----------
  private beat(downbeat: boolean) {
    this.kick = Math.max(this.kick, downbeat ? 1 : 0.6);
    this.rings.push({ age: 0, strength: downbeat ? 1 : 0.55 });
    if (this.rings.length > 8) this.rings.shift();
    this.beatFlash = 1;
    this.lastBeatAt = this.t;
    this.beatsSeen++;
    if (downbeat) {
      if (++this.downbeats % 4 === 0) this.changeMode();
    }
  }

  private shock(x: number, y: number, hue: number, strength: number) {
    if (this.held) return;
    this.waves.push({ x, y, age: 0, hue, strength });
    this.recover = Math.min(1, this.recover + 0.6 + strength * 0.4);
    if (this.waves.length > 14) this.waves.shift();
    const R = 240 * (0.6 + strength);
    const R2 = R * R;
    for (let i = 0; i < this.n; i++) {
      const dx = this.gx[i] - x, dy = this.gy[i] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > R2 || d2 < 1) continue;
      const d = Math.sqrt(d2);
      const k = (1 - d / R) * strength * 850;
      this.vx[i] += (dx / d) * k;
      this.vy[i] += (dy / d) * k;
    }
  }

  private cue(kind: 'build' | 'drop' | 'break' | 'flash', strength: number) {
    if (kind === 'drop') {
      this.dropFlash = strength;
      this.warp = Math.max(this.warp, 1.5 * strength);
      this.kick = Math.max(this.kick, 1.6 * strength);
      this.calmUntil = -1;
      this.shock(this.w / 2, this.h / 2, this.hues[0], 1.2 * strength);
      this.shock(this.w * 0.2, this.h * 0.8, this.hues[1], 0.8 * strength);
      this.shock(this.w * 0.8, this.h * 0.8, this.hues[1], 0.8 * strength);
      if (this.morph >= 1) this.changeMode();
    } else if (kind === 'build') {
      this.buildUntil = this.t + 3;
    } else if (kind === 'break') {
      this.calmUntil = this.t + 5;
    } else {
      // An impact in the song.
      this.beatFlash = 1;
      this.kick = Math.max(this.kick, 1.1 * strength);
      this.warp = Math.max(this.warp, 0.9 * strength);
      this.shock(this.w * (0.25 + this.rand() * 0.5), this.h * (0.3 + this.rand() * 0.4), this.hues[1], 0.9 * strength);
    }
  }

  /** Dev/tools: mean |field| of the grains within r px of (x, y): 0 means sitting on the lines. */
  sandError(x: number, y: number, r: number) {
    const A = MODES[this.mode], S = this.S, cx = this.w / 2, cy = this.h / 2;
    let sum = 0, n = 0;
    for (let i = 0; i < this.active; i++) {
      const dx = this.gx[i] - x, dy = this.gy[i] - y;
      if (dx * dx + dy * dy > r * r) continue;
      const u = (this.gx[i] - cx) / S, v = (this.gy[i] - cy) / S;
      const f = Math.cos(A[0] * PI * u) * Math.cos(A[1] * PI * v) + A[2] * Math.cos(A[1] * PI * u) * Math.cos(A[0] * PI * v);
      sum += Math.abs(f); n++;
    }
    return { err: n ? sum / n : 0, n, morphing: this.morph < 1 };
  }

  private changeMode() {
    if (this.morph < 1) this.mode = this.nextMode;
    let next = this.mode;
    while (next === this.mode) next = Math.floor(this.rand() * MODES.length);
    this.nextMode = next;
    this.morph = 0;
    this.modeClock = 0;
  }

  // ---------- setup ----------
  resize() {
    // The light layer at up to 1.5×.
    const size = this.env.size();
    this.dpr = Math.min(1.5, size.dpr || 1);
    this.w = size.w;
    this.h = size.h;
    for (const c of this.env.simOnly ? [this.base.canvas] : [this.base.canvas, this.ink.canvas]) {
      c.width = Math.round(this.w * this.dpr);
      c.height = Math.round(this.h * this.dpr);
    }
    // Sand at half size: a quarter of the pixels to fill, and the upscale softens it into a glow.
    if (!this.env.simOnly) {
      this.sand.canvas.width = Math.ceil(this.w / 2);
      this.sand.canvas.height = Math.ceil(this.h / 2);
    }
    this.S = Math.min(this.w, this.h) * 0.52;
    const count = Math.round(Math.min(3800, Math.max(1600, (this.w * this.h) / 360)));
    const keep = this.n;
    const grow = (a: Float32Array) => { const b = new Float32Array(count); b.set(a.subarray(0, Math.min(keep, count))); return b; };
    this.gx = grow(this.gx); this.gy = grow(this.gy); this.ox = grow(this.ox); this.oy = grow(this.oy); this.vx = grow(this.vx); this.vy = grow(this.vy);
    for (let i = keep; i < count; i++) this.respawn(i);
    this.n = count;
    const stars = Math.round(Math.min(420, Math.max(220, (this.w * this.h) / 3600)));
    if (this.sx.length !== stars) {
      this.sx = new Float32Array(stars); this.sy = new Float32Array(stars); this.sz = new Float32Array(stars);
      for (let i = 0; i < stars; i++) this.respawnStar(i, this.rand());
    }
    this.drawBase();
    if (!this.running && !this.env.simOnly) this.still();
  }

  private respawn(i: number) {
    this.gx[i] = this.ox[i] = this.rand() * this.w;
    this.gy[i] = this.oy[i] = this.rand() * this.h;
    this.vx[i] = this.vy[i] = 0;
  }

  /** Deep space. Painted once per resize or song tint. */
  private drawBase() {
    this.baseVersion++;
    const { base: g, w, h, dpr } = this;
    // Each section of the song moves the clouds on to a new palette.
    const hA = (this.targetHues[0] + this.shift) % 360, hB = (this.targetHues[1] + this.shift * 0.6) % 360;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = g.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.7);
    bg.addColorStop(0, hsl(lerpHue(hA, 230, 0.6), 45, 7));
    bg.addColorStop(0.5, hsl(232, 50, 3.5));
    bg.addColorStop(1, '#010207');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // Soft clouds of the song's colours.
    for (const [x, y, hue, a, r] of [[0.18, 0.78, hA, 0.13, 0.6], [0.86, 0.16, hB, 0.11, 0.55], [0.6, 0.55, lerpHue(hA, hB, 0.5), 0.05, 0.4]] as const) {
      const R = Math.max(w, h) * r;
      const p = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, R);
      p.addColorStop(0, hsl(hue, 90, 55, a));
      p.addColorStop(0.5, hsl(hue, 90, 45, a * 0.35));
      p.addColorStop(1, hsl(hue, 90, 40, 0));
      g.fillStyle = p;
      g.fillRect(0, 0, w, h);
    }
    // Faint stars, the same every time.
    const rand = seeded(7);
    const stars = Math.round((w * h) / 2600);
    for (let i = 0; i < stars; i++) {
      const x = rand() * w, y = rand() * h, r = rand();
      g.fillStyle = hsl(r < 0.5 ? hB : hA, 60, 88, 0.12 + r * r * 0.5);
      g.fillRect(x, y, r > 0.93 ? 1.6 : 1, r > 0.93 ? 1.6 : 1);
    }
  }

  // ---------- sand ----------
  /** During play the stage draws the sky, so the backdrop skips all its work. */
  private get held() { return this.env.playing(); }
  private get lite() { return this.env.playing(); }
  private get active() { return this.lite ? Math.floor(this.n * 0.5) : this.n; }

  /** One physics step. `shake` is how hard the plate rings. */
  private step(dt: number, shake: number, interactive: boolean) {
    const { w, h, S } = this;
    const cx = w / 2, cy = h / 2;
    const A = MODES[this.mode], B = MODES[this.nextMode];
    const k = this.morph >= 1 ? 0 : ease(this.morph);
    const aA = A[0] * PI, bA = A[1] * PI, aB = B[0] * PI, bB = B[1] * PI;
    const amp = shake * S * 0.05 * Math.sqrt(dt * 60);
    const pull = (0.9 + this.recover * 22) * dt * S; // field gradients below are per plate unit
    const damp = Math.exp(-dt * (4.5 + this.recover * 3));
    const P = this.pointer;
    const pr = 150, pr2 = pr * pr;
    // The pointer stirs the sand while it moves; resting, it lets the figure close up again.
    const stirK = Math.exp(-(this.t - P.movedAt) * 2.5);
    const stir = interactive && P.active && !this.lite && stirK > 0.02;
    const rand = this.rand;
    const count = this.active;
    for (let i = 0; i < count; i++) {
      let x = this.gx[i], y = this.gy[i];
      this.ox[i] = x; this.oy[i] = y;
      const u = (x - cx) / S, v = (y - cy) / S;
      // Field and its gradient, analytically, for the current mode (and the next while morphing).
      let cau = cosL(aA * u), cbv = cosL(bA * v), cbu = cosL(bA * u), cav = cosL(aA * v);
      let f = cau * cbv + A[2] * cbu * cav;
      let fu = -aA * sinL(aA * u) * cbv - A[2] * bA * sinL(bA * u) * cav;
      let fv = -bA * cau * sinL(bA * v) - A[2] * aA * cbu * sinL(aA * v);
      if (k > 0) {
        cau = cosL(aB * u); cbv = cosL(bB * v); cbu = cosL(bB * u); cav = cosL(aB * v);
        const f2 = cau * cbv + B[2] * cbu * cav;
        const fu2 = -aB * sinL(aB * u) * cbv - B[2] * bB * sinL(bB * u) * cav;
        const fv2 = -bB * cau * sinL(bB * v) - B[2] * aB * cbu * sinL(aB * v);
        f += (f2 - f) * k; fu += (fu2 - fu) * k; fv += (fv2 - fv) * k;
      }
      // Shaken off the moving parts of the plate, in proportion to how much they move…
      const j = amp * Math.min(1.6, f < 0 ? -f : f);
      x += (rand() - 0.5) * 2 * j;
      y += (rand() - 0.5) * 2 * j;
      // …and drawn toward the still lines (gradient descent on f², gradient per pixel = fu / S).
      const g = f * pull / (S * S);
      x -= g * fu * S;
      y -= g * fv * S;
      this.vx[i] *= damp; this.vy[i] *= damp;
      x += this.vx[i] * dt; y += this.vy[i] * dt;
      if (stir) {
        const dx = x - P.x, dy = y - P.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < pr2 && d2 > 1) {
          const d = Math.sqrt(d2);
          const s = (1 - d / pr) * 260 * dt * stirK;
          x += (dx / d) * s - (dy / d) * s * 0.6;
          y += (dy / d) * s + (dx / d) * s * 0.6;
        }
      }
      if (x < -20 || x > w + 20 || y < -20 || y > h + 20) { this.respawn(i); continue; }
      this.gx[i] = x; this.gy[i] = y;
    }
  }

  private drawSand(still: boolean) {
    const g = this.sand;
    g.setTransform(0.5, 0, 0, 0.5, 0, 0);
    if (!still) {
      // Fade earlier frames instead of clearing, so moving grains leave short light trails.
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgb(0 0 0 / 0.3)';
      g.fillRect(0, 0, this.w, this.h);
    }
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    g.lineWidth = 2.4; // 1.2 px on the half-size canvas
    const [hA, hB] = this.hues;
    const B = 5;
    const paths = Array.from({ length: B }, () => new Path2D());
    const drift = this.t * 0.04;
    const iw = 1 / this.w, ih = 1 / this.h;
    const count = this.active;
    for (let i = 0; i < count; i++) {
      const x = this.gx[i], y = this.gy[i];
      // Colour bands sweep slowly across the sheet.
      const u = (x * iw * 0.7 + y * ih * 0.5 + drift) % 1;
      const b = Math.min(B - 1, ((sinL(u * PI) < 0 ? -sinL(u * PI) : sinL(u * PI)) * B) | 0);
      const p = paths[b];
      p.moveTo(this.ox[i], this.oy[i]);
      p.lineTo(x + 0.01, y + 0.01);
    }
    const red = this.missFlash;
    for (let b = 0; b < B; b++) {
      const hue = lerpHue(lerpHue(hA, hB, b / (B - 1)), 352, red * 0.85);
      g.strokeStyle = hsl(hue, 90, 70 + this.beatFlash * 10, 0.5);
      g.stroke(paths[b]);
    }
    g.globalCompositeOperation = 'source-over';
  }

  // ---------- per frame ----------
  private update(dt: number) {
    this.t += dt;
    const k = 1 - Math.exp(-dt * 1.5);
    this.hues = [lerpHue(this.hues[0], this.targetHues[0], k), lerpHue(this.hues[1], this.targetHues[1], k)];
    const P = this.pointer;
    P.px = lerp(P.px, P.tpx, 1 - Math.exp(-dt * 3));
    P.py = lerp(P.py, P.tpy, 1 - Math.exp(-dt * 3));
    this.kick *= Math.exp(-dt * 5);
    this.recover = Math.max(0, this.recover - dt / 2.2);
    this.beatFlash *= Math.exp(-dt * 6);
    this.missFlash *= Math.exp(-dt * 4);
    this.dropFlash *= Math.exp(-dt * 2.2);
    this.warp *= Math.exp(-dt * 1.4);
    this.fever += (this.feverTarget - this.fever) * Math.min(1, dt * 1.5);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < 1.6);
    this.stepStars(dt);
    for (const c of this.crystals) {
      if (!c.active) continue;
      c.age += dt;
      c.rot += c.spin * dt;
      c.y -= dt * 14;
      if (c.age >= c.life) c.active = false;
    }

    // Live audio: the music itself shakes the plate.
    const lv = this.env.levels();
    this.music += (lv.level - this.music) * Math.min(1, dt * 8);
    this.bass += (lv.bass - this.bass) * Math.min(1, dt * 14);
    this.high += (lv.high - this.high) * Math.min(1, dt * 10);
    const calm = this.t < this.calmUntil ? 0.35 : 1;
    if (lv.level > 0.02) {
      this.kick = Math.max(this.kick, lv.bass * 1.15 * calm);
      this.beatFlash = Math.max(this.beatFlash, lv.high * 0.7 * calm);
    }
    const build = this.t < this.buildUntil ? 1 - (this.buildUntil - this.t) / 3 : 0;

    if (this.t - this.lastBeatAt > 1.5) {
      // No song playing: a slow heartbeat, and a new figure every few seconds.
      this.ambient += dt;
      if (this.ambient > 60 / 76) { this.ambient = 0; this.kick = Math.max(this.kick, 0.3); this.beatFlash = Math.max(this.beatFlash, 0.4); }
      this.modeClock += dt;
      if (this.modeClock > 7 && this.morph >= 1) this.changeMode();
    }
    if (this.morph < 1) {
      this.morph = Math.min(1, this.morph + dt / 1.8);
      if (this.morph >= 1) this.mode = this.nextMode;
    }
    // Morphing rings the plate harder so grains travel to the new lines.
    const shake = (0.14 + this.kick * 0.5 + this.music * 0.35 + build * 0.6) * calm + (this.morph < 1 ? 0.35 * Math.sin(this.morph * PI) : 0);
    this.step(dt, shake, true);

    for (const wv of this.waves) wv.age += dt;
    this.waves = this.waves.filter((wv) => wv.age < 1.2);

  }

  private draw() {
    this.drawSand(false);
    const { ink: g, dpr, w, h } = this;
    const [hA, hB] = this.hues;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    this.drawStars(g, w, h, hA, hB);
    this.drawRings(g, w, h, hA, hB);
    this.drawCrystals(g);
    this.react();
    // Ripples of light from hits: a wide soft band and a thin bright edge.
    for (const wv of this.waves) {
      const k = wv.age / 1.2;
      const r = 20 + ease(Math.min(1, k * 1.2)) * 300 * (0.6 + wv.strength);
      for (const [lw, a] of WAVE_FULL) {
        g.strokeStyle = hsl(wv.hue, 90, 74, (1 - k) * a * wv.strength);
        g.lineWidth = lw;
        g.beginPath();
        g.arc(wv.x, wv.y, r, 0, PI * 2);
        g.stroke();
      }
    }
    if (this.missFlash > 0.02) {
      g.fillStyle = `rgb(255 60 90 / ${this.missFlash * 0.06})`;
      g.fillRect(0, 0, w, h);
    }
    if (this.dropFlash > 0.02) {
      // A drop washes the sky in the song's colour from the centre out.
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      r.addColorStop(0, hsl(hA, 100, 70, 0.2 * this.dropFlash));
      r.addColorStop(1, hsl(hB, 100, 55, 0.03 * this.dropFlash));
      g.fillStyle = r;
      g.fillRect(0, 0, w, h);
    }
    g.globalCompositeOperation = 'source-over';
  }

  private respawnStar(i: number, z = 1) {
    // Kept out of a small hole in the middle so stars don't pop up at the vanishing point.
    let x = 0, y = 0;
    do { x = (this.rand() - 0.5) * 2; y = (this.rand() - 0.5) * 2; } while (x * x + y * y < 0.02);
    this.sx[i] = x; this.sy[i] = y; this.sz[i] = Math.max(0.05, z);
  }

  /** Stars fly toward the viewer: drifting when it's quiet, rushing with the music, warp on drops. */
  private stepStars(dt: number) {
    const loud = Math.min(1, this.music * 1.6);
    const speed = (0.035 + loud * 0.28 + this.kick * 0.18 + this.warp * 0.9 + this.fever * 0.15) * dt;
    for (let i = 0; i < this.sz.length; i++) {
      this.sz[i] -= speed;
      if (this.sz[i] <= 0.04) this.respawnStar(i, 1);
    }
  }

  private drawStars(g: Ctx2D, w: number, h: number, hA: number, hB: number) {
    const cx = w / 2, cy = h * 0.45, f = Math.max(w, h) * 0.32;
    const loud = Math.min(1, this.music * 1.6);
    // Streak length: a dot when calm, long lines in a warp.
    const trail = 0.012 + loud * 0.03 + this.warp * 0.09 + this.kick * 0.015;
    const B = 3;
    const paths = [new Path2D(), new Path2D(), new Path2D()];
    for (let i = 0; i < this.sz.length; i++) {
      const z = this.sz[i], z0 = Math.min(1, z + trail);
      const x1 = cx + (this.sx[i] / z) * f, y1 = cy + (this.sy[i] / z) * f;
      if (x1 < -40 || x1 > w + 40 || y1 < -40 || y1 > h + 40) { this.respawnStar(i, 1); continue; }
      const x0 = cx + (this.sx[i] / z0) * f, y0 = cy + (this.sy[i] / z0) * f;
      const p = paths[i % B];
      p.moveTo(x0, y0);
      p.lineTo(x1 + 0.01, y1 + 0.01);
    }
    g.lineCap = 'round';
    for (let b = 0; b < B; b++) {
      const hue = lerpHue(lerpHue(hA, hB, b / (B - 1)), 42, this.fever * 0.8);
      g.strokeStyle = hsl(hue, 80, 80, 0.32 + loud * 0.4 + this.warp * 0.25);
      g.lineWidth = 1.1 + this.warp * 0.6;
      g.stroke(paths[b]);
    }
  }

  /** A ring of light rolls out from the middle on every beat. */
  private drawRings(g: Ctx2D, w: number, h: number, hA: number, hB: number) {
    const cx = w / 2, cy = h * 0.45, R = Math.hypot(w, h) * 0.55;
    for (const r of this.rings) {
      const k = r.age / 1.6;
      const rad = 30 + ease(Math.min(1, k)) * R;
      const a = (1 - k) * (1 - k) * r.strength * (0.12 + Math.min(1, this.music * 1.6) * 0.3);
      const hue = lerpHue(lerpHue(hA, hB, k), 42, this.fever * 0.8);
      g.strokeStyle = hsl(hue, 90, 72, a * 0.35);
      g.lineWidth = 22;
      g.beginPath(); g.arc(cx, cy, rad, 0, PI * 2); g.stroke();
      g.strokeStyle = hsl(hue, 90, 84, a);
      g.lineWidth = 1.2;
      g.beginPath(); g.arc(cx, cy, rad, 0, PI * 2); g.stroke();
    }
  }

  /** Pops a crystal into the sky: a turning outline of light that swells in and fades. */
  private crystal(x: number, y: number, hue: number, size: number) {
    const c = this.crystals[this.crystalNext];
    this.crystalNext = (this.crystalNext + 1) % this.crystals.length;
    Object.assign(c, { x, y, size: (14 + this.rand() * 26) * size, rot: this.rand() * PI, spin: (this.rand() - 0.5) * 1.6, age: 0, life: 1.4 + this.rand() * 1.2, hue, sides: this.rand() < 0.6 ? 4 : 6, active: true });
  }

  private drawCrystals(g: Ctx2D) {
    g.lineJoin = 'round';
    for (const c of this.crystals) {
      if (!c.active) continue;
      const k = c.age / c.life;
      const pop = k < 0.12 ? 1 - Math.pow(1 - k / 0.12, 3) : 1;
      const r = c.size * (0.4 + 0.6 * pop) * (1 + k * 0.35);
      const a = pop * (1 - k) * (1 - k);
      const hue = lerpHue(c.hue, 42, this.fever * 0.7);
      for (const [scale, lw, alpha] of [[1, 10, 0.12], [1, 1.3, 0.85], [0.55, 1, 0.5]] as const) {
        g.beginPath();
        for (let v = 0; v <= c.sides; v++) {
          const ang = c.rot + (v / c.sides) * PI * 2;
          // Diamonds are tall; hexagons are even.
          const stretch = c.sides === 4 && v % 2 === 0 ? 1.5 : 1;
          const px = c.x + Math.cos(ang) * r * scale * (c.sides === 4 && v % 2 === 1 ? 0.7 : 1);
          const py = c.y + Math.sin(ang) * r * scale * stretch;
          if (v === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.strokeStyle = hsl(hue, 90, 80, a * alpha);
        g.lineWidth = lw;
        g.stroke();
      }
    }
  }

  /** The sky as a whole: a colour bloom with the loudness, a zoom on the beat, an opening vignette. */
  private react() {
    const loud = Math.min(1, this.music * 1.6);
    const key = `${Math.min(1, 0.06 + loud * 0.6 + this.kick * 0.22 + this.dropFlash * 0.4 + this.fever * 0.3).toFixed(2)}|${(1 + this.bass * 0.07 + this.kick * 0.02).toFixed(3)}`;
    if (key === this.lastPulse) return;
    this.lastPulse = key;
    const [op, sc] = key.split('|');
    this.env.layers({ pulseOpacity: op, pulseScale: `scale(${sc})`, baseScale: `scale(${(1 + this.kick * 0.012 + loud * 0.01).toFixed(4)})`, vignette: (1 - loud * 0.45).toFixed(2) });
  }

  // ---------- the backdrop as shapes, for the 3D stage (it draws the backdrop itself) ----------
  /** Bumped whenever the base layer is repainted (the stage re-uploads it). */
  baseVersion = 0;

  /**
   * Everything draw() paints, as shapes: line segments (sand, star streaks, crystal edges) and
   * circles (beat rings, ripples), with the same positions, widths and colours as the canvas
   * drawing (hsl numbers; alpha as drawn), plus the full-screen washes and the DOM layers' values.
   * Like drawStars, it moves stars that have left the screen back in.
   */
  shapes(out: SkyShapes) {
    out.sand.length = 0; out.ink.length = 0; out.circles.length = 0;
    const { w, h } = this;
    const [hA, hB] = this.hues;
    // Sand: one segment per grain, from where it was to where it is, in five colour bands.
    const B = 5;
    const drift = this.t * 0.04;
    const iw = 1 / w, ih = 1 / h;
    const red = this.missFlash;
    const bandHue: number[] = [];
    for (let b = 0; b < B; b++) bandHue.push(lerpHue(lerpHue(hA, hB, b / (B - 1)), 352, red * 0.85));
    const sandL = 70 + this.beatFlash * 10;
    for (let i = 0; i < this.active; i++) {
      const x = this.gx[i], y = this.gy[i];
      const u = (x * iw * 0.7 + y * ih * 0.5 + drift) % 1;
      const b = Math.min(B - 1, ((sinL(u * PI) < 0 ? -sinL(u * PI) : sinL(u * PI)) * B) | 0);
      out.sand.push(this.ox[i], this.oy[i], x + 0.01, y + 0.01, 2.4, bandHue[b], 90, sandL, 0.5);
    }
    // Stars streaming toward the viewer.
    const cx = w / 2, cy = h * 0.45, f = Math.max(w, h) * 0.32;
    const loud = Math.min(1, this.music * 1.6);
    const trail = 0.012 + loud * 0.03 + this.warp * 0.09 + this.kick * 0.015;
    const starHue = [0, 1, 2].map((b) => lerpHue(lerpHue(hA, hB, b / 2), 42, this.fever * 0.8));
    const starA = 0.32 + loud * 0.4 + this.warp * 0.25, starW = 1.1 + this.warp * 0.6;
    for (let i = 0; i < this.sz.length; i++) {
      const z = this.sz[i], z0 = Math.min(1, z + trail);
      const x1 = cx + (this.sx[i] / z) * f, y1 = cy + (this.sy[i] / z) * f;
      if (x1 < -40 || x1 > w + 40 || y1 < -40 || y1 > h + 40) { this.respawnStar(i, 1); continue; }
      const x0 = cx + (this.sx[i] / z0) * f, y0 = cy + (this.sy[i] / z0) * f;
      out.ink.push(x0, y0, x1 + 0.01, y1 + 0.01, starW, starHue[i % 3], 80, 80, starA);
    }
    // Beat rings: a wide soft band and a thin bright line.
    const R = Math.hypot(w, h) * 0.55;
    for (const r of this.rings) {
      const k = r.age / 1.6;
      const rad = 30 + ease(Math.min(1, k)) * R;
      const a = (1 - k) * (1 - k) * r.strength * (0.12 + loud * 0.3);
      const hue = lerpHue(lerpHue(hA, hB, k), 42, this.fever * 0.8);
      out.circles.push(cx, cy, rad, 22, hue, 90, 72, a * 0.35);
      out.circles.push(cx, cy, rad, 1.2, hue, 90, 84, a);
    }
    // Crystals: three outlines each.
    for (const c of this.crystals) {
      if (!c.active) continue;
      const k = c.age / c.life;
      const pop = k < 0.12 ? 1 - Math.pow(1 - k / 0.12, 3) : 1;
      const r = c.size * (0.4 + 0.6 * pop) * (1 + k * 0.35);
      const a = pop * (1 - k) * (1 - k);
      const hue = lerpHue(c.hue, 42, this.fever * 0.7);
      for (const [scale, lw, alpha] of [[1, 10, 0.12], [1, 1.3, 0.85], [0.55, 1, 0.5]] as const) {
        let px0 = 0, py0 = 0;
        for (let v = 0; v <= c.sides; v++) {
          const ang = c.rot + (v / c.sides) * PI * 2;
          const stretch = c.sides === 4 && v % 2 === 0 ? 1.5 : 1;
          const px = c.x + Math.cos(ang) * r * scale * (c.sides === 4 && v % 2 === 1 ? 0.7 : 1);
          const py = c.y + Math.sin(ang) * r * scale * stretch;
          if (v > 0) out.ink.push(px0, py0, px, py, lw, hue, 90, 80, a * alpha);
          px0 = px; py0 = py;
        }
      }
    }
    // Ripples from hits.
    for (const wv of this.waves) {
      const k = wv.age / 1.2;
      const rad = 20 + ease(Math.min(1, k * 1.2)) * 300 * (0.6 + wv.strength);
      for (const [lw, a] of WAVE_FULL) out.circles.push(wv.x, wv.y, rad, lw, wv.hue, 90, 74, (1 - k) * a * wv.strength);
    }
    out.missFlash = this.missFlash > 0.02 ? this.missFlash * 0.06 : 0;
    out.dropFlash = this.dropFlash > 0.02 ? this.dropFlash : 0;
    out.hues[0] = hA; out.hues[1] = hB;
    out.songHues[0] = this.targetHues[0]; out.songHues[1] = this.targetHues[1];
    // The DOM layers' values (react()).
    out.pulse = Math.min(1, 0.06 + loud * 0.6 + this.kick * 0.22 + this.dropFlash * 0.4 + this.fever * 0.3);
    out.pulseScale = 1 + this.bass * 0.07 + this.kick * 0.02;
    out.baseScale = 1 + this.kick * 0.012 + loud * 0.01;
    out.vignette = 1 - loud * 0.45;
    out.w = w; out.h = h;
  }

  /** The base layer's canvas (deep space, painted once per resize or tint). */
  get baseCanvas() { return this.base.canvas; }
  /** Runs the simulation without drawing (the 3D stage draws it from shapes()). */
  simulate(dt: number) { this.update(dt); }
}
