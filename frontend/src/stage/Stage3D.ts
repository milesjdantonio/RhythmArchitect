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
import { Bursts, type BurstKind } from './bursts';
import { HalfFx } from './halfFx';
import { SkyGL } from './sky';
import { FORMS, seeded, formPoints } from './forms';
import { MAX_CLIMB, HIGHWAY_VERT, HIGHWAY_FRAG, WALL_FRAG, PAD_FRAG, UV_VERT, TILE_VERT, TILE_FRAG, SPARK_VERT, SPARK_FRAG, WORLD_VERT, RIBBON_VERT, RIBBON_FRAG, WORLD_FRAG } from './shaders';
import { glowTexture, beamTexture, columnTexture, starTexture } from './textures';
import { watchLost } from './lost';
import type { SceneEvent } from '../background/scene';
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
const MAX_SPARKS = 5000;
/** The stage's pixel ratio cap. */
const MAX_DPR = 1.75;
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
  /** The pads' hit and hold bursts, baked from the Rive art (the game screen). */
  private bursts: Bursts | null = null;
  /** The WebGPU materials, when the stage draws with WebGPU (profile B). */
  private gpu: GpuKit | null = null;
  /** Resolves once the renderer can draw (WebGPU starts asynchronously). */
  ready: Promise<void> = Promise.resolve();
  /** Soft effects at half resolution (the game screen). */
  private halfFx: HalfFx | null = null;
  /** Drawn first, under everything (the sky, on the game screen). */
  drawUnder: (() => void) | null = null;
  /** The page's backdrop, drawn here (the game screen). */
  private sky: SkyGL | null = null;
  /** Sparks in the pool, and whether colours/sizes changed. */
  private sparkCap = MAX_SPARKS;
  private sparkDirty = true;
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
  /** Called once if the GPU is taken away; the stage draws nothing after that (build a new one). */
  onLost?: (why: string) => void;
  private width = 1;
  private height = 1;

  /**
   * `host`: the element the stage fills (its canvas is added to it), or, in a worker
   * a surface: an OffscreenCanvas and its size, kept up to date with setSurface.
   */
  constructor(private host: HTMLElement | StageSurface, opts: { mode: StageMode; hues?: [number, number]; gpu?: GpuKit }) {
    this.mode = opts.mode;
    // The game screen's stage is opaque, with its own sky, baked bursts and half-size light (composited
    // over the opaque sky). The menu's preview stays see-through (the backdrop shows behind it) and
    // has none of those layers.
    const play = opts.mode === 'play';
    const surface = 'canvas' in host && !('appendChild' in host) ? host : null;
    const K = (this.gpu = opts.gpu ?? null);
    // WebGPU (profile B) through gpu.ts, whose materials stand in for the GLSL ones in shaders.ts.
    this.renderer = K
      ? (K.makeRenderer(surface?.canvas ?? document.createElement('canvas'), { antialias: true, alpha: !play }) as unknown as THREE.WebGLRenderer)
      : new THREE.WebGLRenderer({ canvas: surface?.canvas, antialias: true, alpha: !play, powerPreference: 'high-performance' });
    this.ready = K ? (this.renderer as unknown as { init(): Promise<unknown> }).init().then(() => {}) : Promise.resolve();
    const Basic = THREE.MeshBasicMaterial, Spr = THREE.SpriteMaterial;
    const basicMat = (o: THREE.MeshBasicMaterialParameters) => (K ? K.basic(o) : new Basic(o));
    const spriteMat = (o: THREE.SpriteMaterialParameters) => (K ? K.sprite(o) : new Spr(o));
    this.renderer.setClearColor(play ? 0x02030a : 0x000000, play ? 1 : 0);
    this.renderer.setPixelRatio(Math.min(MAX_DPR, this.deviceRatio));
    if (!K) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.2;
    }
    this.canvas = this.renderer.domElement;
    // The GPU taken away (e.g. the window moved to another monitor's graphics adapter): tell the owner.
    this.offs.push(watchLost(this.renderer, this.canvas, (why) => this.onLost?.(why)));
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
      const w = K.world(formUniforms, formParams, { pos: this.formGeo.attributes.position as THREE.BufferAttribute, target: this.formGeo.attributes.aTarget as THREE.BufferAttribute, seed: this.formGeo.attributes.aSeed as THREE.BufferAttribute }, WORLD_POINTS);
      this.formMat = w.material as unknown as THREE.ShaderMaterial;
      this.form = w.object;
    } else {
      this.formMat = new THREE.ShaderMaterial({ vertexShader: WORLD_VERT, fragmentShader: WORLD_FRAG, ...formParams, uniforms: formUniforms });
      this.form = new THREE.Points(this.formGeo, this.formMat);
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
      const sp = K.points({ uPointScale: { value: 1 } }, pointParams, pointAttrs(sg), this.sparkCap, true);
      this.sparks = sp.object;
      sparkMat = sp.material;
    } else {
      sparkMat = new THREE.ShaderMaterial({ vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, ...pointParams, defines: { CULL_DEAD: 1 }, uniforms: { uPointScale: { value: 1 } } });
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
      const du = K.points({ uPointScale: { value: 1 } }, pointParams, pointAttrs(dg), DUST, false);
      this.dust = du.object;
      this.pointMats.push(du.material);
    } else {
      this.dust = new THREE.Points(dg, sparkMat);
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
    // Compile every shader now, while the song loads, not when the first tile or the first hit
    // draws (a compile can stall a frame for 100 ms or more).
    if (!K) this.renderer.compile(this.scene, this.camera);
    // WebGPU builds every pipeline before the song (see warmAsync), after the half-res layers exist.
    if (K) this.ready = this.ready.then(() => this.warmAsync()).catch(() => {});
    if (play) {
      this.bursts = new Bursts(undefined, K);
      this.sky = new SkyGL({ size: () => ({ w: this.width, h: this.height, dpr: this.deviceRatio }), levels: () => this.levels, half: true, gpu: K });
      this.sky.resize(this.renderer);
      // The song's colours were announced before the stage existed.
      this.sky.handle({ type: 'hues', hues: [...this.hues] as [number, number] });
      this.drawUnder = () => this.sky?.render(this.renderer);
    }
    if (play) {
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

  /**
   * Dev and tests only: takes the GPU away, as moving the window to another graphics adapter does
   * (WebGPU: the device destroyed and reported lost; WebGL: the context lost).
   */
  loseGpu() {
    const r = this.renderer as unknown as { backend?: { device?: { destroy(): void } }; onDeviceLost?: (i: object) => void; forceContextLoss?: () => void };
    if (this.gpu && r.backend?.device) {
      r.backend.device.destroy();
      r.onDeviceLost?.({ api: 'WebGPU', message: 'lost on purpose (dev)', reason: 'unknown' });
    } else r.forceContextLoss?.();
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
    // In time order, as the tile layout expects.
    this.ghostNotes = notes.map((n) => ({ ...n, judged: undefined, holding: false, holdResult: undefined })).sort((a, b) => a.time - b.time);
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
    // The pixel ratio can change too (a monitor with other scaling, browser zoom).
    this.renderer.setPixelRatio(Math.min(MAX_DPR, this.deviceRatio));
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
    if (this.live > 2600) n = Math.ceil(n * 0.5);
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

  /** An event for the backdrop the stage draws: beats, hits, hues, cues… */
  skyEvent(e: SceneEvent) { this.sky?.handle(e); }

  /** A baked burst on a pad. */
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
   * `from`: the first note that can still show (the ones before it have passed for good).
   */
  frame(t: number, notes?: StageNote[], from = 0) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, Math.max(0, now - (this.lastT || now)));
    this.lastT = now;
    this.clock += dt;

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
    this.layoutNotes(list, songT, notes ? from : 0);
    this.stepSparks(dt);
    this.stepDust(dt);
    this.stepGlints(dt);
    this.stepFlares(dt);
    this.stepRings(dt);
    this.stepShells(dt);
    this.placeCamera();
    this.sky?.update(dt);
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
  }

  /**
   * The tiles and hold bars on the track. Only the notes from `from` up to the far end of the
   * track are looked at: the notes are in time order, so the first one beyond it ends the walk.
   */
  private layoutNotes(notes: StageNote[], t: number, from = 0) {
    let h = 0, b = 0;
    const m = this.tmp;
    for (let i = Math.max(0, from); i < notes.length; i++) {
      const n = notes[i];
      const z0 = -(n.time - t) * this.speed;
      const z1 = -(n.end - t) * this.speed;
      // Beyond the far end of the track (its end too, as it ends after it starts): so is every later note.
      if (z0 < -L - 1) break;
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
    // Colours and sizes only change when sparks are born: they're uploaded only then.
    if (this.sparkDirty) {
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
