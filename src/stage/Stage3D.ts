// The 3D stage: a 4-lane playfield of light in three.js, used two ways.
//
//   showcase — the gameplay side of the workspace: a broadcast angle that drifts slowly while a
//              ghost plays the song on stage with every effect on.
//   play     — the real game. The camera sits behind the hit line; tiles come from the live game.
//
// The look follows the feel of synaesthesia games like Tetris Effect: the playfield is a dark
// glass well framed by walls of light; behind it floats a world of particles (a galaxy, a sphere,
// a ring, a wave, a helix, a bloom) that breathes with the bass, pulses on every hit and flows
// into a new form at each section of the song. Every hit bursts into light that swirls and drifts
// upward, with star glints and a flare; holds pour light; fever turns the whole world gold.
//
// Impact without vibration: tiles pop into being at the far end with an overshoot and bounce on
// the beat; a hit bursts the tile into a shell of light that flies apart; the receptors are on
// springs (they squash when pressed and kick when hit); a chord joins its lanes with a bar of
// light; every hit punches the camera a little, harder for better hits.
//
// Everything is pooled (nothing allocates per frame) and the particle world is animated entirely
// on the GPU. The canvas is transparent so the backdrop shows through.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { perf, refreshMs, stageInfo, type PerfProfile } from '../lib/perf';
import { Bursts, type BurstKind } from './bursts';
import { HalfFx } from './halfFx';
import { SkyGL } from './sky';
import type { SceneEvent } from '../background/scene';
import { GpuTimer } from './gpuTimer';
/** The WebGPU materials (gpu.ts), passed in by the stage worker for perf profile B. */
export type GpuKit = typeof import('./gpu');

export type StageMode = 'showcase' | 'play';
export type HitKind = 'perfect' | 'great' | 'good';

/** The shape the stage needs from a tile (LiveNote from the game engine fits). */
export interface StageNote {
  lane: number;
  time: number;
  end: number;
  hold: boolean;
  judged?: 'perfect' | 'great' | 'good' | 'miss';
  holding?: boolean;
  holdResult?: 'done' | 'broken';
}

const LANES = 4;
/** How long the signal takes to drop when a run fails (Play waits this long before the results). */
export const FAIL_SECONDS = 1.8;
const FAIL_ORDER = [0, 3, 1, 2];
const LW = 1.15; // lane width
const W = LANES * LW;
const L = 34; // playfield length (units)
const laneX = (l: number) => (l - (LANES - 1) / 2) * LW;
/** Just outside the lanes, either side: where big moments burst from, so they never cover the tiles. */
const EDGE = W / 2 + 0.4;

const MAX_NOTES = 220;
const MAX_CLIMB = 8; // bands of light climbing each wall
const MAX_SPARKS = 5000;
const MAX_GLINTS = 48;
const MAX_FLARES = 14;
const MAX_RINGS = 20;
const MAX_SHELLS = 16;
const MAX_BARS = 6;
/** Ease out with an overshoot (0..1 → 0..1, peaking a little past 1). */
const backOut = (t: number) => { const c = 1.9; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
const WORLD_POINTS = 4200;
// The sky: everything far behind the track (drawn first, so the glass and the tiles cover it).
const RIBBONS = 7;
const RIB_SEG = 150;
const MAX_SKY_RINGS = 8;
const PILLARS = 24;
const MAX_COMETS = 14;
const SKY = { y: 13, z: -70 }; // the particle world's centre: sky rings pulse from it

// ---------- small textures, drawn once ----------
function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  // In a worker (perf profile C) there is no document: an OffscreenCanvas draws the same.
  const c = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: size, height: size }) : new OffscreenCanvas(size, size);
  draw(c.getContext('2d') as CanvasRenderingContext2D, size);
  const t = new THREE.CanvasTexture(c as HTMLCanvasElement);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const glowTexture = () => canvasTexture(64, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.3, 'rgba(255,255,255,0.4)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, s, s);
});

const beamTexture = () => canvasTexture(64, (g, s) => {
  const v = g.createLinearGradient(0, s, 0, 0);
  v.addColorStop(0, 'rgba(255,255,255,0.95)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v;
  g.fillRect(0, 0, s, s);
  const h = g.createLinearGradient(0, 0, s, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)');
  h.addColorStop(0.5, 'rgba(0,0,0,0)');
  h.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = h;
  g.fillRect(0, 0, s, s);
});

/** A soft column of light: faint at both ends, brightest a quarter of the way up, soft at the sides. */
const columnTexture = () => canvasTexture(64, (g, s) => {
  const v = g.createLinearGradient(0, s, 0, 0);
  v.addColorStop(0, 'rgba(255,255,255,0)');
  v.addColorStop(0.22, 'rgba(255,255,255,0.85)');
  v.addColorStop(0.55, 'rgba(255,255,255,0.3)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v;
  g.fillRect(0, 0, s, s);
  const h = g.createLinearGradient(0, 0, s, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)');
  h.addColorStop(0.5, 'rgba(0,0,0,0)');
  h.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = h;
  g.fillRect(0, 0, s, s);
});

/** A four-point star with a soft core: the glint that twinkles off every hit. */
const starTexture = () => canvasTexture(128, (g, s) => {
  const c = s / 2;
  const core = g.createRadialGradient(c, c, 0, c, c, c * 0.45);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[c * 0.08, c * 0.98], [c * 0.98, c * 0.08]]) {
    const grad = g.createRadialGradient(c, c, 0, c, c, Math.max(w, h));
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(c - w, c); g.lineTo(c, c - h); g.lineTo(c + w, c); g.lineTo(c, c + h);
    g.closePath();
    g.fill();
  }
});

// ---------- the particle world ----------
type Form = 'galaxy' | 'sphere' | 'ring' | 'wave' | 'helix' | 'bloom' | 'crystal' | 'knot' | 'vortex' | 'atom' | 'hypercube';
// The order the world flows through, one form per section: soft forms and hard-edged ones take turns.
const FORMS: Form[] = ['galaxy', 'crystal', 'ring', 'knot', 'sphere', 'vortex', 'bloom', 'atom', 'helix', 'hypercube', 'wave'];

type V3 = [number, number, number];
const rotX = ([x, y, z]: V3, a: number): V3 => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
const rotY = ([x, y, z]: V3, a: number): V3 => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];

/** Edge-drawn forms: their line segments, worked out once. */
const SEGMENTS = (() => {
  // Crystal: an icosahedron (12 corners; an edge joins corners 2 apart before scaling).
  const g = (1 + Math.sqrt(5)) / 2;
  const ico: V3[] = [];
  for (const a of [-1, 1]) for (const b of [-g, g]) ico.push([0, a, b], [a, b, 0], [b, 0, a]);
  const icoEdges: [V3, V3][] = [];
  for (let i = 0; i < ico.length; i++) for (let j = i + 1; j < ico.length; j++) {
    const d = Math.hypot(ico[i][0] - ico[j][0], ico[i][1] - ico[j][1], ico[i][2] - ico[j][2]);
    if (Math.abs(d - 2) < 1e-6) icoEdges.push([ico[i], ico[j]]);
  }
  const s = 0.82 / Math.hypot(1, g);
  const crystal = icoEdges.map(([a, b]) => [a.map((c) => c * s), b.map((c) => c * s)] as [V3, V3]);
  // Hypercube: a cube inside a cube, each corner joined to its twin.
  const cube = (h: number) => {
    const c: V3[] = [];
    for (const x of [-h, h]) for (const y of [-h, h]) for (const z of [-h, h]) c.push([x, y, z]);
    return c;
  };
  const outer = cube(0.6), inner = cube(0.26);
  const edges = (c: V3[]) => {
    const e: [V3, V3][] = [];
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
      const diff = c[i].filter((v, k) => v !== c[j][k]).length;
      if (diff === 1) e.push([c[i], c[j]]);
    }
    return e;
  };
  const hypercube = [...edges(outer), ...edges(inner), ...outer.map((p, i) => [p, inner[i]] as [V3, V3])];
  return { crystal, hypercube };
})();

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

