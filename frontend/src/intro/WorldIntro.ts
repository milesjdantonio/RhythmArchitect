// The intro's world: a planet of light, full screen, in the spirit of Tetris Effect Connected's.
//
//   - The planet: ~12k points on a sphere, the continents (3D noise) bright and large, the oceans
//     faint; the far side dims. It assembles out of scattered points when the page loads.
//   - An atmosphere (a fresnel rim), a field of stars and two soft nebulae behind it.
//   - Three tilted orbit rings with beads of light running round them, and a spiral disk of
//     stars round the whole world that sweeps across the screen.
//   - Arcs: lines of light that rise from one point of the surface and land on another, a pulse
//     racing along each ("connected"). They fire on their own; the lane keys fire them in the
//     lane's colour and send a ripple of light across the planet.
//   - Ribbons of light flowing round the world, wider than the screen; dust streaming toward the
//     camera; nebulae in every corner. The whole screen moves.
//   - go(): the launch, after the click. A charge (CHARGE s): the world draws in and brightens,
//     the rings spin up, every arc fires. Then it bursts: a shockwave opens out of the planet,
//     the planet and its disk fly apart past the camera, the rings fling outward and the camera
//     dives through, rolling, while the title flies to the menu.
//
// Pooled: nothing is allocated per frame. Rendered on its own canvas, under the title. Kept to a
// steady frame rate: every shader is compiled up front (nothing compiles mid-launch), points that
// can't be seen aren't drawn, the shockwave only covers its own band, and if frames run slow the
// canvas drops to a lower resolution rather than stutter.

import * as THREE from 'three';
import { CHARGE_MS } from '../lib/entrance';

const PLANET = 12000;
const STARS = 2200;
const ARCS = 30;
const ARC_SEG = 64;
const RIPPLES = 4;
const RINGS = 3;
const BEADS = 7;
const DISK = 6000;
const RIBBONS = 6;
const RIB_SEG = 160;
const DUST = 1400;
/** The launch's charge, in seconds, before the world bursts (Intro.tsx starts the menu then). */
const CHARGE = CHARGE_MS / 1000;

// ---------- small helpers ----------
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
/** Smooth 3D value noise (a hash on the lattice, smoothstep between). */
function noise3(x: number, y: number, z: number) {
  const h = (i: number, j: number, k: number) => {
    let n = (i * 374761393 + j * 668265263 + k * 1440662683) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf), w = s(zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}
const fbm = (x: number, y: number, z: number) => noise3(x, y, z) * 0.55 + noise3(x * 2.1, y * 2.1, z * 2.1) * 0.3 + noise3(x * 4.3, y * 4.3, z * 4.3) * 0.15;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- shaders ----------
const PLANET_VERT = /* glsl */ `
  attribute vec3 aFrom;
  attribute float aLand;
  attribute float aSeed;
  uniform float uForm, uTime, uPx, uDive, uPull, uBurst;
  uniform vec4 uRipple[${RIPPLES}]; // xyz: where (on the unit sphere, model space), w: age (s); w < 0: off
  uniform vec3 uHueA, uHueB, uRippleCol[${RIPPLES}];
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    // Assemble: each point flies in from where it was scattered, a little later than the last.
    float k = clamp(uForm * 1.5 - aSeed * 0.5, 0.0, 1.0);
    k = k * k * (3.0 - 2.0 * k);
    vec3 p = mix(aFrom, position, k);
    // The surface breathes very slightly; land stands a touch proud.
    p *= 1.0 + aLand * 0.012 + 0.004 * sin(uTime * 1.3 + aSeed * 40.0);
    // The launch: drawn in by the charge, then flung out past the camera.
    p *= 1.0 - 0.09 * uPull + uBurst * (0.8 + aSeed * aSeed * 9.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec3 n = normalize(normalMatrix * position);
    float facing = smoothstep(-0.35, 0.45, n.z);
    // Ripples of light running across the surface from where a key was pressed.
    float wave = 0.0;
    vec3 waveCol = vec3(0.0);
    for (int i = 0; i < ${RIPPLES}; i++) {
      vec4 r = uRipple[i];
      if (r.w < 0.0) continue;
      float ang = acos(clamp(dot(normalize(position), r.xyz), -1.0, 1.0));
      float front = r.w * 1.6;
      float band = exp(-pow((ang - front) * 9.0, 2.0)) * exp(-r.w * 0.9);
      wave += band;
      waveCol += uRippleCol[i] * band;
    }
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 70.0);
    float size = mix(0.7, 3.0, aLand) * (0.8 + tw * 0.3) * (1.0 + wave * 1.4) * mix(3.2, 1.0, k) * (1.0 + uPull * 0.5 + uBurst * 0.7);
    gl_PointSize = min(8.0 * uPx, size * uPx * (8.0 / max(0.2, -mv.z)));
    gl_Position = projectionMatrix * mv;
    vec3 col = mix(uHueA, uHueB, smoothstep(-0.8, 0.9, position.y + (aSeed - 0.5) * 0.3));
    col = mix(col * 0.55, mix(col, vec3(1.0), 0.35), aLand);
    vColor = col + waveCol * 1.4 + vec3(uPull * 0.45 + uBurst * 0.3);
    // While they fly in, the points show as a swarm converging on the world.
    float flying = (1.0 - k) * step(0.001, uForm) * 0.85;
    float lit = mix(0.012, 0.95, aLand) * tw * (0.12 + 0.88 * facing) + wave * 0.8;
    // In the burst the land and some of the sea fly out as a storm of light.
    lit = mix(lit, (0.35 + 0.65 * aSeed) * max(aLand, step(0.7, aSeed)), min(1.0, uBurst * 3.0)) + uPull * 0.25 * aLand;
    vAlpha = (lit * k + flying * (0.3 + aSeed * 0.7)) * (1.0 - uDive) * smoothstep(0.0, 0.6, -mv.z);
    // Points too faint to see aren't drawn at all.
    if (vAlpha < 0.003) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
  }
`;
const POINT_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, a * a * vAlpha);
  }
