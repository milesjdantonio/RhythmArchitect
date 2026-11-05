// The hit and hold bursts on the pads: the Rive art (hit.riv, hold.riv), baked to sprite sheets by
// tools/rive/bake.mjs and drawn by the stage in one pass over the scene: 160 px squares centred on the
// pads, hold under hit. Five styles per judgement, picked at random (never the same twice in a
// row on a pad). Frames are baked at 30 fps and blended in between.

import * as THREE from 'three';
import type { GpuKit } from './Stage3D';

/** Bake settings, shared with the bake page. */
export const BAKE = { frame: 128, fps: 30, cols: 32 };
export interface BakeClip { start: number; count: number; loop: boolean }
export interface BakeSheet { rows: number; clips: Record<string, BakeClip> }
export type BurstKind = 'perfect' | 'great' | 'good' | 'miss';

const SIZE = 160; // CSS px, as .burst-anchor
const STYLES = 5;
const HOLD_LOOPS = ['charge', 'arcs', 'chevrons', 'orbit', 'beam'];

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// Two frames of the sheet, blended; premultiplied output (the sheet is uploaded premultiplied).
const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uGrid;   // columns, rows
  uniform float uA, uB, uMix, uAlpha;
  varying vec2 vUv;
  vec4 cell(float i) {
    vec2 c = vec2(mod(i, uGrid.x), floor(i / uGrid.x));
    return texture2D(uMap, vec2((c.x + vUv.x) / uGrid.x, 1.0 - (c.y + 1.0 - vUv.y) / uGrid.y));
  }
  void main() { gl_FragColor = mix(cell(uA), cell(uB), uMix) * uAlpha; }
`;

interface Slot { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; clip: BakeClip | null; start: number; last: number }

export class Bursts {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, 1, 0, -1, -1, 1);
  private sheets: Partial<Record<'hit' | 'hold', { tex: THREE.Texture; meta: BakeSheet }>> = {};
  private hits: Slot[] = [];
  private holds: Slot[] = [];
  private holding = [false, false, false, false];
  /** Ready once both sheets have loaded; until then nothing draws (the stage's sparks still do). */
  ready = false;

  /** `gpu`: the WebGPU materials (profile B), or WebGL's GLSL. */
  constructor(base = '/rive/baked', gpu?: GpuKit | null) {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE);
    const make = (order: number): Slot => {
      const params = {
        transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      };
      const uniforms = { uMap: { value: null }, uGrid: { value: new THREE.Vector2(BAKE.cols, 1) }, uA: { value: 0 }, uB: { value: 0 }, uMix: { value: 0 }, uAlpha: { value: 0 } };
      const mat = gpu
        ? (gpu.burst(uniforms, params) as unknown as THREE.ShaderMaterial)
        : new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, ...params, uniforms });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = order;
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      return { mesh, mat, clip: null, start: 0, last: -1 };
    };
    for (let l = 0; l < 4; l++) this.holds.push(make(0));
    for (let l = 0; l < 4; l++) this.hits.push(make(1));
    this.load(base, !!gpu);
  }

  private async load(base: string, gpu: boolean) {
    try {
      const manifest = (await (await fetch(`${base}/bursts.json`)).json()) as Record<'hit' | 'hold', BakeSheet>;
      for (const name of ['hit', 'hold'] as const) {
        // An ImageBitmap (works in a worker too), flipped and premultiplied as it's decoded.
        const blob = await (await fetch(`${base}/${name}.png`)).blob();
        const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'premultiply' });
        const tex = new THREE.Texture(bitmap as unknown as HTMLImageElement);
        tex.flipY = false;
        // The bitmap is already premultiplied. WebGL uploads it as it is; WebGPU converts it to what
        // this flag says, and "not premultiplied" would undo it (the glow's faint edges then fill
        // the whole square at full brightness).
        tex.premultiplyAlpha = gpu;
        tex.colorSpace = THREE.NoColorSpace; // drawn as the Rive canvas was: no conversion
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        this.sheets[name] = { tex, meta: manifest[name] };
        for (const s of name === 'hit' ? this.hits : this.holds) {
          s.mat.uniforms.uMap.value = tex;
          (s.mat.uniforms.uGrid.value as THREE.Vector2).set(BAKE.cols, manifest[name].rows);
        }
      }
      this.ready = true;
    } catch (e) {
      console.warn('Baked bursts unavailable', e);
    }
  }

  private pick(s: Slot) {
    let v = Math.floor(Math.random() * STYLES);
    if (v === s.last) v = (v + 1 + Math.floor(Math.random() * (STYLES - 1))) % STYLES;
    s.last = v;
    return v;
  }

  private play(s: Slot, sheet: 'hit' | 'hold', name: string, now: number) {
    const clip = this.sheets[sheet]?.meta.clips[name];
    if (!clip) return;
    s.clip = clip;
    s.start = now;
  }

  hit(lane: number, kind: BurstKind, now = performance.now() / 1000) {
    const s = this.hits[lane];
    if (!s) return;
    this.play(s, 'hit', kind === 'miss' ? 'miss' : `${kind}-${this.pick(s)}`, now);
  }

  holdStart(lane: number, now = performance.now() / 1000) {
    const s = this.holds[lane];
    if (!s) return;
    this.holding[lane] = true;
    this.play(s, 'hold', HOLD_LOOPS[this.pick(s)], now);
  }

  holdEnd(lane: number, ok: boolean, now = performance.now() / 1000) {
    const s = this.holds[lane];
    if (!s) return;
    this.holding[lane] = false;
    this.play(s, 'hold', ok ? 'done' : 'broken', now);
  }

  /** Places and steps the bursts. `pads`: the pads' screen positions (CSS px) in a W×H view. */
  update(now: number, pads: { x: number; y: number }[], W: number, H: number) {
    this.camera.right = W;
    this.camera.bottom = -H;
    this.camera.updateProjectionMatrix();
    for (const list of [this.holds, this.hits]) {
      for (let l = 0; l < list.length; l++) {
        const s = list[l];
        const c = s.clip;
        if (!c || !this.ready) { s.mesh.visible = false; continue; }
        const f = (now - s.start) * BAKE.fps;
        let a: number, b: number;
        if (c.loop) {
          a = Math.floor(f) % c.count;
          b = (a + 1) % c.count;
        } else {
          if (f >= c.count - 1) { s.clip = null; s.mesh.visible = false; continue; }
          a = Math.floor(f);
          b = Math.min(c.count - 1, a + 1);
        }
        const u = s.mat.uniforms;
        u.uA.value = c.start + a;
        u.uB.value = c.start + b;
        u.uMix.value = f - Math.floor(f);
        u.uAlpha.value = 1;
        const p = pads[l] ?? { x: 0, y: 0 };
        s.mesh.position.set(p.x, -p.y, 0);
        s.mesh.visible = true;
      }
    }
  }

  /** Draws over what the renderer already drew (no clear). */
  render(renderer: THREE.WebGLRenderer) {
    if (!this.ready) return;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }

  dispose() {
    for (const s of [...this.hits, ...this.holds]) s.mat.dispose();
    (this.hits[0]?.mesh.geometry as THREE.BufferGeometry | undefined)?.dispose();
    for (const sh of Object.values(this.sheets)) sh?.tex.dispose();
  }
}