/** Writes a form's points (about unit size) into `out`. */
function formPoints(kind: Form, out: Float32Array, rand: () => number) {
  const n = out.length / 3;
  const tilt = (y: number, z: number, a: number) => [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
  for (let i = 0; i < n; i++) {
    const u = rand(), v = rand(), w = rand();
    let x = 0, y = 0, z = 0;
    if (kind === 'galaxy') {
      const r = Math.pow(u, 0.55);
      const a = (i % 3) * 2.094 + r * 5.6 + (v - 0.5) * 0.7 * (1.1 - r);
      x = Math.cos(a) * r; z = Math.sin(a) * r; y = (w - 0.5) * 0.16 * (1.2 - r);
      [y, z] = tilt(y, z, 0.55);
    } else if (kind === 'sphere') {
      const k = i + 0.5;
      const phi = Math.acos(1 - (2 * k) / n), th = Math.PI * (1 + Math.sqrt(5)) * k;
      const r = u < 0.18 ? 0.25 + u * 3 : 0.9 + (w - 0.5) * 0.05;
      x = Math.cos(th) * Math.sin(phi) * r; y = Math.cos(phi) * r; z = Math.sin(th) * Math.sin(phi) * r;
    } else if (kind === 'ring') {
      const a = u * Math.PI * 2, b = v * Math.PI * 2;
      const R = i % 5 === 0 ? 0.55 : 0.88, rr = 0.05 + w * 0.08;
      x = (R + rr * Math.cos(b)) * Math.cos(a); z = (R + rr * Math.cos(b)) * Math.sin(a); y = rr * Math.sin(b);
      [y, z] = tilt(y, z, 1.15);
    } else if (kind === 'wave') {
      x = (u - 0.5) * 2.6; z = (v - 0.5) * 1.8;
      y = Math.sin(x * 3.6) * 0.16 + Math.cos(z * 4.1 + x) * 0.12 - 0.35 + (w - 0.5) * 0.03;
    } else if (kind === 'helix') {
      const t = u, strand = i % 2;
      const a = t * Math.PI * 7 + strand * Math.PI;
      const rung = i % 9 === 0;
      const r = (rung ? 1 - 2 * v : 1) * (0.42 + (w - 0.5) * 0.05);
      x = Math.cos(a) * r; z = Math.sin(a) * r; y = (t - 0.5) * 2.1;
    } else if (kind === 'crystal' || kind === 'hypercube') {
      // Lines of light along the edges; the crystal has a small glowing core.
      const segs = SEGMENTS[kind];
      let p: V3;
      if (kind === 'crystal' && i % 12 === 0) {
        const r = 0.16 * Math.cbrt(u), th = v * Math.PI * 2, ph = Math.acos(2 * w - 1);
        p = [Math.sin(ph) * Math.cos(th) * r, Math.cos(ph) * r, Math.sin(ph) * Math.sin(th) * r];
      } else {
        const [a, b] = segs[i % segs.length];
        const j = (w - 0.5) * 0.01;
        p = [a[0] + (b[0] - a[0]) * u + j, a[1] + (b[1] - a[1]) * u + (v - 0.5) * 0.01, a[2] + (b[2] - a[2]) * u - j];
      }
      p = kind === 'crystal' ? rotX(rotY(p, 0.3), 0.35) : rotX(rotY(p, 0.62), 0.42);
      [x, y, z] = p;
    } else if (kind === 'knot') {
      // A trefoil knot: a tube of light tied through itself.
      const t = u * Math.PI * 2;
      const r = 0.055 * Math.sqrt(w), th = v * Math.PI * 2, ph = rand() * Math.PI;
      x = (Math.sin(t) + 2 * Math.sin(2 * t)) * 0.3 + Math.cos(th) * Math.sin(ph) * r;
      y = (Math.cos(t) - 2 * Math.cos(2 * t)) * 0.3 + Math.cos(ph) * r;
      z = -Math.sin(3 * t) * 0.3 + Math.sin(th) * Math.sin(ph) * r;
      [x, y, z] = rotX([x, y, z], 0.5);
    } else if (kind === 'vortex') {
      // A funnel of light: four arms spiralling up, narrow at the foot, wide at the top.
      const s = u;
      const r = 0.07 + 0.95 * Math.pow(s, 1.8) + (w - 0.5) * 0.03;
      const a = s * 6 + (i % 4) * (Math.PI / 2) + (v - 0.5) * 0.25;
      x = Math.cos(a) * r; z = Math.sin(a) * r; y = (s - 0.55) * 1.7 + (w - 0.5) * 0.03;
      [x, y, z] = rotX([x, y, z], 0.25);
    } else if (kind === 'atom') {
      // Three orbits round a nucleus, a third of a turn apart.
      if (i % 9 === 0) {
        const r = 0.17 * Math.cbrt(u), th = v * Math.PI * 2, ph = Math.acos(2 * w - 1);
        x = Math.sin(ph) * Math.cos(th) * r; y = Math.cos(ph) * r; z = Math.sin(ph) * Math.sin(th) * r;
      } else {
        const a = u * Math.PI * 2, k = i % 3;
        let p: V3 = [Math.cos(a) * 0.95, Math.sin(a) * 0.3 + (v - 0.5) * 0.03, (w - 0.5) * 0.03];
        p = rotY(rotX(p, 1.1), k * ((Math.PI * 2) / 3) + 0.4);
        [x, y, z] = rotX(p, 0.3);
      }
    } else {
      const a = u * Math.PI * 2, petals = 7;
      const r = (0.25 + 0.75 * Math.abs(Math.cos((petals / 2) * a))) * Math.sqrt(v) * 0.95;
      x = Math.cos(a) * r; y = Math.sin(a) * r; z = (w - 0.5) * 0.12 + r * r * 0.35;
    }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
}

// ---------- shaders ----------
const HIGHWAY_VERT = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy; // plane in its own space: x across, y along (toward -z after rotation)
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const HIGHWAY_FRAG = /* glsl */ `
  uniform float uTime, uSpeed, uSpb, uBeat, uFever, uLen, uWidth, uSweep, uMiss;
  uniform vec3 uHueA, uHueB;
  uniform float uGlow[4];
  varying vec2 vPos;
  float line(float x, float w) { return 1.0 - smoothstep(0.0, w, abs(x)); }
  void main() {
    float d = vPos.y;               // distance ahead of the hit line
    float x = vPos.x;               // across, -W/2..W/2
    float u = (x + uWidth * 0.5) / uWidth;
    vec3 hue = mix(uHueA, uHueB, u);
    float fade = smoothstep(uLen, uLen * 0.5, d) * smoothstep(-2.5, 0.0, d);
    vec3 col = vec3(0.008, 0.012, 0.03);
    // Fine dotted grid on the glass, like a matrix.
    float lanePos = u * 4.0;
    float tAt = uTime + d / uSpeed;
    float beatF = fract(tAt / uSpb);
    float sub = fract(lanePos * 2.0);
    float dots = line(min(beatF, 1.0 - beatF) * uSpb * uSpeed, 0.04) * line(min(sub, 1.0 - sub), 0.06);
    col += hue * dots * 0.35;
    // Lane separators: hairlines. Edges: crisp, bright, breathing with the beat.
    float sep = line(fract(lanePos + 0.5) - 0.5, 0.008 * 4.0);
    float edge = line(abs(x) - uWidth * 0.5, 0.04);
    col += hue * sep * 0.22 + mix(hue, vec3(1.0), 0.35) * edge * (1.3 + uBeat * 0.9);
    // Bar lines scroll toward the player.
    float barF = fract(tAt / (uSpb * 4.0));
    float br = line(min(barF, 1.0 - barF) * uSpb * 4.0 * uSpeed, 0.06);
    col += hue * br * 0.45;
    // Light pours up the lane after presses and hits.
    int lane = int(clamp(floor(lanePos), 0.0, 3.0));
    float g = uGlow[0] * float(lane == 0) + uGlow[1] * float(lane == 1) + uGlow[2] * float(lane == 2) + uGlow[3] * float(lane == 3);
    float inLane = 1.0 - smoothstep(0.32, 0.5, abs(fract(lanePos) - 0.5));
    col += hue * g * exp(-max(d, 0.0) * 0.1) * (0.5 + inLane * 0.6);
    // A section change sends a band of light away down the field.
    float sweep = exp(-pow((d - uSweep * uLen) * 0.5, 2.0)) * step(0.001, uSweep) * (1.0 - uSweep);
    col += mix(hue, vec3(1.0), 0.2) * sweep * 0.6;
    // Fever: the glass turns gold-white and shimmers.
    if (uFever > 0.0) {
      float sh = 0.5 + 0.5 * sin(d * 0.6 - uTime * 4.0 + x * 1.5);
      col += vec3(1.0, 0.82, 0.5) * uFever * (0.06 + sh * 0.1 + edge * 0.8);
    }
    // The floor just ahead of the pads is lit.
    col += hue * 0.16 * exp(-abs(d) * 0.7);
    // A miss drains the colour for a moment.
    col = mix(col, vec3(dot(col, vec3(0.33))) * vec3(1.2, 0.6, 0.65), uMiss * 0.7);
    float a = 0.84 * fade + (edge + sep * 0.3 + dots * 0.2) * 0.3 * fade;
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
// The walls carry the climb: bands of light that run up both sides of the track, from the hit
// line to the far end, top edge leading, with a comet tail. Only when the song calls for it: a
// downbeat that hits harder than the music around it, a drop, a new section; gold volleys for
// fever and milestones. Quiet stretches leave the walls still.
const WALL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uLen, uBeat, uFever, uReach, uLit;
  uniform vec4 uClimb[${MAX_CLIMB}]; // x: distance ahead of the hit line, y: strength, z: width, w: gold
  varying vec2 vUv;
  void main() {
    float h = vUv.y;                       // 0 at the floor, 1 at the top
    float d = (1.0 - vUv.x) * uLen;        // distance ahead of the hit line
    // Dark until something lights it (uLit); the light first stretches from the hit line to the
    // far end (uReach 0..1, a bright front leading it), then holds and fades.
    float reach = uReach * (uLen + 2.0);
    float lit = smoothstep(reach + 1.2, reach - 0.6, d) * uLit;
    float fade = smoothstep(uLen + 0.5, uLen * 0.88, d) * smoothstep(-2.0, 0.5, d);
    float a = pow(1.0 - h, 2.6) * fade * lit * (0.5 + uBeat * 0.35 + uFever * 0.3);
    vec3 c = mix(uColor, vec3(1.0, 0.85, 0.55), uFever * 0.6);
    vec3 col = c * (1.0 + (1.0 - h) * 0.8) * a;
    float front = exp(-pow(d - reach, 2.0) * 0.6) * (1.0 - smoothstep(0.85, 1.0, uReach)) * uLit * fade;
    col += mix(c, vec3(1.0), 0.5) * front * pow(1.0 - h, 1.4) * 1.6;
    // The climb: summed over the bands, then saturated so a busy run never whites out the walls.
    float far = 1.0 - smoothstep(uLen * 0.9, uLen, d);
    float body = 0.1 + 0.9 * pow(max(0.0, 1.0 - h), 1.7);
    float glow = 0.0, rungs = 0.0, gold = 0.0;
    for (int i = 0; i < ${MAX_CLIMB}; i++) {
      vec4 k = uClimb[i];
      if (k.y <= 0.002) continue;
      float wd = max(0.3, k.z);
      float x = d - k.x + h * 1.1;         // slanted: the top leads, so it reads as climbing
      float head = exp(-x * x / (wd * wd));
      float tail = x < 0.0 ? exp(x / (wd * 3.0)) * 0.3 : 0.0;
      float e = (head + tail) * k.y;
      glow += e;
      gold += e * k.w;
      rungs += exp(-x * x / (wd * wd * 0.03)) * k.y;
    }
    float sat = (1.0 - exp(-glow)) * body * far * step(0.0, d + 1.0);
    vec3 tint = mix(c, vec3(1.0, 0.84, 0.5), clamp(gold / max(glow, 0.001), 0.0, 1.0));
    col += tint * sat * 0.9 + vec3(0.9) * min(rungs, 1.0) * body * far * 0.5;
    // The canvas is see-through over the page's backdrop, so alpha must follow the light (alpha 1
    // here would make the dark parts of the wall an opaque black slab).
    col = min(col, vec3(3.0));
    float A = clamp(max(col.r, max(col.g, col.b)), 0.0001, 1.0);
    gl_FragColor = vec4(col / A, A);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const PAD_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uPress, uFlash;
  varying vec2 vUv;
  float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  void main() {
    vec2 p = vUv - 0.5;
    float d = box(p, vec2(0.42, 0.32), 0.06);
    float frame = 1.0 - smoothstep(0.0, 0.012, abs(d));
    // Corner brackets are brighter than the sides.
    float corner = step(0.3, abs(p.x)) * step(0.2, abs(p.y));
    float fill = (1.0 - smoothstep(-0.01, 0.01, d)) * (0.05 + uPress * 0.45 + uFlash * 0.7);
    float halo = exp(-max(d, 0.0) * 22.0) * (0.15 + uFlash * 0.9 + uPress * 0.2);
    vec3 c = uColor * (frame * (0.7 + corner * 0.9 + uFlash) + fill + halo) + vec3(1.0) * (frame * (uFlash * 0.7 + corner * 0.25) + fill * uFlash * 0.4);
    gl_FragColor = vec4(c, clamp(frame * (0.55 + corner * 0.45) + fill + halo * 0.6, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const UV_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// Tiles: glassy blocks lit from inside, with bright rims that catch the light.
const TILE_VERT = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vTop;
  void main() {
    vec4 world = instanceMatrix * vec4(position, 1.0);
    vec4 mv = modelViewMatrix * world;
    vColor = instanceColor;
    vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vView = normalize(-mv.xyz);
    vTop = position.y;
    gl_Position = projectionMatrix * mv;
  }
`;
const TILE_FRAG = /* glsl */ `
  uniform float uFever;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vTop;
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
    float top = smoothstep(-0.12, 0.12, vTop);
    vec3 c = vColor * (0.55 + top * 0.75) + vec3(1.0) * rim * 1.1 + vColor * rim * 0.8;
    c = mix(c, c * vec3(1.15, 1.0, 0.75) + vec3(0.12, 0.08, 0.0), uFever * 0.5);
    gl_FragColor = vec4(c, 0.94);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const SPARK_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uPointScale; // 0.5 when drawn into a half-size layer (halfFx)
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    #ifdef CULL_DEAD
    if (aAlpha <= 0.0) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    #endif
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(aSize * (300.0 / -mv.z), 26.0) * uPointScale;
    gl_Position = projectionMatrix * mv;
  }
`;
const SPARK_FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p);
    float a = smoothstep(0.5, 0.0, r);
    a *= a;
    gl_FragColor = vec4(vColor * (0.9 + a * 1.4), a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const WORLD_VERT = /* glsl */ `
  attribute vec3 aTarget;
  attribute float aSeed;
  uniform float uMorph, uTime, uBeat, uBass, uHigh, uPulse, uFever, uSpin, uCalm, uPx, uBright;
  uniform vec3 uHueA, uHueB;
  varying vec3 vColor;
  varying float vAlpha;
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
  void main() {
    // Each point leaves a little later than the last, so a new form flows in like a current.
    float m = smoothstep(0.0, 1.0, clamp(uMorph * 1.6 - aSeed * 0.6, 0.0, 1.0));
    vec3 p = mix(position, aTarget, m);
    float swirl = sin(m * 3.14159);
    p.xz = rot(swirl * (1.2 + aSeed * 2.5)) * p.xz;
    p *= 1.0 + swirl * 0.4 * (aSeed - 0.25);
    p += 0.03 * vec3(sin(uTime * 0.7 + aSeed * 40.0), cos(uTime * 0.9 + aSeed * 31.0), sin(uTime * 0.5 + aSeed * 17.0));
    p *= 1.0 + uBeat * 0.04 + uBass * 0.06 + uPulse * 0.08;
    p.xz = rot(uTime * uSpin) * p.xz;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float tw = 0.5 + 0.5 * sin(uTime * (1.2 + aSeed * 3.0) + aSeed * 90.0);
    gl_PointSize = min(18.0, (1.0 + aSeed * 1.9) * (0.7 + tw * 0.6) * (1.0 + uHigh * 0.8 + uPulse * 0.6) * uPx * (300.0 / -mv.z));
    gl_Position = projectionMatrix * mv;
    vec3 col = mix(uHueA, uHueB, fract(aSeed * 7.13));
    col = mix(col, vec3(1.0, 0.84, 0.52), uFever * 0.65);
    vColor = col + vec3(0.2) * step(0.96, aSeed);
    vAlpha = (0.08 + 0.2 * tw) * (0.7 + uBeat * 0.45 + uBass * 0.3 + uPulse * 0.7) * uCalm * uBright;
  }
`;

// Ribbons of light flowing round the sky, like Tetris Effect's streams: each is a band that sweeps
// in a long arc far behind the track, ripples with the music, and carries sparks of light along
// it. Everything is computed here from a few uniforms (no per-frame CPU work).
const RIBBON_VERT = /* glsl */ `
  attribute float aT;
  attribute float aSide;
  attribute float aSeed;
  uniform float uTime, uFlow, uBass, uMid, uBeat, uPulse, uFever;
  uniform vec3 uHueA, uHueB;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSide;
  void main() {
    float s = aSeed;
    float dir = s < 0.5 ? 1.0 : -1.0;
    float th = aT * 6.2832 * (0.5 + s * 0.45) + uFlow * (0.25 + s * 0.3) * dir + s * 40.0;
    float R = 32.0 + 12.0 * s + 6.0 * sin(th * 2.0 + s * 9.0 + uTime * 0.2);
    vec3 p = vec3(cos(th) * R * 1.55, 8.0 + 11.0 * s + 5.0 * sin(th * 1.7 + uTime * 0.35 + s * 13.0), -80.0 + sin(th) * R * 0.55);
    // Ripples run along it with the music.
    p.y += sin(aT * 34.0 - uTime * 3.2 + s * 20.0) * (0.3 + uMid * 1.8 + uPulse * 1.2);
    float w = (0.3 + 0.55 * s) * (1.0 + uBass * 1.5 + uPulse * 2.0 + uBeat * 0.4);
    p.y += aSide * w;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    float run = fract(aT * 1.4 - uTime * (0.14 + s * 0.12) * dir + s);
    float spark = exp(-pow((run - 0.5) * 10.0, 2.0));
    vec3 col = mix(uHueA, uHueB, fract(s * 3.7 + aT * 0.8));
    vColor = mix(col, vec3(1.0, 0.78, 0.42), uFever * 0.7) + vec3(spark * 0.45);
    vAlpha = sin(aT * 3.14159) * (0.06 + 0.12 * uBeat + 0.1 * uBass + 0.36 * spark + 0.25 * uPulse + 0.08 * uFever);
    vSide = aSide;
  }
`;
const RIBBON_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSide;
  void main() {
    float a = 1.0 - vSide * vSide;
    gl_FragColor = vec4(vColor, a * a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// The particle world is a faint, deep layer: soft dots that never wash out the playfield.
const WORLD_FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float a = smoothstep(0.5, 0.05, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(vColor, a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface Glint { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; vx: number; vy: number; vz: number; spin: number; age: number; life: number; size: number; active: boolean }
interface Flare { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; age: number; life: number; size: number; active: boolean }
interface Ring { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number; life: number; grow: number; delay: number; active: boolean }
interface Shell { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number; life: number; big: number; active: boolean }
interface Bar { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number; life: number; width: number; active: boolean }

// In a worker these classes don't exist, so instanceof checks go through these.
const isElement = (h: unknown): h is HTMLElement => typeof HTMLElement !== 'undefined' && h instanceof HTMLElement;
const isCanvasEl = (c: unknown): c is HTMLCanvasElement => typeof HTMLCanvasElement !== 'undefined' && c instanceof HTMLCanvasElement;

/** Where a stage draws in a worker: its canvas and the page's size for it. */
export interface StageSurface { canvas: OffscreenCanvas; width: number; height: number; dpr: number }

export class Stage3D {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(52, 1, 0.1, 260);
  private rig = new THREE.Group(); // drifts in showcase
  private world = new THREE.Group(); // playfield space: hit line at z = 0, tiles toward -z

  private highwayMat: THREE.ShaderMaterial;
  private wallMats: THREE.ShaderMaterial[] = [];
  // The climb: per wall, MAX_CLIMB bands of light (x: distance, y: strength, z: width, w: gold),
  // and each band's speed. Reused in place; never allocated per frame.
  private climbs: THREE.Vector4[][] = [];
  private climbSpeed: Float32Array[] = [];
  private lastSongClimb = -9;
  private energyAvg = 0; // the music's recent loudness, so the climb can tell an accent
  private pads: THREE.ShaderMaterial[] = [];
  private padMeshes: THREE.Mesh[] = [];
  private beams: THREE.Mesh[] = [];
  private beamMats: THREE.MeshBasicMaterial[] = [];
  private hitLine: THREE.Mesh;
  private heads: THREE.InstancedMesh;
  private tileMat: THREE.ShaderMaterial;
  private headGlow: THREE.InstancedMesh;
  private bodies: THREE.InstancedMesh;

  private sparks: THREE.Object3D;
  /** The point materials (sparks, motes) whose size halves in half-size layers. */
  private pointMats: THREE.Material[] = [];
  private sparkGeo!: THREE.BufferGeometry;
  private dustGeo!: THREE.BufferGeometry;
  private sp = {
    pos: new Float32Array(MAX_SPARKS * 3), vel: new Float32Array(MAX_SPARKS * 3), col: new Float32Array(MAX_SPARKS * 3),
    size: new Float32Array(MAX_SPARKS), alpha: new Float32Array(MAX_SPARKS), life: new Float32Array(MAX_SPARKS), age: new Float32Array(MAX_SPARKS),
    grav: new Float32Array(MAX_SPARKS), drag: new Float32Array(MAX_SPARKS), spin: new Float32Array(MAX_SPARKS), cx: new Float32Array(MAX_SPARKS), cz: new Float32Array(MAX_SPARKS),
    next: 0,
  };
  private live = 0;
  /** The pads' hit and hold bursts, baked from the Rive art (perf profiles with rive: 'baked'). */
  private bursts: Bursts | null = null;
  /** The WebGPU materials, when the stage draws with WebGPU (profile B). */
  private gpu: GpuKit | null = null;
  /** Resolves once the renderer can draw (WebGPU starts asynchronously). */
  ready: Promise<void> = Promise.resolve();
  /** The graphics chip's time per frame (only when asked: the /demo stage worker). */
  timer: GpuTimer | null = null;
  /** The last frame's time issuing draws (ms; the rest of frame() is updating). */
  drawMs = 0;
  /** Starts timing the graphics chip (after `ready`). */
  timeGpu() { this.timer = new GpuTimer(this.renderer, !!this.gpu); return this.timer.available; }
  /** Soft effects at half resolution (perf profile option 3). */
  private halfFx: HalfFx | null = null;
  /** Drawn first, under everything (the sky, when the stage draws the backdrop: profile C). */
  drawUnder: (() => void) | null = null;
  /** The page's backdrop, drawn here (perf profile option 4, backdrop: 'stage'). */
  private sky: SkyGL | null = null;
  /** Sparks in use (the pool's share for this perf profile) and whether colours/sizes changed. */
  private sparkCap = MAX_SPARKS;
  private sparkDirty = true;
  /** Adaptive resolution (perf profile "adaptive"). */
  private adapt = { ema: 1000 / 60, slow: 0, fast: 0, cool: 0, dpr: 1, fx: 1 };
  private dust: THREE.Object3D;
  private glints: Glint[] = [];
  private glintNext = 0;
  private flares: Flare[] = [];
  private flareNext = 0;
  private rings: Ring[] = [];
  private ringNext = 0;
  private shells: Shell[] = [];
  private shellNext = 0;
  private bars: Bar[] = [];
  private barNext = 0;
  private padS = [1, 1, 1, 1];
  private padV = [0, 0, 0, 0];
  private lastHitAt = -1;
  private lastHitLane = -1;

  // The sky: ribbons, rings pulsing from the world, columns of light on the horizon.
  private ribbonMat: THREE.ShaderMaterial;
  private flow = 0;
  private skyRings: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number; life: number; grow: number; peak: number; delay: number; active: boolean }[] = [];
  private skyRingNext = 0;
  private pillars: THREE.Mesh[] = [];
  private pillarMats: THREE.MeshBasicMaterial[] = [];
  private pillarH = new Float32Array(PILLARS);
  private lastSkyBurst = -9;
  /** The walls' light: how far it has stretched (0..1), how bright, and how long it holds. */
  private wallReach = 1;
  private wallLit = 0;
  private wallHold = 0;
  /** A storm: the whole sky goes wild for a few seconds (0..1), and its own clock for the chain of bursts. */
  private storm = 0;
  private stormTick = 0;
  private comets: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; vx: number; vy: number; age: number; life: number; active: boolean }[] = [];
  private cometNext = 0;
  private nextComet = 4;
  /** The sky reacting (a burst, a pulse, a storm): where on the stage's canvas (px) and how hard, for the page's backdrop. */
  onSky?: (x: number, y: number, strength: number) => void;

  // The particle world.
  private form: THREE.Object3D;
  private formMat: THREE.ShaderMaterial;
  private formGeo: THREE.BufferGeometry;
  private formIndex = 0;
  private formRand = seeded(20261031);
  private morph = 1;
  private lastReform = -99;
  private pulse = 0;

  private mode: StageMode;
  private hues: [number, number] = [196, 272];
  private laneColors: THREE.Color[] = [];
  private white = new THREE.Color(1, 1, 1);
  private red = new THREE.Color(1, 0.3, 0.38);
  private gold = new THREE.Color(1, 0.84, 0.5);
  private dim = new THREE.Color(0.2, 0.2, 0.26);
  private speed = 20; // units per second
  private spb = 0.5;
  private glow = [0, 0, 0, 0];
  private press = [0, 0, 0, 0];
  private flash = [0, 0, 0, 0];
  private beat = 0;
  private levels = { bass: 0, mid: 0, high: 0, level: 0 };
  private build = 0;
  private calm = 0;
  private fever = 0;
  private feverTarget = 0;
  private shake = 0;
  private kick = 0;
  private sweep = 0;
  private missFx = 0;
  /** The signal dropping (the run failed): -1 while playing, then 0..1 over FAIL_SECONDS. */
  private failK = -1;
  private laneDead = [false, false, false, false];
  private clock = 0;
  private lastT = 0;
  private tmp = new THREE.Object3D();
  private tmpColor = new THREE.Color();
  private tmpV = new THREE.Vector3();
  private ghostNotes: StageNote[] = [];
  private ghostLoop = 0;
  private ghostPrev = 0;
  private releaseAt = [0, 0, 0, 0];
  private offs: (() => void)[] = [];
  /** Showcase: called when the ghost hits a tile (so the backdrop can react on the menu too). */
  onGhostHit?: (lane: number, kind: HitKind) => void;
  private width = 1;
  private height = 1;

  /**
   * `host`: the element the stage fills (its canvas is added to it), or, in a worker (perf profile
   * C), a surface: an OffscreenCanvas and its size, kept up to date with setSurface.
   */
  constructor(private host: HTMLElement | StageSurface, opts: { mode: StageMode; hues?: [number, number]; gpu?: GpuKit }) {
    this.mode = opts.mode;
    // The game's profile shapes both stages. The menu's preview stays see-through (the backdrop
    // shows behind it) and has none of the game screen's own layers (its sky, the baked bursts and
    // the half-size light, which is composited over an opaque sky).
    const pf: PerfProfile = opts.mode === 'play' ? perf() : { ...perf(), opaque: false, halfFx: false };
    const surface = 'canvas' in host && !('appendChild' in host) ? host : null;
    const K = (this.gpu = opts.gpu ?? null);
    // Perf profiles (only /demo changes them): antialiasing, an opaque canvas, the resolution cap;
    // WebGPU (profile B) through gpu.ts, whose materials stand in for the GLSL ones below.
    this.renderer = K
      ? (K.makeRenderer(surface?.canvas ?? document.createElement('canvas'), { antialias: pf.antialias, alpha: !pf.opaque }) as unknown as THREE.WebGLRenderer)
      : new THREE.WebGLRenderer({ canvas: surface?.canvas, antialias: pf.antialias, alpha: !pf.opaque, powerPreference: 'high-performance' });
    this.ready = K ? (this.renderer as unknown as { init(): Promise<unknown> }).init().then(() => {}) : Promise.resolve();
    const Basic = THREE.MeshBasicMaterial, Spr = THREE.SpriteMaterial;
    const basicMat = (o: THREE.MeshBasicMaterialParameters) => (K ? K.basic(o) : new Basic(o));
    const spriteMat = (o: THREE.SpriteMaterialParameters) => (K ? K.sprite(o) : new Spr(o));
    this.renderer.setClearColor(pf.opaque ? 0x02030a : 0x000000, pf.opaque ? 1 : 0);
    this.adapt.dpr = Math.min(pf.dpr, this.deviceRatio);
    this.adapt.fx = pf.fx;
    this.sparkCap = Math.max(200, Math.round(MAX_SPARKS * pf.fx));
    this.renderer.setPixelRatio(this.adapt.dpr);
    stageInfo.dpr = this.adapt.dpr;
    stageInfo.fx = pf.fx;
    if (!K) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.2;
    }
    this.canvas = this.renderer.domElement;
    if (isElement(host)) {
      this.canvas.className = 'stage-canvas';
      host.appendChild(this.canvas);
    }

    this.scene.add(this.rig);
    this.rig.add(this.world);

    const glow = glowTexture();

    // The particle world, far behind the playfield.
    this.formGeo = new THREE.BufferGeometry();
    const a = new Float32Array(WORLD_POINTS * 3), b = new Float32Array(WORLD_POINTS * 3), seeds = new Float32Array(WORLD_POINTS);
    formPoints(FORMS[0], a, this.formRand);
    b.set(a);
    for (let i = 0; i < WORLD_POINTS; i++) seeds[i] = this.formRand();
    // WebGPU draws points as instanced sprites: the same arrays, as per-instance attributes.
    const Attr = K ? THREE.InstancedBufferAttribute : THREE.BufferAttribute;
    this.formGeo.setAttribute('position', new Attr(a, 3));
    this.formGeo.setAttribute('aTarget', new Attr(b, 3));
    this.formGeo.setAttribute('aSeed', new Attr(seeds, 1));
    const formUniforms = {
      uMorph: { value: 1 }, uTime: { value: 0 }, uBeat: { value: 0 }, uBass: { value: 0 }, uHigh: { value: 0 }, uPulse: { value: 0 },
      uFever: { value: 0 }, uSpin: { value: 0.05 }, uCalm: { value: 1 }, uPx: { value: 1 }, uBright: { value: 1 },
      uHueA: { value: new THREE.Color() }, uHueB: { value: new THREE.Color() },
    };
    const formParams = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    if (K) {
      const w = K.world(formUniforms, formParams, { pos: this.formGeo.attributes.position as THREE.BufferAttribute, target: this.formGeo.attributes.aTarget as THREE.BufferAttribute, seed: this.formGeo.attributes.aSeed as THREE.BufferAttribute }, Math.round(WORLD_POINTS * Math.min(1, pf.fx)));
      this.formMat = w.material as unknown as THREE.ShaderMaterial;
      this.form = w.object;
    } else {
      this.formMat = new THREE.ShaderMaterial({ vertexShader: WORLD_VERT, fragmentShader: WORLD_FRAG, ...formParams, uniforms: formUniforms });
      this.form = new THREE.Points(this.formGeo, this.formMat);
      if (pf.fx < 1) this.formGeo.setDrawRange(0, Math.round(WORLD_POINTS * pf.fx));
    }
    this.form.frustumCulled = false;
    this.form.renderOrder = -2;
    this.scene.add(this.form);

    // The sky. Ribbons: one strip of RIB_SEG quads per ribbon, shaped in the vertex shader.
    {
      const verts = RIBBONS * (RIB_SEG + 1) * 2;
      const at = new Float32Array(verts), side = new Float32Array(verts), seed = new Float32Array(verts);
      const index: number[] = [];
      for (let r = 0; r < RIBBONS; r++) {
        const sd = (r + 0.5) / RIBBONS;
        for (let k = 0; k <= RIB_SEG; k++) {
          const v = (r * (RIB_SEG + 1) + k) * 2;
          for (let e = 0; e < 2; e++) { at[v + e] = k / RIB_SEG; side[v + e] = e ? 1 : -1; seed[v + e] = sd; }
          if (k < RIB_SEG) index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
      g.setAttribute('aT', new THREE.BufferAttribute(at, 1));
      g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      g.setIndex(index);
      const ribbonUniforms = {
        uTime: { value: 0 }, uFlow: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uBeat: { value: 0 }, uPulse: { value: 0 }, uFever: { value: 0 },
        uHueA: { value: new THREE.Color() }, uHueB: { value: new THREE.Color() },
      };
      const ribbonParams = { transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };
      this.ribbonMat = K
        ? (K.ribbon(ribbonUniforms, ribbonParams) as unknown as THREE.ShaderMaterial)
        : new THREE.ShaderMaterial({ vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG, ...ribbonParams, uniforms: ribbonUniforms });
      const ribbons = new THREE.Mesh(g, this.ribbonMat);
      ribbons.frustumCulled = false;
      ribbons.renderOrder = -3;
      this.scene.add(ribbons);
    }
    // Rings that pulse out of the world on the bar and on big moments, facing the player.
    for (let i = 0; i < MAX_SKY_RINGS; i++) {
      const mat = basicMat({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 128), mat);
      mesh.position.set(0, SKY.y, SKY.z);
      mesh.visible = false;
      mesh.renderOrder = -3;
      this.scene.add(mesh);
      this.skyRings.push({ mesh, mat, age: 0, life: 1, grow: 1, peak: 0.5, delay: 0, active: false });
    }
    // Comets: streaks of light that shoot across the sky (now and then; in a storm, constantly).
    for (let i = 0; i < MAX_COMETS; i++) {
      const mat = basicMat({ map: glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.visible = false;
      mesh.renderOrder = -3;
      this.scene.add(mesh);
      this.comets.push({ mesh, mat, vx: 0, vy: 0, age: 0, life: 1, active: false });
    }
    // Columns of light along the horizon that rise and fall with the music (a gap in the middle,
    // behind the far end of the lanes).
    {
      const colTex = columnTexture();
      for (let i = 0; i < PILLARS; i++) {
        const f = i / (PILLARS - 1);
        const x = (f - 0.5) * 150;
        if (Math.abs(x) < 9) continue;
        const mat = basicMat({ map: colTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1).translate(0, 0.42, 0), mat);
        m.position.set(x + Math.sin(i * 7.3) * 2, -1 - Math.abs(Math.sin(i * 3.1)) * 3, -96 - Math.abs(x) * 0.15 - Math.abs(Math.sin(i * 5.7)) * 12);
        m.userData.f = f;
        m.renderOrder = -3;
        this.scene.add(m);
        this.pillars.push(m);
        this.pillarMats.push(mat);
      }
    }

    // Playfield glass.
    const highwayUniforms = {
      uTime: { value: 0 }, uSpeed: { value: this.speed }, uSpb: { value: this.spb }, uBeat: { value: 0 }, uFever: { value: 0 },
      uLen: { value: L }, uWidth: { value: W }, uHueA: { value: new THREE.Color() }, uHueB: { value: new THREE.Color() },
      uGlow: { value: [0, 0, 0, 0] }, uSweep: { value: 0 }, uMiss: { value: 0 },
    };
    this.highwayMat = K
      ? (K.highway(highwayUniforms, { transparent: true, depthWrite: false }, W) as unknown as THREE.ShaderMaterial)
      : new THREE.ShaderMaterial({ vertexShader: HIGHWAY_VERT, fragmentShader: HIGHWAY_FRAG, transparent: true, depthWrite: false, uniforms: highwayUniforms });
    const hw = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.5, L + 3, 1, 1).translate(0, (L + 3) / 2 - 3, 0), this.highwayMat);
    hw.rotation.x = -Math.PI / 2;
    hw.renderOrder = 0;
    this.world.add(hw);

    // Walls of light along both edges.
    for (const side of [-1, 1]) {
      const bands = Array.from({ length: MAX_CLIMB }, () => new THREE.Vector4(0, 0, 1, 0));
      const wallUniforms = { uColor: { value: new THREE.Color() }, uLen: { value: L }, uBeat: { value: 0 }, uFever: { value: 0 }, uReach: { value: 1 }, uLit: { value: 0 }, uClimb: { value: bands } };
      const wallParams = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };
      const mat = K
        ? (K.wall(wallUniforms, wallParams, MAX_CLIMB) as unknown as THREE.ShaderMaterial)
        : new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader: WALL_FRAG, ...wallParams, uniforms: wallUniforms });
      this.climbs.push(bands);
      this.climbSpeed.push(new Float32Array(MAX_CLIMB));
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(L, 1.6), mat);
      wall.rotation.y = side * Math.PI / 2;
      wall.position.set(side * (W / 2 + 0.25), 0.8, -L / 2);
      this.world.add(wall);
      this.wallMats.push(mat);
    }

    // Hit line: a crisp line in a soft glow.
    this.hitLine = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.6, 0.42), basicMat({ map: glow, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.hitLine.rotation.x = -Math.PI / 2;
    this.hitLine.position.set(0, 0.02, 0);
    this.world.add(this.hitLine);
    const core = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.3, 0.03), basicMat({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.rotation.x = -Math.PI / 2;
    core.position.set(0, 0.03, 0);
    this.world.add(core);

    // Receptor frames and their light beams.
    const beam = beamTexture();
    for (let l = 0; l < LANES; l++) {
      const padUniforms = { uColor: { value: new THREE.Color() }, uPress: { value: 0 }, uFlash: { value: 0 } };
      const padParams = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
      const mat = K
        ? (K.pad(padUniforms, padParams) as unknown as THREE.ShaderMaterial)
        : new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader: PAD_FRAG, ...padParams, uniforms: padUniforms });
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(LW * 1.02, LW * 0.82), mat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(laneX(l), 0.035, 0);
      this.world.add(pad);
      this.pads.push(mat);
      this.padMeshes.push(pad);
      const bm = basicMat({ map: beam, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      // Its base sits on the pad, so it grows up from there (scaled about its middle, a short beam
      // floated above the pad as a flat slab).
      const b = new THREE.Mesh(new THREE.PlaneGeometry(LW * 0.7, 7).translate(0, 3.5, 0), bm);
      b.position.set(laneX(l), 0, 0);
      this.world.add(b);
      this.beams.push(b);
      this.beamMats.push(bm);
    }

    // Tiles: instanced glass blocks, a glow on the glass under each, and hold columns.
    const tileGpu = K ? K.tile({ uFever: { value: 0 } }, { transparent: true }) : null;
    this.tileMat = tileGpu ? (tileGpu as unknown as THREE.ShaderMaterial) : new THREE.ShaderMaterial({ vertexShader: TILE_VERT, fragmentShader: TILE_FRAG, transparent: true, uniforms: { uFever: { value: 0 } } });
    const tileGeo = new RoundedBoxGeometry(LW * 0.8, 0.24, 0.46, 3, 0.08);
    this.heads = new THREE.InstancedMesh(tileGeo, this.tileMat, MAX_NOTES);
    this.headGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(LW * 1.6, 1.5).rotateX(-Math.PI / 2), basicMat({ map: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), MAX_NOTES);
    this.bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(LW * 0.3, 0.08, 1).translate(0, 0, -0.5), basicMat({ transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }), MAX_NOTES);
    // Tiles draw after every effect, so bursts and sparks never hide a tile.
    this.heads.renderOrder = 10;
    this.headGlow.renderOrder = 9;
    this.bodies.renderOrder = 9;
    for (const m of [this.heads, this.headGlow, this.bodies]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color());
      m.count = 0;
      m.frustumCulled = false;
      this.world.add(m);
    }
    tileGpu?.useColors(this.heads.instanceColor!);

    // Sparks.
    const sg = new THREE.BufferGeometry();
    this.sparkGeo = sg;
    sg.setAttribute('position', new Attr(this.sp.pos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aColor', new Attr(this.sp.col, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aSize', new Attr(this.sp.size, 1).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aAlpha', new Attr(this.sp.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const pointParams = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    const pointAttrs = (g: THREE.BufferGeometry) => ({ pos: g.attributes.position as THREE.BufferAttribute, col: g.attributes.aColor as THREE.BufferAttribute, size: g.attributes.aSize as THREE.BufferAttribute, alpha: g.attributes.aAlpha as THREE.BufferAttribute });
    let sparkMat: THREE.Material;
    if (K) {
      const sp = K.points({ uPointScale: { value: 1 } }, pointParams, pointAttrs(sg), this.sparkCap, pf.lean3d);
      this.sparks = sp.object;
      sparkMat = sp.material;
    } else {
      sparkMat = new THREE.ShaderMaterial({ vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, ...pointParams, defines: pf.lean3d ? { CULL_DEAD: 1 } : {}, uniforms: { uPointScale: { value: 1 } } });
      this.sparks = new THREE.Points(sg, sparkMat);
      sg.setDrawRange(0, this.sparkCap);
    }
    this.pointMats.push(sparkMat);
    this.sparks.frustumCulled = false;
    this.world.add(this.sparks);

    // Motes drifting over the playfield.
    const DUST = 320;
    const dp = new Float32Array(DUST * 3), dc = new Float32Array(DUST * 3), ds = new Float32Array(DUST), da = new Float32Array(DUST);
    for (let i = 0; i < DUST; i++) {
      dp[i * 3] = (Math.random() - 0.5) * 20; dp[i * 3 + 1] = Math.random() * 9; dp[i * 3 + 2] = -Math.random() * L;
      dc[i * 3] = dc[i * 3 + 1] = dc[i * 3 + 2] = 0.85; ds[i] = 0.2 + Math.random() * 0.5; da[i] = 0.15 + Math.random() * 0.3;
    }
    const dg = new THREE.BufferGeometry();
    this.dustGeo = dg;
    dg.setAttribute('position', new Attr(dp, 3).setUsage(THREE.DynamicDrawUsage));
    dg.setAttribute('aColor', new Attr(dc, 3));
    dg.setAttribute('aSize', new Attr(ds, 1));
    dg.setAttribute('aAlpha', new Attr(da, 1));
    if (K) {
      const du = K.points({ uPointScale: { value: 1 } }, pointParams, pointAttrs(dg), Math.round(DUST * Math.min(1, pf.fx)), false);
      this.dust = du.object;
      this.pointMats.push(du.material);
    } else {
      this.dust = new THREE.Points(dg, sparkMat);
      if (pf.fx < 1) dg.setDrawRange(0, Math.round(DUST * pf.fx));
    }
    this.dust.frustumCulled = false;
    this.world.add(this.dust);

    // Star glints and hit flares.
    const star = starTexture();
    for (let i = 0; i < MAX_GLINTS; i++) {
      const mat = spriteMat({ map: star, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.world.add(sprite);
      this.glints.push({ sprite, mat, vx: 0, vy: 0, vz: 0, spin: 0, age: 0, life: 1, size: 1, active: false });
    }
    for (let i = 0; i < MAX_FLARES; i++) {
      const mat = spriteMat({ map: glow, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.world.add(sprite);
      this.flares.push({ sprite, mat, age: 0, life: 0.3, size: 1, active: false });
    }

    // Shells: a hit tile bursts into a shell of light that flies apart.
    for (let i = 0; i < MAX_SHELLS; i++) {
      const mat = basicMat({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(tileGeo, mat);
      mesh.visible = false;
      this.world.add(mesh);
      this.shells.push({ mesh, mat, age: 0, life: 0.2, big: 1, active: false });
    }
    // Bars of light that join the lanes of a chord.
    for (let i = 0; i < MAX_BARS; i++) {
      const mat = basicMat({ map: glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.6).rotateX(-Math.PI / 2), mat);
      mesh.visible = false;
      this.world.add(mesh);
      this.bars.push({ mesh, mat, age: 0, life: 0.4, width: 1, active: false });
    }

    // Shockwave rings on the glass.
    for (let i = 0; i < MAX_RINGS; i++) {
      const mat = basicMat({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.47, 0.5, 64), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.world.add(mesh);
      this.rings.push({ mesh, mat, age: 0, life: 1, grow: 1, delay: 0, active: false });
    }

    this.setHues(opts.hues ?? this.hues);
    this.layoutForMode();
    this.resize();
    // Lean profiles: compile every shader now, while the song loads, not when the first tile or
    // the first hit draws (a compile can stall a frame for 100 ms or more).
    if (pf.lean3d && !K) this.renderer.compile(this.scene, this.camera);
    // WebGPU builds every pipeline before the song (see warmAsync), after the half-res layers exist.
    if (K) this.ready = this.ready.then(() => this.warmAsync()).catch(() => {});
    if (pf.rive === 'baked' && opts.mode === 'play') this.bursts = new Bursts(undefined, K);
    if (pf.backdrop === 'stage' && opts.mode === 'play') {
      this.sky = new SkyGL({ size: () => ({ w: this.width, h: this.height, dpr: this.deviceRatio }), levels: () => this.levels, half: pf.halfFx, gpu: K });
      this.sky.resize(this.renderer);
      // The song's colours were announced before the stage existed.
      this.sky.handle({ type: 'hues', hues: [...this.hues] as [number, number] });
      this.drawUnder = () => this.sky?.render(this.renderer);
    }
    if (pf.halfFx) {
      const ribbons: THREE.Object3D[] = [];
      this.scene.traverse((o) => { if ((o as THREE.Mesh).material === this.ribbonMat) ribbons.push(o); });
      HalfFx.assign(
        [this.form, ...ribbons, ...this.skyRings.map((r) => r.mesh), ...this.comets.map((c) => c.mesh), ...this.pillars],
        [...this.beams, this.sparks, this.dust, ...this.glints.map((g) => g.sprite), ...this.flares.map((f) => f.sprite), ...this.shells.map((x) => x.mesh), ...this.bars.map((b) => b.mesh), ...this.rings.map((r) => r.mesh), this.headGlow],
        [this.heads, this.bodies],
        this.camera,
      );
      this.halfFx = new HalfFx(K);
      this.halfFx.resize(this.renderer);
      // WebGPU: the sky's final pass adds the far effects (one full-screen pass fewer).
      if (this.sky?.setFar(this.halfFx.targets[0].texture)) this.halfFx.skipFar = true;
    }
    if (isElement(host)) {
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(host);
      this.offs.push(() => ro.disconnect());
    }
  }

  /** The device pixel ratio (from the page, or the surface's in a worker). */
  private get deviceRatio() { return isElement(this.host) ? devicePixelRatio || 1 : this.host.dpr; }

  /** In a worker: the page's new size for the stage. */
  setSurface(width: number, height: number, dpr: number) {
    if (isElement(this.host)) return;
    this.host.width = width; this.host.height = height; this.host.dpr = dpr;
    this.resize();
  }

  /** Which graphics API is drawing: WebGPU, or WebGL (including WebGPU's fallback when the browser has none). */
  get backend() {
    const b = (this.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
    return b ? (b.isWebGPUBackend ? 'WebGPU' : 'WebGL 2 (fallback)') : 'WebGL';
  }

  /**
   * WebGPU: builds the render pipeline of every object before the song, including the pooled
   * effects that are hidden until a hit, a milestone or a drop shows them (otherwise each is built
   * the first time it appears, and the frame drops), and for every target they draw into: the
   * screen and the half-size layers have different formats, so different pipelines.
   */
  private async warmAsync() {
    const r = this.renderer as unknown as { compileAsync(s: THREE.Object3D, c: THREE.Camera): Promise<void>; setRenderTarget(t: THREE.RenderTarget | null): void; render(s: THREE.Object3D, c: THREE.Camera): void };
    const shown: THREE.Object3D[] = [];
    const show = (root: THREE.Object3D) => root.traverse((o) => { if (!o.visible) { o.visible = true; shown.push(o); } });
    show(this.scene);
    // Instanced meshes with no instances yet (the tiles before any are on screen) are skipped too.
    const empty: THREE.InstancedMesh[] = [];
    this.scene.traverse((o) => { const m = o as THREE.InstancedMesh; if (m.isInstancedMesh && m.count === 0) { m.count = 1; empty.push(m); } });
    if (this.bursts) show(this.bursts.scene);
    const mask = this.camera.layers.mask;
    this.camera.layers.enableAll();
    try {
      for (const target of [null, ...(this.halfFx?.targets ?? [])]) {
        r.setRenderTarget(target);
        await r.compileAsync(this.scene, this.camera);
      }
      r.setRenderTarget(null);
      if (this.bursts) await r.compileAsync(this.bursts.scene, this.bursts.camera);
      await this.sky?.warmAsync(this.renderer);
      // Then draw everything once where nobody sees it (a half-size layer, cleared every frame):
      // a first draw also makes each object's buffers and bindings, which costs a frame or more.
      const off = this.halfFx?.targets[0];
      if (off) {
        r.setRenderTarget(off);
        r.render(this.scene, this.camera);
        if (this.bursts) r.render(this.bursts.scene, this.bursts.camera);
      }
    } finally {
      r.setRenderTarget(null);
      this.camera.layers.mask = mask;
      for (const o of shown) o.visible = false;
      for (const m of empty) m.count = 0;
    }
  }

  /** Tone mapping exposure: the renderer's (WebGL) or the materials' (WebGPU). */
  private setExposure(v: number) {
    if (this.gpu) this.gpu.exposure.value = v;
    else this.renderer.toneMappingExposure = v;
  }

  /** WebGL can be missing (old devices, blocked GPU). Callers fall back to 2D. */
  static supported() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch { return false; }
  }

  destroy() {
    this.offs.forEach((f) => f());
    this.bursts?.dispose();
    this.halfFx?.dispose();
    this.sky?.dispose();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
    if (isCanvasEl(this.canvas)) this.canvas.remove();
  }

  // ---------- configuration ----------
  setHues([a, b]: [number, number]) {
    this.hues = [a, b];
    const ca = new THREE.Color().setHSL(a / 360, 1, 0.62), cb = new THREE.Color().setHSL(b / 360, 1, 0.64);
    (this.highwayMat.uniforms.uHueA.value as THREE.Color).copy(ca);
    (this.highwayMat.uniforms.uHueB.value as THREE.Color).copy(cb);
    (this.formMat.uniforms.uHueA.value as THREE.Color).setHSL(a / 360, 0.95, 0.66);
    (this.formMat.uniforms.uHueB.value as THREE.Color).setHSL(b / 360, 0.95, 0.68);
    (this.ribbonMat.uniforms.uHueA.value as THREE.Color).setHSL(a / 360, 1, 0.52);
    (this.ribbonMat.uniforms.uHueB.value as THREE.Color).setHSL(b / 360, 1, 0.55);
    this.pillarMats.forEach((m, i) => m.color.copy(ca).lerp(cb, (this.pillars[i].userData.f as number) ?? 0.5));
    this.laneColors = [0, 1, 2, 3].map((l) => ca.clone().lerp(cb, l / 3));
    this.pads.forEach((p, l) => (p.uniforms.uColor.value as THREE.Color).copy(this.laneColors[l]));
    this.beamMats.forEach((m, l) => m.color.copy(this.laneColors[l]));
    this.wallMats.forEach((m, i) => (m.uniforms.uColor.value as THREE.Color).copy(i ? cb : ca));
    (this.hitLine.material as THREE.MeshBasicMaterial).color.copy(ca).lerp(cb, 0.5).multiplyScalar(1.3);
  }

  /** Tempo and fall speed: tiles take `travel` seconds to reach the hit line from ~2/3 of the way down. */
  setTiming(spb: number, travel: number) {
    this.spb = spb;
    this.speed = (L * 0.62) / travel;
    this.highwayMat.uniforms.uSpb.value = spb;
    this.highwayMat.uniforms.uSpeed.value = this.speed;
  }

  /** Showcase only: the chart the ghost plays, looped. */
  setGhostChart(notes: StageNote[]) {
    this.ghostNotes = notes.map((n) => ({ ...n, judged: undefined, holding: false, holdResult: undefined }));
    this.ghostLoop = Math.max(8, ...notes.map((n) => n.end)) + this.spb * 4;
  }

  setFever(on: boolean) {
    const target = on ? 1 : 0;
    if (target === this.feverTarget) return;
    this.feverTarget = target;
    if (on) {
      this.feverBurst();
      for (let k = 0; k < 4; k++) this.climb(0, 0.9, { gold: 1, delay: k * 3, width: 1.3, speed: 34 });
    }
  }

  private layoutForMode() {
    if (this.mode === 'play') {
      this.rig.position.set(0, 0, 0);
      this.world.position.set(0, 0, 0);
      this.form.position.set(0, 13, -70);
      this.form.scale.setScalar(22);
      this.formMat.uniforms.uBright.value = 0.55;
      this.camera.fov = 52;
    } else {
      this.rig.position.set(0, 0, -9);
      this.world.position.set(0, 0, 9);
      this.form.position.set(0, 8.5, -52);
      this.form.scale.setScalar(16);
      this.formMat.uniforms.uBright.value = 0.8;
      this.camera.fov = 44;
    }
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const r = isElement(this.host) ? this.host.getBoundingClientRect() : this.host;
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.renderer.setSize(this.width, this.height, false);
    if (isCanvasEl(this.canvas)) {
      this.canvas.style.width = `${this.width}px`;
      this.canvas.style.height = `${this.height}px`;
    }
    this.camera.aspect = this.width / this.height;
    // Narrow screens: pull back so all four lanes fit.
    const narrow = Math.min(1, this.camera.aspect / 0.9);
    this.camera.userData.back = 1 / Math.max(0.55, narrow);
    this.camera.updateProjectionMatrix();
    this.formMat.uniforms.uPx.value = this.renderer.getPixelRatio() * Math.min(1.2, Math.max(0.6, this.height / 760));
    this.halfFx?.resize(this.renderer);
    this.sky?.resize(this.renderer);
  }

  // ---------- effects ----------
  private laneColor(l: number) { return this.laneColors[Math.max(0, Math.min(3, l))]; }

  private emit(x: number, y: number, z: number, n: number, color: THREE.Color, o: { speed?: number; up?: number; size?: number; life?: number; grav?: number; white?: number; drag?: number; spin?: number; flat?: number } = {}) {
    const S = this.sp;
    // Plenty on screen already: fewer new ones, so the tiles stay easy to see.
    if (this.live > 2600 * this.adapt.fx) n = Math.ceil(n * 0.5);
    if (this.adapt.fx < 1) n = Math.ceil(n * Math.max(0.35, this.adapt.fx));
    this.sparkDirty = true;
    const speed = o.speed ?? 6, up = o.up ?? 4, size = o.size ?? 1, life = o.life ?? 0.8, grav = o.grav ?? 9, drag = o.drag ?? 1.8, spin = o.spin ?? 0, flat = o.flat ?? 0.7;
    for (let k = 0; k < n; k++) {
      const i = S.next;
      S.next = (S.next + 1) % this.sparkCap;
      const a = Math.random() * Math.PI * 2;
      const r = speed * (0.35 + Math.random() * 0.65);
      S.pos[i * 3] = x; S.pos[i * 3 + 1] = y; S.pos[i * 3 + 2] = z;
      S.vel[i * 3] = Math.cos(a) * r;
      S.vel[i * 3 + 1] = up * (0.3 + Math.random());
      S.vel[i * 3 + 2] = Math.sin(a) * r * flat;
      const w = Math.random() < (o.white ?? 0.25);
      S.col[i * 3] = w ? 1 : color.r; S.col[i * 3 + 1] = w ? 1 : color.g; S.col[i * 3 + 2] = w ? 1 : color.b;
      S.size[i] = size * (0.45 + Math.random() * 0.9);
      S.life[i] = life * (0.6 + Math.random() * 0.6);
      S.age[i] = 0;
      S.grav[i] = grav;
      S.drag[i] = drag;
      S.spin[i] = spin * (0.6 + Math.random() * 0.8);
      S.cx[i] = x; S.cz[i] = z;
    }
  }

  private glint(x: number, y: number, z: number, color: THREE.Color, o: { size?: number; vx?: number; vy?: number; vz?: number; life?: number } = {}) {
    const g = this.glints[this.glintNext];
    this.glintNext = (this.glintNext + 1) % MAX_GLINTS;
    g.active = true;
    g.age = 0;
    g.life = o.life ?? 0.8 + Math.random() * 0.6;
    g.size = (o.size ?? 0.9) * (0.6 + Math.random() * 0.5);
    g.vx = o.vx ?? (Math.random() - 0.5) * 2.4;
    g.vy = o.vy ?? 1.6 + Math.random() * 1.6;
    g.vz = o.vz ?? -Math.random() * 1.2;
    g.spin = (Math.random() - 0.5) * 4;
    g.sprite.position.set(x, y, z);
    g.mat.color.copy(color).lerp(this.white, 0.45);
    g.mat.rotation = Math.random() * Math.PI;
    g.sprite.visible = true;
  }

  private flare(x: number, y: number, z: number, color: THREE.Color, size: number, life = 0.32) {
    const f = this.flares[this.flareNext];
    this.flareNext = (this.flareNext + 1) % MAX_FLARES;
    f.active = true;
    f.age = 0;
    f.life = life;
    f.size = size;
    f.sprite.position.set(x, y, z);
    f.mat.color.copy(color).lerp(this.white, 0.35);
    f.sprite.visible = true;
  }

  private ring(x: number, z: number, color: THREE.Color, grow = 3, life = 0.5, delay = 0) {
    const r = this.rings[this.ringNext];
    this.ringNext = (this.ringNext + 1) % MAX_RINGS;
    r.active = true;
    r.age = -delay;
    r.life = life;
    r.grow = grow;
    r.mesh.position.set(x, 0.05, z);
    r.mat.color.copy(color);
    r.mat.opacity = 0;
    r.mesh.visible = true;
  }

  /** A tile was hit: a burst of light that swirls up and away. */
  hit(lane: number, kind: HitKind) {
    const c = this.laneColor(lane);
    const x = laneX(lane);
    const big = kind === 'perfect' ? 1 : kind === 'great' ? 0.7 : 0.45;
    this.flash[lane] = 1;
    this.glow[lane] = Math.max(this.glow[lane], 0.6 + big * 0.4);
    // A quick bright core, then a slower cloud that spirals upward and drifts.
    this.emit(x, 0.25, 0, Math.round(26 * big + 10), c, { speed: 6 + big * 5, up: 3, size: 0.9, life: 0.5, grav: 5, drag: 4.5, white: 0.4 });
    this.emit(x, 0.35, 0.3, Math.round(24 * big + 6), c, { speed: 2.2 + big * 1.4, up: 1.6, size: 1.1, life: 1, grav: -0.35, drag: 2.6, spin: (lane < 2 ? -1 : 1) * 2.6, white: 0.18 });
    this.flare(x, 0.4, 0.2, c, 0.9 + big * 1.1, 0.18 + big * 0.08);
    // The tile bursts into a shell of light; the receptor kicks; the camera takes a small punch.
    const sh = this.shells[this.shellNext];
    this.shellNext = (this.shellNext + 1) % MAX_SHELLS;
    sh.active = true; sh.age = 0; sh.life = 0.16 + big * 0.1; sh.big = big;
    sh.mesh.position.set(x, 0.16, 0);
    sh.mat.color.copy(c).lerp(this.white, 0.2 + big * 0.2);
    sh.mesh.visible = true;
    this.padV[lane] += 5 + big * 6;
    this.kick = Math.max(this.kick, 0.08 + big * 0.14);
    // Two lanes hit together: a bar of light joins them.
    if (this.clock - this.lastHitAt < 0.035 && this.lastHitLane >= 0 && this.lastHitLane !== lane) {
      const bar = this.bars[this.barNext];
      this.barNext = (this.barNext + 1) % MAX_BARS;
      const x0 = laneX(this.lastHitLane);
      bar.active = true; bar.age = 0; bar.life = 0.42;
      bar.width = Math.abs(x - x0) + LW * 0.6;
      bar.mesh.position.set((x + x0) / 2, 0.08, 0);
      bar.mat.color.copy(c).lerp(this.laneColor(this.lastHitLane), 0.5).lerp(this.white, 0.3);
      bar.mesh.visible = true;
      this.pulse = Math.min(1, this.pulse + 0.2);
    }
    this.lastHitAt = this.clock;
    this.lastHitLane = lane;
    this.ring(x, 0, c, 1.1 + big * 1.6, 0.38 + big * 0.18);
    if (kind === 'perfect') {
      this.ring(x, 0, this.white, 0.9, 0.3, 0.06);
      for (let k = 0; k < 3; k++) this.glint(x + (Math.random() - 0.5) * 0.6, 0.6, -0.2, c, { size: 1 });
    } else if (kind === 'great') this.glint(x, 0.6, -0.2, c, { size: 0.8 });
    this.pulse = Math.min(1, this.pulse + 0.12 * big);
    // Every hit echoes far away in the sky, above its own side of the track.
    this.emit((lane - 1.5) * 9 + (Math.random() - 0.5) * 6, 10 + Math.random() * 7, -58 - Math.random() * 14, Math.round(5 + 9 * big), c,
      { speed: 3 + big * 3, up: 1.5, size: 3.6, life: 1.8, grav: -0.25, drag: 0.7, white: 0.25, flat: 1 });
  }

  /** A ring of light pulses out of the world, far behind the track. */
  private skyPulse(color: THREE.Color, peak: number, grow = 40, life = 1.8, delay = 0) {
    const r = this.skyRings[this.skyRingNext];
    this.skyRingNext = (this.skyRingNext + 1) % MAX_SKY_RINGS;
    r.active = true; r.age = -delay; r.life = life; r.grow = grow; r.peak = peak;
    r.mat.color.copy(color);
    r.mesh.scale.setScalar(2);
    r.mat.opacity = 0;
    r.mesh.visible = true;
  }

  /** Fireworks in the sky: a sphere of light bursting far behind the track. */
  private skyBurst(x: number, y: number, z: number, color: THREE.Color, n = 90, big = 1) {
    this.emit(x, y, z, n, color, { speed: 11 * big, up: 5, size: 4.2 * big, life: 2.4, grav: 1.4, drag: 1.1, white: 0.35, flat: 1 });
    this.flare(x, y, z, color, 14 * big, 0.5);
    this.tellSky(x, y, z, Math.min(1, n / 90));
  }

  /** Tells the page where on screen the sky just reacted, so its backdrop can answer. */
  private tellSky(x: number, y: number, z: number, strength: number) {
    if (!this.onSky) return;
    const v = this.tmpV.set(x, y, z).project(this.camera);
    this.onSky((v.x * 0.5 + 0.5) * this.width, (-v.y * 0.5 + 0.5) * this.height, strength);
  }

  /** A comet streaks across the sky. */
  private comet(strength = 1) {
    const c = this.comets[this.cometNext];
    this.cometNext = (this.cometNext + 1) % MAX_COMETS;
    const fromLeft = Math.random() < 0.5;
    const x = (fromLeft ? -1 : 1) * (60 + Math.random() * 30);
    const y = 8 + Math.random() * 20;
    const speed = 70 + Math.random() * 50;
    c.vx = (fromLeft ? 1 : -1) * speed;
    c.vy = (Math.random() - 0.65) * 22;
    c.age = 0;
    c.life = 1.2 + Math.random() * 0.8;
    c.active = true;
    c.mesh.position.set(x, y, -78 - Math.random() * 14);
    c.mesh.rotation.set(0, 0, Math.atan2(c.vy, c.vx));
    c.mesh.scale.set(14 + 12 * strength, 0.5 + 0.3 * strength, 1);
    c.mat.color.copy(this.laneColor(Math.floor(Math.random() * 4))).lerp(this.white, 0.35 + this.fever * 0.2);
    c.mesh.visible = true;
  }

  /** The walls light up: the light stretches from the hit line to the far end, holds, then fades. */
  private lightWalls(strength: number, hold = 0.6) {
    if (this.wallLit < 0.15) this.wallReach = 0;
    this.wallLit = Math.min(1, Math.max(this.wallLit, 0.55 + strength * 0.45));
    this.wallHold = Math.max(this.wallHold, hold);
  }

  /**
   * A storm: the whole sky goes wild for a few seconds. Fireworks chain across it, comets streak
   * through, rings pulse out one after another, the ribbons whip and the columns leap.
   */
  frenzy(strength = 1) {
    this.storm = Math.max(this.storm, Math.min(1.2, strength));
    this.stormTick = 0;
    this.lightWalls(1, 1.8);
    this.pulse = 1;
    this.tellSky(0, SKY.y, SKY.z, 1.4 * strength);
  }

  /** Big moments light the whole sky: bursts either side and over the world, and rings. */
  private skyShow(color: THREE.Color, strength = 1) {
    if (this.clock - this.lastSkyBurst < 0.25) return;
    this.lastSkyBurst = this.clock;
    const n = Math.round(70 * strength);
    this.skyBurst(-24 - Math.random() * 10, 12 + Math.random() * 6, -62, this.laneColor(0), n);
    this.skyBurst(24 + Math.random() * 10, 12 + Math.random() * 6, -62, this.laneColor(3), n);
    this.skyBurst((Math.random() - 0.5) * 12, 20, -82, color, Math.round(n * 1.3));
    this.skyPulse(color, 0.75 * strength, 46, 1.9);
    this.skyPulse(this.white, 0.5 * strength, 34, 1.5, 0.12);
  }

  /** A tile slipped past or a hold was let go. */
  miss(lane: number) {
    this.emit(laneX(lane), 0.3, 0.2, 16, this.red, { speed: 2.5, up: 1.2, size: 1, grav: 12, white: 0, life: 0.8, drag: 2 });
    this.ring(laneX(lane), 0, this.red, 1.4, 0.3);
    this.shake = Math.max(this.shake, 0.45);
    this.missFx = 1;
  }

  /**
   * The run failed: the signal drops. Over FAIL_SECONDS the lanes go dark from the outside in,
   * each shedding its light as falling red sparks; the hit line and the world fade; the camera
   * sags. The caller keeps calling frame() (with a clock that slows to a stop) until it's over.
   */
  fail() {
    if (this.failK >= 0) return;
    this.failK = 0;
    this.laneDead = [false, false, false, false];
    this.feverTarget = 0;
    this.shake = 1;
    this.missFx = 1;
    this.ring(0, 0, this.red, 9, 0.9);
    this.ring(0, 0, this.red, 5, 0.7, 0.12);
    for (let l = 0; l < LANES; l++) this.flash[l] = 0;
  }
  /** Back to normal (a restart after a fail). */
  revive() {
    this.failK = -1;
    this.laneDead = [false, false, false, false];
    this.setExposure(1.2);
    this.layoutForMode();
    this.pads.forEach((p, l) => (p.uniforms.uColor.value as THREE.Color).copy(this.laneColors[l]));
    this.beamMats.forEach((m, l) => m.color.copy(this.laneColors[l]));
  }

  private stepFail(dt: number) {
    if (this.failK < 0) return;
    this.failK = Math.min(1, this.failK + dt / FAIL_SECONDS);
    const k = this.failK;
    // Outside lanes first, then the middle two.
    FAIL_ORDER.forEach((l, i) => {
      if (this.laneDead[l] || k < 0.08 + i * 0.1) return;
      this.laneDead[l] = true;
      this.emit(laneX(l), 0.4, -0.2, 26, this.red, { speed: 1.6, up: 2.2, size: 1.1, grav: 9, white: 0, life: 1.3, drag: 1.2 });
      this.emit(laneX(l), 0.3, -3, 12, this.laneColor(l), { speed: 1.2, up: 1.4, size: 0.8, grav: 7, white: 0, life: 1, drag: 1.5 });
      this.flare(laneX(l), 0.3, 0, this.red, 2.6, 0.45);
      this.shake = Math.max(this.shake, 0.35);
    });
    for (let l = 0; l < LANES; l++) {
      const pc = this.pads[l].uniforms.uColor.value as THREE.Color;
      pc.copy(this.laneColor(l)).lerp(this.red, Math.min(1, k * 2)).multiplyScalar(this.laneDead[l] ? 0.18 : 1 - k * 0.5);
      this.beamMats[l].opacity *= this.laneDead[l] ? 0 : 1 - k;
      if (this.laneDead[l]) { this.glow[l] = 0; this.press[l] = 0; }
    }
    const ease = k * k * (3 - 2 * k);
    this.setExposure(1.2 * (1 - 0.72 * ease));
    this.formMat.uniforms.uBright.value = (this.mode === 'play' ? 0.55 : 0.8) * (1 - 0.8 * ease);
    this.formMat.uniforms.uCalm.value = 1 - 0.6 * ease;
    this.highwayMat.uniforms.uMiss.value = Math.max(this.missFx, 0.55 * (1 - k));
    (this.hitLine.material as THREE.MeshBasicMaterial).opacity *= 1 - ease;
    this.beat *= 1 - ease;
  }

  /** Called every frame while a hold is down: light pours up and spirals off it. */
  holding(lane: number, dt: number) {
    const c = this.laneColor(lane);
    if (Math.random() < dt * 44) this.emit(laneX(lane), 0.2, 0, 2, c, { speed: 1.4, up: 3.4, size: 0.9, life: 0.9, grav: -1.2, drag: 1.5, spin: 3, white: 0.3 });
    if (Math.random() < dt * 2.2) this.glint(laneX(lane), 0.5, -0.1, c, { size: 0.7, vy: 2.2 });
    this.glow[lane] = Math.max(this.glow[lane], 0.75);
    this.flash[lane] = Math.max(this.flash[lane], 0.35);
  }

  /** A combo milestone: fountains of light on every lane, a wave across the glass, the world flares. */
  milestone(combo: number) {
    for (let k = 0; k < 3; k++) this.climb(0, 1, { gold: 1, delay: k * 2.6, width: 1.2, speed: 38 });
    // Fountains from both sides of the track (never across the lanes, so the tiles stay clear).
    for (const side of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const c = this.laneColor(side < 0 ? k : 3 - k);
        this.emit(side * EDGE, 0.2, -k * 2.5, 30, c, { speed: 2.4, up: 9, size: 1.4, life: 1.6, grav: 4, drag: 1.4, spin: side * 1.2, white: 0.3 });
      }
      this.flare(side * EDGE, 0.5, 0, this.laneColor(side < 0 ? 0 : 3), 3, 0.4);
    }
    this.ring(0, 0, this.white, 8, 0.9);
    this.ring(0, 0, this.laneColor(1), 11, 1.2, 0.1);
    const n = Math.min(14, 6 + Math.floor(combo / 25) * 2);
    for (let k = 0; k < n; k++) {
      const side = k % 2 ? 1 : -1;
      this.glint(side * EDGE, 0.7, -(k >> 1) * 1.2, this.laneColor(side < 0 ? 0 : 3), { size: 1.2, vx: side * (1.5 + Math.random() * 2), vy: 3.4, vz: -1, life: 1.6 });
    }
    this.kick = 1;
    this.pulse = 1;
    this.sweep = 0.001;
  }

  /** The song is over and the run cleared it: a finale on every lane (gold for a full combo). */
  clear(full: boolean) {
    this.milestone(100);
    this.frenzy(1.2);
    if (full) this.feverBurst();
    for (let k = 0; k < 4; k++) this.climb(0, 1.1, { gold: full ? 1 : 0.4, delay: k * 2.2, width: 1.4, speed: 40 });
  }

  /** Fever starts: the field turns gold with a ring of light across every lane. */
  private feverBurst() {
    for (const side of [-1, 1]) this.emit(side * EDGE, 0.2, -1, 56, this.gold, { speed: 3, up: 8, size: 1.3, life: 1.4, grav: 3, drag: 1.6, spin: side * 2, white: 0.4 });
    for (let l = 0; l < LANES; l++) this.ring(laneX(l), 0, this.gold, 4, 0.8, l * 0.05);
    this.ring(0, 0, this.white, 12, 1.1);
    this.pulse = 1;
    this.kick = 1;
    this.sweep = 0.001;
  }

  /** Live audio levels (0..1 per band), every frame: the stage breathes with the music. */
  setLevels(l: { bass: number; mid: number; high: number; level: number }) { this.levels = l; }

  /** A new section of the song: the world flows into a new form and light sweeps down the field. */
  section(force = false) {
    if (!force && this.clock - this.lastReform < 3) return;
    this.reform();
    this.sweep = 0.001;
    // A new section of the song: two bands climb to open it.
    for (let k = 0; k < 2; k++) this.climb(0, 0.8, { delay: k * 3, width: 1.3 });
    this.lastSongClimb = this.clock;
    this.skyPulse(this.laneColor(2), 0.7, 50, 2.2);
    this.skyBurst(0, 21, -84, this.laneColor(1), 60);
    this.lightWalls(0.8, 0.8);
    this.frenzy(0.55);
  }

  /** Flows the particle world into its next form. */
  reform() {
    const pos = this.formGeo.attributes.position as THREE.BufferAttribute;
    const tgt = this.formGeo.attributes.aTarget as THREE.BufferAttribute;
    const seeds = this.formGeo.attributes.aSeed as THREE.BufferAttribute;
    const A = pos.array as Float32Array, B = tgt.array as Float32Array, S = seeds.array as Float32Array;
    // Start from where every point is now (mid-flow too), then aim at the next form.
    for (let i = 0; i < WORLD_POINTS; i++) {
      const m = this.morph >= 1 ? 1 : Math.min(1, Math.max(0, this.morph * 1.6 - S[i] * 0.6));
      for (let j = 0; j < 3; j++) A[i * 3 + j] += (B[i * 3 + j] - A[i * 3 + j]) * m;
    }
    this.formIndex = (this.formIndex + 1) % FORMS.length;
    formPoints(FORMS[this.formIndex], B, this.formRand);
    pos.needsUpdate = true;
    tgt.needsUpdate = true;
    this.morph = 0;
    this.lastReform = this.clock;
  }

  /** A moment from the map's cues. */
  cue(kind: 'build' | 'drop' | 'break' | 'flash', strength = 1) {
    if (kind === 'drop') {
      for (let k = 0; k < 3; k++) this.climb(0, Math.min(1.2, 0.9 * strength), { delay: k * 2.6, width: 1.5, speed: 36 });
      this.lastSongClimb = this.clock;
      for (let l = 0; l < LANES; l++) {
        const c = this.laneColor(l);
        this.emit((l < 2 ? -1 : 1) * EDGE, 0.2, -1 - (l % 2) * 2.5, 30, c, { speed: 2.6, up: 10 * strength, size: 1.4, life: 1.5, grav: 4, drag: 1.4, spin: (l < 2 ? -1 : 1) * 1.5, white: 0.3 });
        this.ring(laneX(l), 0, c, 4.5, 0.75, l * 0.04);
        this.flash[l] = 1;
      }
      this.kick = 1;
      this.shake = Math.max(this.shake, 0.3);
      this.build = 0;
      this.calm = 0;
      this.pulse = 1;
      if (this.clock - this.lastReform > 4) this.reform();
      this.sweep = 0.001;
      this.skyShow(this.laneColor(1), Math.min(1.3, 0.8 + 0.4 * strength));
      if (strength >= 0.6) this.frenzy(Math.min(1, strength));
    } else if (kind === 'build') {
      this.build = 1;
    } else if (kind === 'flash') {
      for (let l = 0; l < LANES; l++) this.flash[l] = Math.max(this.flash[l], 0.7 * strength);
      this.beat = 1;
      this.pulse = Math.max(this.pulse, 0.6);
      // An impact in the song: the sky answers it.
      this.skyShow(this.laneColor(Math.floor(Math.random() * 4)), 0.8 * strength);
      this.lightWalls(0.8, 0.5);
    } else {
      this.build = 0;
      this.calm = 1;
    }
  }

  /** A beat of the song: pulses the glass and the world, nudges the camera, sends light up the walls. */
  onBeat(downbeat: boolean) {
    this.beat = downbeat ? 1 : 0.6;
    if (downbeat && Math.random() < 0.2) this.comet(0.6);
    if (downbeat) this.skyPulse(this.fever > 0.5 ? this.gold : this.laneColor(Math.floor(this.clock * 2) % 4), 0.22 + this.levels.bass * 0.35 + this.fever * 0.15, 30, 1.6);
    if (downbeat) this.kick = Math.max(this.kick, 0.3);
    // The climb answers accents only: a downbeat clearly louder than the recent music.
    const lv = this.levels.level;
    if (downbeat && lv > this.energyAvg * 1.3 + 0.06 && this.clock - this.lastSongClimb > 1.4) {
      this.lastSongClimb = this.clock;
      this.skyPulse(this.white, 0.35 + Math.min(0.4, (lv - this.energyAvg) * 2), 40, 1.6);
      this.skyBurst((Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 30), 10 + Math.random() * 14, -64, this.laneColor(Math.floor(Math.random() * 4)), 50);
      this.climb(0, Math.min(1, 0.45 + (lv - this.energyAvg) * 2), { width: 1.3 });
    }
  }

  /**
   * Sends a band of light climbing up the sides of the track, from the hit line to the far end.
   * side: -1 left wall, 1 right wall, 0 both. `delay` (in units of track) starts it behind the
   * hit line, so a volley arrives one band after another.
   */
  climb(side: -1 | 0 | 1, strength: number, { width = 1.3, gold = this.fever * 0.8, delay = 0, speed = 30 } = {}) {
    for (let w = 0; w < this.climbs.length; w++) {
      if (side !== 0 && (w === 0 ? -1 : 1) !== side) continue;
      const bands = this.climbs[w];
      // A free band, or the one furthest up the track.
      let pick = 0;
      for (let i = 0; i < bands.length; i++) {
        if (bands[i].y <= 0.002) { pick = i; break; }
        if (bands[i].x > bands[pick].x) pick = i;
      }
      bands[pick].set(-1 - delay, Math.min(1.6, strength), width, Math.min(1, gold));
      this.climbSpeed[w][pick] = speed * (0.9 + strength * 0.2);
    }
  }

  private stepClimbs(dt: number) {
    for (let w = 0; w < this.climbs.length; w++) {
      const bands = this.climbs[w], sp = this.climbSpeed[w];
      for (let i = 0; i < bands.length; i++) {
        const b = bands[i];
        if (b.y <= 0.002) continue;
        // Quick off the line, easing as it climbs; it fades as it reaches the far end.
        b.x += sp[i] * dt * (1.15 - Math.min(0.55, Math.max(0, b.x) / L));
        b.y *= Math.exp(-dt * 0.5);
        if (b.x > L + 2) b.y = 0;
      }
    }
  }

  setPressed(lane: number, down: boolean) {
    this.press[lane] = down ? 1 : 0;
    if (down) this.glow[lane] = Math.max(this.glow[lane], 0.35);
  }

  /** Dev tools: how many sparks are alive right now. */
  get particleCount() { return this.live; }

  /** An event for the backdrop the stage draws (profile C): beats, hits, hues, cues… */
  skyEvent(e: SceneEvent) { this.sky?.handle(e); }

  /** A baked burst on a pad (the Rive HitBurst's job when rive is 'baked'). */
  burst(lane: number, kind: BurstKind) { this.bursts?.hit(lane, kind); }
  /** The baked hold loop on a pad: starts, or ends with a bloom (ok) or a fizzle. */
  holdFx(lane: number, on: boolean, ok = true) {
    if (on) this.bursts?.holdStart(lane); else this.bursts?.holdEnd(lane, ok);
  }

  // ---------- projection helpers for DOM overlays and touch ----------
  /** Screen position (px, relative to the stage) of a lane's receptor. */
  receptor(lane: number): { x: number; y: number } {
    const v = this.tmpV.set(laneX(lane), 0.1, 0);
    this.world.localToWorld(v);
    v.project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height };
  }

  /** Which lane a screen x (relative to the stage) is over, judged at the hit line. */
  laneAt(x: number): number {
    const xs = [0, 1, 2, 3].map((l) => this.receptor(l).x);
    const half = (xs[1] - xs[0]) / 2;
    if (x < xs[0] - half * 1.6 || x > xs[3] + half * 1.6) return -1;
    let best = 0;
    for (let l = 1; l < 4; l++) if (Math.abs(x - xs[l]) < Math.abs(x - xs[best])) best = l;
    return best;
  }

  // ---------- per frame ----------
  /**
   * Draws the stage at song time `t` (seconds from beat 0).
   * play: pass the live game's notes. showcase: leave notes out and the ghost plays its chart.
   */
  frame(t: number, notes?: StageNote[]) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, Math.max(0, now - (this.lastT || now)));
    this.lastT = now;
    this.clock += dt;
    this.adaptStep(dt * 1000);

    let list = notes;
    let songT = t;
    if (!list) {
      // Ghost: loop the chart and hit everything on time (mostly perfect).
      // Before beat 0 (a lead-in) the ghost waits; after it, the chart loops.
      songT = t < 0 ? t : t % this.ghostLoop;
      if (songT < this.ghostPrev) for (const n of this.ghostNotes) { n.judged = undefined; n.holding = false; n.holdResult = undefined; }
      this.ghostPrev = songT;
      for (const n of this.ghostNotes) {
        if (!n.judged && songT >= n.time) {
          const r = Math.random();
          const kind: HitKind = r < 0.78 ? 'perfect' : r < 0.95 ? 'great' : 'good';
          n.judged = kind;
          this.hit(n.lane, kind);
          this.onGhostHit?.(n.lane, kind);
          if (n.hold) { n.holding = true; this.press[n.lane] = 1; }
          else { this.press[n.lane] = 1; this.releaseAt[n.lane] = songT + 0.08; }
        }
        if (n.holding) {
          this.holding(n.lane, dt);
          if (songT >= n.end) { n.holding = false; n.holdResult = 'done'; this.press[n.lane] = 0; }
        }
      }
      for (let l = 0; l < 4; l++) if (this.releaseAt[l] && songT >= this.releaseAt[l]) { this.press[l] = 0; this.releaseAt[l] = 0; }
      list = this.ghostNotes;
      // Without a song's sections to follow, the world still changes form now and then.
      if (this.clock - this.lastReform > 22) this.reform();
    }

    // Decays.
    const k = (rate: number) => Math.exp(-dt * rate);
    for (let l = 0; l < 4; l++) {
      this.flash[l] *= k(6);
      this.glow[l] = Math.max(this.press[l] * 0.3, this.glow[l] * k(3.5));
      const pu = this.pads[l].uniforms;
      pu.uPress.value += (this.press[l] - pu.uPress.value) * Math.min(1, dt * 20);
      pu.uFlash.value = this.flash[l];
      // A spring: pressing squashes the receptor, a hit kicks it out past its size and back.
      const target = 1 - this.press[l] * 0.12;
      this.padV[l] += (-220 * (this.padS[l] - target) - 16 * this.padV[l]) * dt;
      this.padS[l] += this.padV[l] * dt;
      this.padMeshes[l].scale.set(this.padS[l] * (1 + (this.padS[l] - 1) * 0.6), this.padS[l], 1);
      // Hits only: a bare key press lights the pad, not a beam.
      this.beamMats[l].opacity = this.flash[l] * 0.5;
      this.beams[l].scale.set(0.7 + this.flash[l] * 0.5, 0.5 + this.flash[l] * 0.7, 1);
    }
    this.beat = Math.max(this.beat * k(5), this.levels.bass * 0.8);
    this.energyAvg += (this.levels.level - this.energyAvg) * Math.min(1, dt * 0.6);
    this.build *= k(0.35);
    this.calm *= k(0.3);
    this.shake *= k(7);
    this.kick *= k(4);
    this.pulse *= k(2.2);
    this.missFx *= k(5);
    this.fever += (this.feverTarget - this.fever) * Math.min(1, dt * 2);
    if (this.sweep > 0) this.sweep = this.sweep >= 1 ? 0 : Math.min(1, this.sweep + dt * 0.9);
    if (this.morph < 1) this.morph = Math.min(1, this.morph + dt / 3.2);

    const u = this.highwayMat.uniforms;
    u.uTime.value = songT;
    u.uBeat.value = this.beat;
    u.uFever.value = Math.max(this.fever, this.build * 0.5);
    u.uGlow.value = this.glow;
    u.uSweep.value = this.sweep;
    u.uMiss.value = this.missFx;
    // The walls' light: stretches out (about a third of a second), holds, then fades; fever keeps it on.
    this.wallReach = Math.min(1, this.wallReach + dt * 3);
    if (this.wallHold > 0) this.wallHold -= dt; else this.wallLit *= k(1.4);
    const wallLit = this.wallLit;
    for (const w of this.wallMats) {
      w.uniforms.uBeat.value = this.beat; w.uniforms.uFever.value = this.fever;
      w.uniforms.uReach.value = this.wallReach; w.uniforms.uLit.value = wallLit;
    }
    this.stepClimbs(dt);
    this.tileMat.uniforms.uFever.value = this.fever;
    (this.hitLine.material as THREE.MeshBasicMaterial).opacity = 0.7 + this.beat * 0.3;
    this.hitLine.scale.y = 0.7 + this.beat * 0.3;

    const f = this.formMat.uniforms;
    f.uTime.value = this.clock;
    f.uMorph.value = this.morph;
    f.uBeat.value = this.beat;
    f.uBass.value = this.levels.bass;
    f.uHigh.value = this.levels.high;
    f.uPulse.value = this.pulse;
    f.uFever.value = this.fever;
    f.uSpin.value = 0.045 + this.fever * 0.12 + this.build * 0.08;
    f.uCalm.value = 1 - this.calm * 0.45;

    this.stepSky(dt);
    this.stepFail(dt);
    this.layoutNotes(list, songT);
    this.stepSparks(dt);
    this.stepDust(dt);
    this.stepGlints(dt);
    this.stepFlares(dt);
    this.stepRings(dt);
    this.stepShells(dt);
    this.placeCamera();
    this.sky?.update(dt);
    this.timer?.begin();
    const tDraw = performance.now();
    if (this.halfFx) {
      // Points are sized in pixels: half-size layers take half-size points.
      const scales = this.pointMats.map((m) => (m as THREE.ShaderMaterial).uniforms.uPointScale);
      const px = this.formMat.uniforms.uPx;
      const px0 = px.value;
      for (const sc of scales) sc.value = 0.5;
      px.value = px0 * 0.5;
      this.halfFx.render(this.renderer, this.scene, this.camera, this.drawUnder ?? undefined);
      for (const sc of scales) sc.value = 1;
      px.value = px0;
    }
    else {
      if (this.drawUnder) { this.renderer.clear(); this.drawUnder(); this.renderer.autoClear = false; }
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = true;
    }
    if (this.bursts) {
      // Over everything, where the Rive canvases sat: centred on the pads.
      this.bursts.update(now, [0, 1, 2, 3].map((l) => this.receptor(l)), this.width, this.height);
      this.bursts.render(this.renderer);
    }
    this.timer?.end();
    this.drawMs = performance.now() - tDraw;
  }

  /**
   * Perf profile "adaptive": while frames run long (the average over 1.3× the display's frame time
   * for half a second) the resolution steps down and bursts thin out; after four smooth seconds it
   * steps back up. Each change waits two seconds (resizing the buffer is a hitch of its own).
   */
  private adaptStep(ms: number) {
    const pf = perf();
    if (!pf.adaptive || ms <= 0 || ms > 250) return;
    const a = this.adapt;
    a.ema += (ms - a.ema) * 0.1;
    a.cool = Math.max(0, a.cool - ms);
    if (a.ema > refreshMs * 1.3) { a.slow += ms; a.fast = 0; } else if (a.ema < refreshMs * 1.1) { a.fast += ms; a.slow = 0; } else { a.slow = 0; a.fast = 0; }
    const max = Math.min(pf.dpr, this.deviceRatio), min = Math.min(max, pf.minDpr);
    let next = a.dpr;
    if (a.slow > 500 && a.cool <= 0 && a.dpr > min) next = Math.max(min, a.dpr - 0.2);
    else if (a.fast > 4000 && a.cool <= 0 && a.dpr < max) next = Math.min(max, a.dpr + 0.1);
    if (next === a.dpr) return;
    a.dpr = next; a.slow = 0; a.fast = 0; a.cool = 2000;
    a.fx = max > min ? 0.5 + 0.5 * ((next - min) / (max - min)) : 1;
    this.renderer.setPixelRatio(next);
    this.resize();
    stageInfo.dpr = next;
    stageInfo.fx = a.fx;
  }

  private layoutNotes(notes: StageNote[], t: number) {
    let h = 0, b = 0;
    const m = this.tmp;
    for (const n of notes) {
      const z0 = -(n.time - t) * this.speed;
      const z1 = -(n.end - t) * this.speed;
      if (z0 < -L - 1 && z1 < -L - 1) continue;
      if (n.hold) {
        if (n.holdResult === 'done') continue;
      } else if (n.judged && n.judged !== 'miss') continue;
      if (z1 > 4) continue;
      const missed = n.judged === 'miss' || n.holdResult === 'broken';
      const c = this.tmpColor.copy(this.laneColor(n.lane));
      if (missed) c.lerp(this.dim, 0.75);
      // Tiles brighten as they near the line.
      else c.lerp(this.white, Math.max(0, 1 + z0 / 6) * 0.25);
      const x = laneX(n.lane);
      if (n.hold && b < MAX_NOTES) {
        const start = n.holding ? 0 : Math.min(0, z0);
        const end = Math.max(z1, -L);
        const len = Math.max(0, start - end);
        if (len > 0.01) {
          // The bar rises out of the glass the way its tile does, so the two meet at every distance:
          // it starts under the tile and slopes up with the track toward its far end.
          const y0 = 0.06 + Math.min(1, Math.max(0, -start / L)) * 0.6;
          const y1 = 0.06 + Math.min(1, Math.max(0, -end / L)) * 0.6;
          m.position.set(x, y0, start);
          m.rotation.set(Math.atan2(y1 - y0, len), 0, 0);
          m.scale.set(n.holding ? 1.35 : 1, 1, Math.hypot(len, y1 - y0));
          m.updateMatrix();
          this.bodies.setMatrixAt(b, m.matrix);
          this.bodies.setColorAt(b, c);
          b++;
        }
        if (n.holding) continue;
      }
      if (z0 > 3 || h >= MAX_NOTES) continue;
      // Tiles rise out of the glass far away and settle flat as they approach.
      const far = Math.min(1, Math.max(0, -z0 / L));
      m.position.set(x, 0.14 + far * 0.6, z0);
      m.rotation.set(-far * 0.45, 0, 0);
      // Pops into being at the far end (with an overshoot), and bounces on the beat.
      const appear = Math.min(1, Math.max(0, (L + 1 + z0) / (L * 0.1)));
      const sc = (missed ? 0.88 : 1) * backOut(appear) * (1 + this.beat * 0.07);
      m.scale.set(sc, sc * (1 + this.beat * 0.12), sc);
      m.updateMatrix();
      this.heads.setMatrixAt(h, m.matrix);
      this.heads.setColorAt(h, c);
      m.position.y = 0.02;
      m.rotation.set(0, 0, 0);
      m.scale.set(1, 1, 1);
      m.updateMatrix();
      this.headGlow.setMatrixAt(h, m.matrix);
      this.headGlow.setColorAt(h, missed ? c : this.tmpColor.copy(this.laneColor(n.lane)).multiplyScalar(0.85));
      h++;
    }
    this.heads.count = h;
    this.headGlow.count = h;
    this.bodies.count = b;
    for (const im of [this.heads, this.headGlow, this.bodies]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  private stepSky(dt: number) {
    const lv = this.levels;
    // A storm: a chain of fireworks, comets and rings while it lasts, fading over a few seconds.
    if (this.storm > 0.02) {
      this.storm *= Math.exp(-dt * 0.45);
      this.stormTick -= dt;
      if (this.stormTick <= 0 && this.storm > 0.25) {
        this.stormTick = 0.11 + Math.random() * 0.1;
        const side = Math.random() < 0.5 ? -1 : 1;
        const col = Math.random() < 0.25 ? this.white : this.fever > 0.5 && Math.random() < 0.5 ? this.gold : this.laneColor(Math.floor(Math.random() * 4));
        this.skyBurst(side * (10 + Math.random() * 46), 7 + Math.random() * 22, -55 - Math.random() * 35, col, Math.round(40 + 45 * this.storm), 1.15 + this.storm * 0.55);
        this.comet(this.storm);
        if (Math.random() < 0.5) this.comet(this.storm);
        if (Math.random() < 0.55) this.skyPulse(Math.random() < 0.5 ? this.white : this.laneColor(Math.floor(Math.random() * 4)), 0.4 + 0.5 * this.storm, 36 + Math.random() * 24, 1.4);
        this.pulse = Math.max(this.pulse, 0.7 * this.storm);
      }
    } else this.storm = 0;
    // Now and then, a comet.
    this.nextComet -= dt;
    if (this.nextComet <= 0) { this.comet(0.5 + lv.level * 0.5); this.nextComet = 3 + Math.random() * 6; }
    for (const c of this.comets) {
      if (!c.active) continue;
      c.age += dt;
      if (c.age >= c.life) { c.active = false; c.mesh.visible = false; continue; }
      const k = c.age / c.life;
      c.mesh.position.x += c.vx * dt;
      c.mesh.position.y += c.vy * dt;
      c.mat.opacity = Math.min(1, k * 8) * (1 - k) * 0.85;
    }
    const st = this.storm;
    this.flow += dt * (0.35 + lv.level * 0.9 + this.fever * 0.8 + this.build * 0.6 + this.pulse * 0.5 + st * 2.6);
    const r = this.ribbonMat.uniforms;
    r.uTime.value = this.clock;
    r.uFlow.value = this.flow;
    r.uBass.value = lv.bass;
    r.uMid.value = lv.mid;
    r.uBeat.value = this.beat;
    r.uPulse.value = Math.max(this.pulse, st * 1.3);
    r.uFever.value = this.fever;
    // The world spins faster, swells and flares in a storm.
    this.formMat.uniforms.uSpin.value += st * 0.5;
    this.formMat.uniforms.uPulse.value = Math.max(this.formMat.uniforms.uPulse.value as number, st * 1.1);
    if (this.failK < 0) this.formMat.uniforms.uBright.value = (this.mode === 'play' ? 0.55 : 0.8) * (1 + st * 1.1);
    for (const s of this.skyRings) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age < 0) continue;
      if (s.age >= s.life) { s.active = false; s.mesh.visible = false; continue; }
      const k = s.age / s.life;
      s.mesh.scale.setScalar(2 + (1 - Math.pow(1 - k, 3)) * s.grow);
      s.mat.opacity = s.peak * (1 - k) * (1 - k) * Math.min(1, k * 12);
    }
    // Horizon columns: the middle ones follow the bass, the outer ones the highs, each with its own sway.
    for (let i = 0; i < this.pillars.length; i++) {
      const m = this.pillars[i];
      const f = m.userData.f as number;
      const d = Math.abs(f - 0.5) * 2;
      const wob = 0.5 + 0.5 * Math.sin(this.clock * (1.3 + f * 2.1) + f * 17);
      const target = 4 + 34 * (lv.bass * (1 - d) + lv.high * d * 1.3 + lv.mid * 0.4 * wob) + this.beat * 6 * wob + this.pulse * 14 + this.fever * 6 + st * (30 + 34 * wob);
      this.pillarH[i] += (target - this.pillarH[i]) * Math.min(1, dt * (target > this.pillarH[i] ? 14 : 3));
      m.scale.set(1 + this.pulse * 0.6, Math.max(0.5, this.pillarH[i]), 1);
      this.pillarMats[i].opacity = 0.06 + 0.3 * Math.min(1, this.pillarH[i] / 30) + this.pulse * 0.15;
    }
  }

  private stepSparks(dt: number) {
    const S = this.sp;
    let live = 0;
    for (let i = 0, cap = this.sparkCap; i < cap; i++) {
      if (S.age[i] >= S.life[i]) { if (S.alpha[i] !== 0) S.alpha[i] = 0; continue; }
      live++;
      S.age[i] += dt;
      const j = i * 3;
      const drag = Math.exp(-dt * S.drag[i]);
      S.vel[j] *= drag; S.vel[j + 2] *= drag;
      S.vel[j + 1] = S.vel[j + 1] * Math.exp(-dt * S.drag[i] * 0.5) - S.grav[i] * dt;
      if (S.spin[i] !== 0) {
        // Swirl around the vertical axis through where the burst started.
        const dx = S.pos[j] - S.cx[i], dz = S.pos[j + 2] - S.cz[i];
        S.vel[j] += -dz * S.spin[i] * dt * 3;
        S.vel[j + 2] += dx * S.spin[i] * dt * 3;
      }
      S.pos[j] += S.vel[j] * dt; S.pos[j + 1] += S.vel[j + 1] * dt; S.pos[j + 2] += S.vel[j + 2] * dt;
      if (S.pos[j + 1] < 0.02) { S.pos[j + 1] = 0.02; S.vel[j + 1] *= -0.3; }
      const k = S.age[i] / S.life[i];
      S.alpha[i] = (k < 0.06 ? k / 0.06 : 1) * Math.pow(1 - k, 1.6);
    }
    this.live = live;
    const g = this.sparkGeo;
    g.attributes.position.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    // Colours and sizes only change when sparks are born (lean profiles upload them only then).
    if (this.sparkDirty || !perf().lean3d) {
      g.attributes.aColor.needsUpdate = true;
      g.attributes.aSize.needsUpdate = true;
      this.sparkDirty = false;
    }
  }

  private stepDust(dt: number) {
    const p = this.dustGeo.attributes.position as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    const rise = 0.2 + this.beat * 1.0 + this.fever * 0.8 + this.levels.high * 1.4 + this.build * 1.5;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] += rise * dt;
      arr[i + 2] += this.speed * 0.12 * dt;
      if (arr[i + 1] > 9 || arr[i + 2] > 3) { arr[i + 1] = 0; arr[i + 2] = -L * Math.random(); }
    }
    p.needsUpdate = true;
  }

  private stepGlints(dt: number) {
    for (const g of this.glints) {
      if (!g.active) continue;
      g.age += dt;
      if (g.age >= g.life) { g.active = false; g.sprite.visible = false; continue; }
      const k = g.age / g.life;
      g.vy -= 0.8 * dt;
      g.vx *= Math.exp(-dt * 1.5);
      g.sprite.position.x += g.vx * dt;
      g.sprite.position.y += g.vy * dt;
      g.sprite.position.z += g.vz * dt;
      g.mat.rotation += g.spin * dt;
      // Pops in, twinkles, fades.
      const pop = k < 0.12 ? k / 0.12 : 1;
      const tw = 0.75 + 0.25 * Math.sin(g.age * 26);
      const s = g.size * (0.4 + 0.6 * pop) * tw * (1 - k * 0.4);
      g.sprite.scale.set(s, s, 1);
      g.mat.opacity = pop * (1 - k * k);
    }
  }

  private stepFlares(dt: number) {
    for (const f of this.flares) {
      if (!f.active) continue;
      f.age += dt;
      if (f.age >= f.life) { f.active = false; f.sprite.visible = false; continue; }
      const k = f.age / f.life;
      const s = f.size * (0.4 + 0.6 * (1 - Math.pow(1 - k, 3)));
      f.sprite.scale.set(s, s * 0.8, 1);
      f.mat.opacity = (1 - k) * (1 - k);
    }
  }

  private stepShells(dt: number) {
    for (const s of this.shells) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.life) { s.active = false; s.mesh.visible = false; continue; }
      const k = s.age / s.life;
      const e = 1 - Math.pow(1 - k, 3);
      s.mesh.scale.set(1 + e * (0.9 + s.big * 0.8), 1 + e * 0.6 - k * 0.9, 1 + e * (1.2 + s.big));
      s.mesh.position.y = 0.16 + e * 0.25;
      s.mat.opacity = (1 - k) * (1 - k) * (0.4 + s.big * 0.25);
    }
    for (const b of this.bars) {
      if (!b.active) continue;
      b.age += dt;
      if (b.age >= b.life) { b.active = false; b.mesh.visible = false; continue; }
      const k = b.age / b.life;
      b.mesh.scale.set(b.width * (0.9 + k * 0.2), 1, 0.6 + (1 - k) * 0.8);
      b.mat.opacity = (1 - k) * (1 - k);
    }
  }

  private stepRings(dt: number) {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.age += dt;
      if (r.age < 0) continue;
      if (r.age >= r.life) { r.active = false; r.mesh.visible = false; continue; }
      const k = r.age / r.life;
      const s = 0.6 + (1 - Math.pow(1 - k, 3)) * r.grow;
      r.mesh.scale.set(s, s, s);
      r.mat.opacity = (1 - k) * (1 - k) * 0.75;
    }
  }

  private placeCamera() {
    const shakeX = (Math.random() - 0.5) * this.shake * 0.22;
    const shakeY = (Math.random() - 0.5) * this.shake * 0.18;
    const back = (this.camera.userData.back as number) ?? 1;
    const bass = this.levels.bass;
    if (this.mode === 'play') {
      const sway = Math.sin(this.clock * 0.45) * 0.14 + Math.sin(this.clock * 0.17) * 0.08;
      this.camera.position.set(sway + shakeX, (4.3 + shakeY + Math.sin(this.clock * 0.3) * 0.06) * back, 6.4 * back - this.kick * 0.28 - this.build * 0.35);
      if (this.failK > 0) {
        // The signal drops: the camera sinks and tips forward, as if the stage lost its power.
        const f = 1 - Math.pow(1 - this.failK, 3);
        this.camera.position.y -= f * 1.1;
        this.camera.position.z += f * 0.8;
        this.camera.lookAt(sway * 0.4, -f * 1.4, -10);
      } else this.camera.lookAt(sway * 0.4, 0, -10);
      this.camera.fov = 52 - this.kick * 1.6 + bass * 0.6 + this.fever * 2;
    } else {
      // A broadcast angle: a little to the side and above, drifting slowly so it never sits still.
      const driftX = Math.sin(this.clock * 0.13) * 1.4;
      const driftY = Math.sin(this.clock * 0.21) * 0.35;
      this.rig.rotation.y = Math.sin(this.clock * 0.09) * 0.1;
      this.camera.position.set(driftX + shakeX, (3.9 + driftY + shakeY) * back, 6.2 * back - this.kick * 0.4);
      this.camera.lookAt(driftX * 0.3, 0.6, -12);
      this.camera.fov = 46 - this.kick * 1.4 + bass * 0.5 + this.fever * 1.5;
    }
    this.camera.updateProjectionMatrix();
  }
}