`;
const ATMO_VERT = /* glsl */ `
  varying float vRim;
  void main() {
    vec3 n = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vRim = pow(1.0 - abs(dot(n, normalize(-mv.xyz))), 4.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const ATMO_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vRim;
  void main() { gl_FragColor = vec4(uColor, vRim * uAlpha); }
`;
const STAR_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime, uPx, uFade;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.5 + 0.5 * sin(uTime * (0.6 + aSeed * 2.4) + aSeed * 50.0);
    gl_PointSize = (0.8 + aSeed * 1.8) * uPx;
    gl_Position = projectionMatrix * mv;
    vColor = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.9, 0.95), aSeed);
    vAlpha = (0.25 + 0.75 * tw) * uFade;
  }
`;
const RIBBON_VERT = /* glsl */ `
  attribute float aT;
  attribute float aSide;
  attribute float aSeed;
  uniform float uTime, uForm, uDive;
  uniform vec3 uHueA, uHueB;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSide;
  void main() {
    float s = aSeed;
    float dir = s < 0.5 ? 1.0 : -1.0;
    float th = aT * 6.2832 + uTime * (0.05 + s * 0.06) * dir + s * 30.0;
    float R = 2.3 + 1.8 * s + 0.4 * sin(th * 2.0 + uTime * 0.3 + s * 9.0);
    vec3 p = vec3(cos(th) * R * 1.7, (s - 0.5) * 2.6 + 0.55 * sin(th * 1.6 + uTime * 0.4 + s * 13.0), sin(th) * R * 0.8 - 1.5);
    p.y += sin(aT * 26.0 - uTime * 1.8 + s * 20.0) * 0.08;
    p.y += aSide * (0.04 + 0.07 * s) * (1.0 + 0.4 * sin(aT * 9.0 + uTime));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p * (1.0 + uDive * 1.5), 1.0);
    float run = fract(aT * 1.3 - uTime * (0.08 + s * 0.07) * dir + s);
    float spark = exp(-pow((run - 0.5) * 12.0, 2.0));
    vColor = mix(uHueA, uHueB, fract(s * 2.7 + aT * 0.9)) + vec3(spark * 0.5);
    vAlpha = sin(aT * 3.14159) * (0.08 + 0.4 * spark) * clamp(uForm * 2.0 - 0.6, 0.0, 1.0) * (1.0 - uDive);
    vSide = aSide;
  }
`;
const RIBBON_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSide;
  void main() { float a = 1.0 - vSide * vSide; gl_FragColor = vec4(vColor, a * a * vAlpha); }
`;
const DUST_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uPx, uFade;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(9.0, (0.6 + aSeed * 1.6) * uPx * (6.0 / max(0.5, -mv.z)));
    gl_Position = projectionMatrix * mv;
    vColor = mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 0.85, 1.0), aSeed);
    vAlpha = uFade * smoothstep(-30.0, -12.0, position.z) * (1.0 - smoothstep(2.5, 4.5, position.z)) * (0.3 + 0.7 * aSeed);
  }
`;
const SHOCK_VERT = /* glsl */ `
  varying vec2 vP;
  void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// A band of light on a unit annulus (scaled to the ring's radius), uW wide.
const SHOCK_FRAG = /* glsl */ `
  uniform float uA, uW;
  uniform vec3 uColor;
  varying vec2 vP;
  void main() {
    float b = exp(-pow((length(vP) - 1.0) / uW, 2.0));
    // Alpha follows the light: the canvas is see-through, so a band of alpha 1 would black it out.
    gl_FragColor = vec4(uColor, min(1.0, b * uA));
  }
`;
const ARC_VERT = /* glsl */ `
  attribute float aU;
  varying float vU;
  void main() { vU = aU; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const ARC_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uHead, uAlpha;
  varying float vU;
  void main() {
    // A faint thread up to the head, a bright pulse at the head; it fades out once landed.
    float trail = smoothstep(uHead - 0.45, uHead, vU) * step(vU, uHead);
    float head = exp(-pow((vU - uHead) * 26.0, 2.0));
    float a = (trail * 0.35 + head * 1.6) * uAlpha;
    gl_FragColor = vec4(uColor + head * 0.6, a);
  }
`;

interface Arc { line: THREE.Line; mat: THREE.ShaderMaterial; pos: Float32Array; head: number; speed: number; life: number; active: boolean }
interface Ring { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; beads: THREE.Points; beadPos: Float32Array; radius: number; speed: number }

export class WorldIntro {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.05, 200);
  private world = new THREE.Group(); // the planet and everything round it (never follows the pointer)
  private planet: THREE.Points;
  private planetMat: THREE.ShaderMaterial;
  private atmo: THREE.ShaderMaterial;
  private stars: THREE.ShaderMaterial;
  private nebulae: THREE.Sprite[] = [];
  private arcs: Arc[] = [];
  private arcNext = 0;
  private rings: Ring[] = [];
  private disk: THREE.Points;
  private diskMat: THREE.ShaderMaterial;
  private ribbonMat: THREE.ShaderMaterial;
  private dust: THREE.Points;
  private dustMat: THREE.ShaderMaterial;
  private shockMats: THREE.ShaderMaterial[] = []; // the first ring, the second
  private shocks: THREE.Mesh[] = []; // [face, flat] for the first ring, then for the second
  private px = 1; // the canvas's pixel ratio (the governor lowers it if frames run slow)
  private slow = 0; // seconds of slow frames in a row
  private ft = 1 / 60; // recent frame time (s)
  private since = -1; // seconds since go(); -1 before
  private ripples: THREE.Vector4[] = [];
  private rippleCols: THREE.Color[] = [];
  private rippleNext = 0;
  private hues: THREE.Color[];
  private landPts: Float32Array; // land points (unit sphere), arcs start and end on them
  private clock = 0;
  private last = 0;
  private form = 0;
  private dive = -1; // -1: not diving; 0..1 while diving in
  private nextArc = 0.6;
  private burst = false;
  private width = 1;
  private height = 1;
  private target = { cx: 0.5, cy: 0.4, d: 0.4 }; // where the planet sits (fractions of the screen)
  private baseZ = 8;
  private raf = 0;
  private tmpV = new THREE.Vector3();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpM = new THREE.Vector3();

  constructor(host: HTMLElement, hues: [number, number] = [196, 272]) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(1.75, devicePixelRatio || 1));
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'intro-world-canvas';
    host.appendChild(this.canvas);
    this.scene.add(this.world);
    const rand = seeded(20261101);
    this.hues = [new THREE.Color().setHSL(hues[0] / 360, 0.95, 0.62), new THREE.Color().setHSL(hues[1] / 360, 0.95, 0.66), new THREE.Color().setHSL(((hues[0] + hues[1]) / 2) / 360, 0.95, 0.7), new THREE.Color(1, 0.85, 0.55)];
    const px = Math.min(1.75, devicePixelRatio || 1);

    // The planet.
    const pos = new Float32Array(PLANET * 3), from = new Float32Array(PLANET * 3), land = new Float32Array(PLANET), seed = new Float32Array(PLANET);
    const landList: number[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < PLANET; i++) {
      const y = 1 - (i / (PLANET - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      const nv = fbm(x * 1.6 + 7.3, y * 1.6 + 1.1, z * 1.6 - 4.2);
      const l = Math.min(1, Math.max(0, (nv - 0.53) * 16));
      land[i] = l;
      if (l > 0.7 && landList.length < 4000) landList.push(x, y, z);
      seed[i] = rand();
      // Scattered far out to start with, so the world gathers out of the dark.
      const a = rand() * Math.PI * 2, b = Math.acos(rand() * 2 - 1), d = 3 + rand() * 9;
      from[i * 3] = Math.sin(b) * Math.cos(a) * d; from[i * 3 + 1] = Math.cos(b) * d; from[i * 3 + 2] = Math.sin(b) * Math.sin(a) * d;
    }
    this.landPts = Float32Array.from(landList);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('aFrom', new THREE.BufferAttribute(from, 3));
    pg.setAttribute('aLand', new THREE.BufferAttribute(land, 1));
    pg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    for (let i = 0; i < RIPPLES; i++) { this.ripples.push(new THREE.Vector4(0, 1, 0, -1)); this.rippleCols.push(new THREE.Color()); }
    this.planetMat = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT, fragmentShader: POINT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uForm: { value: 0 }, uTime: { value: 0 }, uPx: { value: px }, uDive: { value: 0 }, uPull: { value: 0 }, uBurst: { value: 0 },
        uRipple: { value: this.ripples }, uRippleCol: { value: this.rippleCols },
        uHueA: { value: this.hues[0] }, uHueB: { value: this.hues[1] },
      },
    });
    this.planet = new THREE.Points(pg, this.planetMat);
    this.planet.frustumCulled = false;
    this.planet.rotation.z = 0.32;
    this.world.add(this.planet);

    // The atmosphere: a rim of light round the planet.
    this.atmo = new THREE.ShaderMaterial({
      vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      uniforms: { uColor: { value: this.hues[2].clone() }, uAlpha: { value: 0 } },
    });
    this.world.add(new THREE.Mesh(new THREE.SphereGeometry(1.1, 48, 32), this.atmo));

    // Stars.
    const sp = new Float32Array(STARS * 3), ss = new Float32Array(STARS);
    for (let i = 0; i < STARS; i++) {
      const a = rand() * Math.PI * 2, b = Math.acos(rand() * 2 - 1), d = 40 + rand() * 30;
      sp[i * 3] = Math.sin(b) * Math.cos(a) * d; sp[i * 3 + 1] = Math.cos(b) * d; sp[i * 3 + 2] = Math.sin(b) * Math.sin(a) * d;
      ss[i] = rand();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(ss, 1));
    this.stars = new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: POINT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uPx: { value: px }, uFade: { value: 0 } } });
    const starPts = new THREE.Points(sg, this.stars);
    starPts.frustumCulled = false;
    this.scene.add(starPts);

    // Nebulae: two soft clouds of the song's colours behind the world.
    const glow = glowTexture();
    for (const [i, x, y, s] of [[0, -3.4, 1.2, 9], [1, 3.2, -1.4, 11], [2, -6.5, -3.2, 12], [0, 6.8, 3.4, 13], [1, -1.5, 4.6, 10], [2, 2, -4.8, 12]] as const) {
      const mat = new THREE.SpriteMaterial({ map: glow, color: this.hues[i], transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, rotation: x * 0.3 });
      const n = new THREE.Sprite(mat);
      n.position.set(x, y, -12);
      n.scale.set(s, s * 0.7, 1);
      this.scene.add(n);
      this.nebulae.push(n);
    }

    // A spiral disk of stars round the whole world, nearly edge-on, so it sweeps across the screen.
    {
      const dp = new Float32Array(DISK * 3), df = new Float32Array(DISK * 3), dl = new Float32Array(DISK), ds = new Float32Array(DISK);
      for (let i = 0; i < DISK; i++) {
        const arm = i % 3;
        const r = 1.6 + Math.pow(rand(), 1.4) * 4.6;
        const a = (arm / 3) * Math.PI * 2 + r * 0.5 + (rand() - 0.5) * 0.7;
        dp[i * 3] = Math.cos(a) * r * 1.25; dp[i * 3 + 1] = (rand() - 0.5) * 0.08 * Math.sqrt(r); dp[i * 3 + 2] = Math.sin(a) * r;
        const b = rand() * Math.PI * 2, d = 6 + rand() * 10;
        df[i * 3] = Math.cos(b) * d; df[i * 3 + 1] = (rand() - 0.5) * d; df[i * 3 + 2] = Math.sin(b) * d;
        dl[i] = Math.min(1, Math.max(0, 1 - (r - 1.6) / 4.6)) * 0.75; // brighter near the world
        ds[i] = rand();
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
      dg.setAttribute('aFrom', new THREE.BufferAttribute(df, 3));
      dg.setAttribute('aLand', new THREE.BufferAttribute(dl, 1));
      dg.setAttribute('aSeed', new THREE.BufferAttribute(ds, 1));
      this.diskMat = new THREE.ShaderMaterial({
        vertexShader: PLANET_VERT.replace('float facing = smoothstep(-0.35, 0.45, n.z);', 'float facing = 1.0;'), fragmentShader: POINT_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: {
          uForm: { value: 0 }, uTime: { value: 0 }, uPx: { value: px * 0.8 }, uDive: { value: 0 }, uPull: { value: 0 }, uBurst: { value: 0 },
          uRipple: { value: this.ripples }, uRippleCol: { value: this.rippleCols },
          uHueA: { value: this.hues[1] }, uHueB: { value: this.hues[0] },
        },
      });
      this.disk = new THREE.Points(dg, this.diskMat);
      this.disk.frustumCulled = false;
      this.disk.rotation.set(0.42, 0, 0.14);
      this.world.add(this.disk);
    }

    // Ribbons of light flowing round the world, wider than the screen.
    {
      const verts = RIBBONS * (RIB_SEG + 1) * 2;
      const at = new Float32Array(verts), side = new Float32Array(verts), sd = new Float32Array(verts);
      const index: number[] = [];
      for (let r = 0; r < RIBBONS; r++) {
        const seedR = (r + 0.5) / RIBBONS;
        for (let k = 0; k <= RIB_SEG; k++) {
          const v = (r * (RIB_SEG + 1) + k) * 2;
          for (let e = 0; e < 2; e++) { at[v + e] = k / RIB_SEG; side[v + e] = e ? 1 : -1; sd[v + e] = seedR; }
          if (k < RIB_SEG) index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
      g.setAttribute('aT', new THREE.BufferAttribute(at, 1));
      g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
      g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
      g.setIndex(index);
      this.ribbonMat = new THREE.ShaderMaterial({
        vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uForm: { value: 0 }, uDive: { value: 0 }, uHueA: { value: this.hues[0] }, uHueB: { value: this.hues[1] } },
      });
      const ribbons = new THREE.Mesh(g, this.ribbonMat);
      ribbons.frustumCulled = false;
      this.world.add(ribbons);
    }
    // Dust streaming toward the camera, across the whole screen.
    {
      const p = new Float32Array(DUST * 3), sdd = new Float32Array(DUST);
      for (let i = 0; i < DUST; i++) { p[i * 3] = (rand() - 0.5) * 18; p[i * 3 + 1] = (rand() - 0.5) * 11; p[i * 3 + 2] = -30 + rand() * 34; sdd[i] = rand(); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aSeed', new THREE.BufferAttribute(sdd, 1));
      this.dustMat = new THREE.ShaderMaterial({ vertexShader: DUST_VERT, fragmentShader: POINT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPx: { value: px }, uFade: { value: 0 } } });
      this.dust = new THREE.Points(g, this.dustMat);
      this.dust.frustumCulled = false;
      this.scene.add(this.dust);
    }

    // The launch's shockwave: hidden until then.
    {
      const g = new THREE.RingGeometry(0.7, 1.3, 96, 1);
      for (const col of [this.hues[2], this.hues[0].clone().lerp(new THREE.Color(1, 1, 1), 0.4)]) {
        const mat = new THREE.ShaderMaterial({
          vertexShader: SHOCK_VERT, fragmentShader: SHOCK_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
          uniforms: { uA: { value: 0 }, uW: { value: 0.1 }, uColor: { value: col } },
        });
        this.shockMats.push(mat);
        const face = new THREE.Mesh(g, mat);
        this.scene.add(face);
        const flat = new THREE.Mesh(g, mat);
        flat.rotation.x = -Math.PI / 2; // lies in the disk's plane
        this.disk.add(flat);
        for (const m of [face, flat]) { m.visible = false; m.frustumCulled = false; m.renderOrder = 5; this.shocks.push(m); }
      }
    }

    // Orbit rings, tilted, with beads of light running round them.
    for (let r = 0; r < RINGS; r++) {
      const radius = [1.45, 1.75, 2.15][r];
      const mat = new THREE.MeshBasicMaterial({ color: this.hues[r % 3], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(radius - 0.004, radius + 0.004, 160), mat);
      mesh.rotation.set(Math.PI / 2 + [0.32, -0.22, 0.12][r], [0.2, -0.35, 0.5][r], 0);
      const beadPos = new Float32Array(BEADS * 3);
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(beadPos, 3).setUsage(THREE.DynamicDrawUsage));
      const bs = new Float32Array(BEADS).fill(0.5), bl = new Float32Array(BEADS).fill(1);
      bg.setAttribute('aSeed', new THREE.BufferAttribute(bs, 1));
      bg.setAttribute('aLand', new THREE.BufferAttribute(bl, 1));
      const beads = new THREE.Points(bg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, map: glow }));
      beads.frustumCulled = false;
      mesh.add(beads);
      this.world.add(mesh);
      this.rings.push({ mesh, mat, beads, beadPos, radius, speed: [0.35, -0.24, 0.16][r] });
    }

    // Arcs between points of the land.
    for (let i = 0; i < ARCS; i++) {
      const p = new Float32Array((ARC_SEG + 1) * 3), u = new Float32Array(ARC_SEG + 1);
      for (let k = 0; k <= ARC_SEG; k++) u[k] = k / ARC_SEG;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('aU', new THREE.BufferAttribute(u, 1));
      const mat = new THREE.ShaderMaterial({ vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color() }, uHead: { value: 0 }, uAlpha: { value: 0 } } });
      const line = new THREE.Line(g, mat);
      line.visible = false;
      line.frustumCulled = false;
      this.planet.add(line); // turns with the planet
      this.arcs.push({ line, mat, pos: p, head: 0, speed: 1, life: 0, active: false });
    }

    this.px = px;
    this.resize();
    // Compile every shader now, so nothing compiles (and stalls a frame) in the launch.
    const hidden = [...this.shocks, this.arcs[0].line];
    for (const o of hidden) o.visible = true;
    this.renderer.compile(this.scene, this.camera);
    for (const o of hidden) o.visible = false;
    this.last = performance.now();
  }

  /** Lower the canvas's resolution (points keep their size on screen). */
  private setPixelRatio(px: number) {
    this.px = px;
    this.renderer.setPixelRatio(px);
    this.planetMat.uniforms.uPx.value = px;
    this.diskMat.uniforms.uPx.value = px * 0.8;
    this.stars.uniforms.uPx.value = px;
    this.dustMat.uniforms.uPx.value = px;
    this.resize();
  }

  /** Where the planet sits on screen (fractions of the window) and how big (its diameter, as a fraction of the height). */
  place(cx: number, cy: number, d: number) {
    this.target = { cx, cy, d };
    this.resize();
  }

  resize() {
    this.width = Math.max(1, innerWidth);
    this.height = Math.max(1, innerHeight);
    this.renderer.setSize(this.width, this.height, false);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.camera.aspect = this.width / this.height;
    // The distance that makes the planet (radius 1) this tall on screen.
    this.baseZ = 1 / (Math.tan((this.camera.fov * Math.PI) / 360) * Math.max(0.15, this.target.d));
    // Shift the view so the planet's centre lands on its spot.
    this.camera.setViewOffset(this.width, this.height, this.width / 2 - this.target.cx * this.width, this.height / 2 - this.target.cy * this.height, this.width, this.height);
    this.camera.updateProjectionMatrix();
  }

  /** A lane key: a ripple across the planet and arcs in the lane's colour. */
  pulse(lane: number) {
    const col = this.hues[[0, 2, 1, 3][lane] ?? 0];
    // Start the ripple on the side facing the camera.
    const i = (Math.floor(Math.random() * (this.landPts.length / 3)) * 3);
    this.tmpV.set(this.landPts[i], this.landPts[i + 1], this.landPts[i + 2]);
    const r = this.ripples[this.rippleNext];
    r.set(this.tmpV.x, this.tmpV.y, this.tmpV.z, 0);
    this.rippleCols[this.rippleNext].copy(col);
    this.rippleNext = (this.rippleNext + 1) % RIPPLES;
    for (let k = 0; k < 3; k++) this.fireArc(col, i);
    const ring = this.rings[lane % RINGS];
    ring.mat.opacity = 0.9;
  }

  /** The launch (after the click): a charge, then the world bursts and the camera dives through. */
  go() {
    if (this.since >= 0) return;
    this.since = 0;
    // A volley of arcs (more follow, quicker and quicker, through the charge) and white ripples.
    for (let k = 0; k < 8; k++) this.fireArc(this.hues[k % 4], -1, 1.8 + Math.random() * 1.2);
    for (let r = 0; r < RIPPLES; r++) {
      const i = Math.floor(Math.random() * (this.landPts.length / 3)) * 3;
      this.ripples[r].set(this.landPts[i], this.landPts[i + 1], this.landPts[i + 2], r * 0.08);
      this.rippleCols[r].setRGB(0.9, 0.95, 1);
    }
    for (const ring of this.rings) ring.mat.opacity = 1;
  }

  private fireArc(color: THREE.Color, fromIdx = -1, speed = 0.7 + Math.random() * 0.5) {
    const a = this.arcs[this.arcNext];
    this.arcNext = (this.arcNext + 1) % ARCS;
    const L = this.landPts.length / 3;
    if (!L) return;
    const i = fromIdx >= 0 ? fromIdx : Math.floor(Math.random() * L) * 3;
    let j = Math.floor(Math.random() * L) * 3;
    this.tmpA.set(this.landPts[i], this.landPts[i + 1], this.landPts[i + 2]);
    // Land somewhere a good way round the globe (not right next door).
    for (let tries = 0; tries < 6; tries++) {
      this.tmpB.set(this.landPts[j], this.landPts[j + 1], this.landPts[j + 2]);
      if (this.tmpA.dot(this.tmpB) < 0.7) break;
      j = Math.floor(Math.random() * L) * 3;
    }
    const lift = 0.25 + (1 - this.tmpA.dot(this.tmpB)) * 0.35;
    for (let k = 0; k <= ARC_SEG; k++) {
      const t = k / ARC_SEG;
      // Along the great circle, lifted off the surface in the middle.
      this.tmpM.copy(this.tmpA).lerp(this.tmpB, t).normalize().multiplyScalar(1.005 + Math.sin(t * Math.PI) * lift);
      a.pos[k * 3] = this.tmpM.x; a.pos[k * 3 + 1] = this.tmpM.y; a.pos[k * 3 + 2] = this.tmpM.z;
    }
    (a.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    a.mat.uniforms.uColor.value.copy(color);
    a.head = 0;
    a.speed = speed;
    a.life = 0;
    a.active = true;
    a.line.visible = true;
  }

  frame() {
    const now = performance.now();
    const real = Math.min(0.25, (now - this.last) / 1000);
    const dt = Math.min(0.05, real);
    this.last = now;
    this.clock += dt;
    // The governor: if frames run slow for a while (after the first moments), drop the resolution
    // a step, down to 1x, so the motion stays smooth.
    this.ft += (real - this.ft) * 0.15;
    this.slow = this.ft > 1 / 48 && this.clock > 0.5 ? this.slow + real : 0;
    if (this.slow > 0.35 && this.px > 1) { this.setPixelRatio(Math.max(1, this.px - 0.375)); this.slow = 0; this.ft = 1 / 60; }
    this.form = Math.min(1, Math.max(0, (this.clock - 0.15) / 1.8));
    // The launch: charge (0..1, gone again just after the burst), burst (0..1, fast then slowing).
    let charge = 0, burst = 0;
    if (this.since >= 0) {
      this.since += real; // the launch keeps real time, in step with the title's flight
      const g = this.since;
      if (g < CHARGE) { const c = g / CHARGE; charge = c * c * (3 - 2 * c); }
      else {
        charge = Math.max(0, 1 - (g - CHARGE) / 0.12);
        const b = Math.min(1, (g - CHARGE) / 1.8);
        burst = 1 - Math.pow(1 - b, 2.2);
        if (this.dive < 0) this.dive = 0;
      }
    }
    const pu = this.planetMat.uniforms;
    pu.uTime.value = this.clock;
    pu.uForm.value = this.since >= 0 ? 1 : this.form;
    pu.uPull.value = charge;
    pu.uBurst.value = burst;
    for (const r of this.ripples) if (r.w >= 0) { r.w += dt; if (r.w > 2.4) r.w = -1; }
    this.stars.uniforms.uTime.value = this.clock;
    this.stars.uniforms.uFade.value = Math.min(1, this.clock / 1.6);
    // The rim glows up in the charge and is gone the moment the world bursts.
    this.atmo.uniforms.uAlpha.value = (Math.min(0.3, Math.max(0, this.form * 1.4 - 0.9)) + charge * 0.35) * Math.max(0, 1 - burst * 4);
    for (let i = 0; i < this.nebulae.length; i++) {
      const m = this.nebulae[i].material as THREE.SpriteMaterial;
      m.opacity = Math.min(0.3, this.clock / 5) * (0.75 + 0.25 * Math.sin(this.clock * 0.3 + i * 1.7)) * (this.dive >= 0 ? 1 - this.dive : 1);
      m.rotation += dt * 0.02 * (i % 2 ? 1 : -1);
    }

    // Turn (on its own; the pointer doesn't move the world).
    this.planet.rotation.y += dt * (0.09 + charge * 2.2 + burst * 0.6);
    this.disk.rotation.y += dt * (0.035 + charge * 1.4);
    const ru = this.ribbonMat.uniforms;
    ru.uTime.value = this.clock;
    ru.uForm.value = this.form;
    // Dust streams toward the camera (much faster in the dive), wrapping round; the charge pulls
    // it back in toward the world.
    {
      const pa = this.dust.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pa.array as Float32Array;
      const v = (1.4 - charge * 7 + (this.dive >= 0 ? this.dive * 40 : 0)) * dt;
      for (let i = 2; i < arr.length; i += 3) { arr[i] += v; if (arr[i] > 4.5) arr[i] -= 34; else if (arr[i] < -29.5) arr[i] += 34; }
      pa.needsUpdate = true;
      this.dustMat.uniforms.uFade.value = Math.min(1, this.clock / 2);
    }
    const du = this.diskMat.uniforms;
    du.uTime.value = this.clock;
    du.uForm.value = this.since >= 0 ? 1 : Math.max(0, this.form * 1.15 - 0.15);
    du.uPull.value = charge;
    du.uBurst.value = burst;
    const fly = Math.min(1, this.clock / 2.2);
    const flyE = 1 - Math.pow(1 - fly, 3);
    // In the launch the world rolls as the camera goes through.
    this.world.rotation.set((1 - flyE) * 0.35, -(1 - flyE) * 0.9, burst * burst * 0.9);

    // Rings: draw in once the world has formed, then glow back to rest after a flash.
    const ringIn = Math.max(0, this.form * 1.6 - 0.6);
    for (const r of this.rings) {
      const rest = 0.22 * ringIn;
      r.mat.opacity = this.since >= 0 ? Math.max(0, 1 - burst * 1.4) : Math.max(rest, r.mat.opacity - dt * 1.2);
      r.mesh.rotation.z += dt * r.speed * (0.2 + charge * 9);
      // Flung outward in the burst.
      r.mesh.scale.setScalar(1 - charge * 0.06 + burst * 3.5);
      for (let b = 0; b < BEADS; b++) {
        const a = this.clock * r.speed + (b / BEADS) * Math.PI * 2;
        r.beadPos[b * 3] = Math.cos(a) * r.radius; r.beadPos[b * 3 + 1] = Math.sin(a) * r.radius; r.beadPos[b * 3 + 2] = 0;
      }
      (r.beads.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (r.beads.material as THREE.PointsMaterial).opacity = (this.since >= 0 ? 1 - burst : ringIn) * 0.9;
    }

    // Arcs: one fires every so often on its own, once the world is there.
    if (this.form >= 1 && !this.burst && this.dive < 0) {
      this.burst = true;
      for (let k = 0; k < 10; k++) this.fireArc(this.hues[k % 3]);
      for (const r of this.rings) r.mat.opacity = 0.8;
    }
    if (this.form > 0.85 && this.dive < 0) {
      this.nextArc -= dt;
      if (this.nextArc <= 0) {
        const charging = this.since >= 0;
        this.fireArc(this.hues[Math.floor(Math.random() * (charging ? 4 : 3))], -1, charging ? 1.6 + charge * 1.4 : undefined);
        this.nextArc = charging ? 0.14 - charge * 0.1 : 0.25 + Math.random() * 0.7;
      }
    }
    for (const a of this.arcs) {
      if (!a.active) continue;
      a.head += dt * a.speed;
      a.life += dt;
      const fade = a.head > 1 ? Math.max(0, 1 - (a.head - 1) * 2.5) : 1;
      a.mat.uniforms.uHead.value = Math.min(a.head, 1.2);
      a.mat.uniforms.uAlpha.value = fade * Math.min(1, a.life * 6);
      if (fade <= 0) { a.active = false; a.line.visible = false; }
    }

    // The shockwave: two rings opening out of the world, the second a beat behind.
    if (this.since >= CHARGE) {
      const g = this.since - CHARGE;
      const a = Math.min(1, g / 1.4), b = Math.min(1, Math.max(0, (g - 0.15) / 1.6));
      const r1 = 1.05 + (1 - Math.pow(1 - a, 3)) * 17, r2 = 1.0 + (1 - Math.pow(1 - b, 2.4)) * 12;
      const u1 = this.shockMats[0].uniforms, u2 = this.shockMats[1].uniforms;
      u1.uA.value = Math.max(0, 1 - a) * Math.min(1, g * 12) * 1.6;
      u1.uW.value = (0.06 + r1 * 0.05) / r1;
      u2.uA.value = b > 0 ? Math.max(0, 1 - b) * 1.3 : 0;
      u2.uW.value = (0.04 + r2 * 0.035) / r2;
      for (let i = 0; i < 4; i++) {
        const m = this.shocks[i];
        m.scale.setScalar(i < 2 ? r1 : r2);
        m.visible = i < 2 ? a < 1 : b > 0 && b < 1;
      }
    }

    // The dive: the camera falls into the planet as everything fades.
    // The charge pulls the camera back a touch first.
    let z = this.baseZ * (1 + 2.4 * (1 - flyE)) * (1 + 0.07 * charge);
    if (this.dive >= 0) {
      this.dive = Math.min(1, this.dive + real / 1.9);
      const e = this.dive * this.dive * (3 - 2 * this.dive);
      z = this.baseZ * (1 + 2.4 * (1 - flyE)) * (1 - 0.88 * e);
      pu.uDive.value = Math.max(0, e * 1.6 - 0.6);
      du.uDive.value = e;
      ru.uDive.value = e;
    }
    this.camera.position.set(0, 0, z);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
    this.canvas.remove();
  }
}
