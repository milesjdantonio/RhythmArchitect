// The page's backdrop drawn inside the 3D stage (perf profile option 4, backdrop: 'stage').
//
// The same scene as the page's backdrop (background/scene.ts) runs here without canvases of its own
// (only its base layer, deep space, is painted, once per tint): each frame it simulates, hands over
// its shapes (SynthScene.shapes) and this draws them on the GPU, in the order the page stacks them:
//   base (deep space, zooming a touch on the beat) → sand (half size, with fading light trails) →
//   bloom (the song's colours, with the loudness) → ink (star streaks, beat rings, crystals,
//   ripples, flashes) → vignette, then dimmed for play as the page's CSS does.
// Lines are drawn as round-capped capsules and circles as thin rings, antialiased in the shader,
// with the canvas's colours and blending (additive "lighter" light, normal layering), so it
// looks like the page's backdrop. With halfFx it draws at half resolution, like the other light.

import * as THREE from 'three';
import type { Levels } from '../audio/engine';
import type { GpuKit } from './Stage3D';
import { SynthScene, emptyShapes, type SceneEvent, type SkyShapes } from '../background/scene';

const SAND_MAX = 4096;
const INK_MAX = 2048;
const CIRCLE_MAX = 64;
const CIRCLE_SEG = 128;

function hslRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

const SEG_VERT = /* glsl */ `
  attribute vec2 corner;      // x: 0..1 along, y: -1..1 across
  attribute vec4 aSeg;        // x0, y0, x1, y1 (CSS px, y down)
  attribute vec4 aColor;      // rgb, alpha
  attribute float aWidth;
  uniform float uPixel;       // CSS px per target pixel
  varying vec2 vP; varying vec2 vA; varying vec2 vB; varying float vR; varying vec4 vColor;
  void main() {
    vec2 a = aSeg.xy, b = aSeg.zw, d = b - a;
    float len = max(length(d), 1e-4);
    vec2 t = d / len, n = vec2(-t.y, t.x);
    float r = aWidth * 0.5 + uPixel;
    vec2 p = a + t * (corner.x * (len + 2.0 * r) - r) + n * corner.y * r;
    vP = p; vA = a; vB = b; vR = aWidth * 0.5; vColor = aColor;
    gl_Position = projectionMatrix * vec4(p.x, -p.y, 0.0, 1.0);
  }
`;
const SEG_FRAG = /* glsl */ `
  uniform float uPixel;
  varying vec2 vP; varying vec2 vA; varying vec2 vB; varying float vR; varying vec4 vColor;
  void main() {
    vec2 pa = vP - vA, ba = vB - vA;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    float dist = length(pa - ba * h);
    float cov = clamp((vR - dist) / uPixel + 0.5, 0.0, 1.0) * min(1.0, 2.0 * vR / uPixel);
    float a = vColor.a * cov;
    gl_FragColor = vec4(vColor.rgb * a, a);
  }
`;
const CIRCLE_VERT = /* glsl */ `
  attribute vec2 corner;      // x: angle (0..1), y: -1 inside, 1 outside
  attribute vec4 aCircle;     // x, y, radius, width
  attribute vec4 aColor;
  uniform float uPixel;
  varying float vOff; varying float vHalf; varying vec4 vColor;
  void main() {
    float ang = corner.x * 6.2831853;
    float off = corner.y * (aCircle.w * 0.5 + uPixel);
    vec2 p = aCircle.xy + vec2(cos(ang), sin(ang)) * max(0.0, aCircle.z + off);
    vOff = off; vHalf = aCircle.w * 0.5; vColor = aColor;
    gl_Position = projectionMatrix * vec4(p.x, -p.y, 0.0, 1.0);
  }
`;
const CIRCLE_FRAG = /* glsl */ `
  uniform float uPixel;
  varying float vOff; varying float vHalf; varying vec4 vColor;
  void main() {
    float cov = clamp((vHalf - abs(vOff)) / uPixel + 0.5, 0.0, 1.0) * min(1.0, 2.0 * vHalf / uPixel);
    float a = vColor.a * cov;
    gl_FragColor = vec4(vColor.rgb * a, a);
  }
`;
const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
// Deep space, zoomed about (50%, 45%) on the beat, as the page's base canvas.
const BASE_FRAG = /* glsl */ `
  uniform sampler2D uMap; uniform float uScale;
  varying vec2 vUv;
  void main() {
    vec2 o = vec2(0.5, 0.55); // 45% from the top, in uv (y up)
    gl_FragColor = vec4(texture2D(uMap, o + (vUv - o) / uScale).rgb, 1.0);
  }
`;
const COPY_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(uMap, vUv); }
`;
const FADE_FRAG = /* glsl */ `void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.3); }`;
// The bloom (.synth-bg__pulse): three soft ellipses of the song's colours on a box 120% of the view,
// scaled about its middle; first listed on top, as CSS layers backgrounds.
const PULSE_FRAG = /* glsl */ `
  uniform vec3 uA, uB, uC; uniform float uOpacity, uScale, uAspect;
  varying vec2 vUv;
  vec4 ellipse(vec2 p, vec2 c, vec2 r, vec3 col, float a) {
    float t = length((p - c) / r);
    float k = a * clamp(1.0 - t / 0.7, 0.0, 1.0);
    return vec4(col * k, k);
  }
  vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
  void main() {
    vec2 p = vec2(vUv.x, 1.0 - vUv.y);          // y down, as CSS
    p = (p + 0.1) / 1.2;                         // inset: -10%
    p = 0.5 + (p - 0.5) / uScale;
    vec4 c = ellipse(p, vec2(0.82, 0.18), vec2(0.6, 0.5), uC, 0.16);
    c = over(ellipse(p, vec2(0.2, 0.8), vec2(0.6, 0.5), uB, 0.18), c);
    c = over(ellipse(p, vec2(0.5, 0.52), vec2(0.45, 0.4), uA, 0.34), c);
    gl_FragColor = c * uOpacity;
  }
`;
// Washes: a miss's red flicker and a drop's flash of colour from the middle (additive).
const FLASH_FRAG = /* glsl */ `
  uniform float uMiss, uDrop; uniform vec3 uA, uB; uniform vec2 uSize;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * uSize;
    float t = clamp(length(p - uSize * 0.5) / (length(uSize) * 0.6), 0.0, 1.0);
    vec4 drop = mix(vec4(uA, 0.2), vec4(uB, 0.03), t) * uDrop;
    vec4 miss = vec4(1.0, 0.235, 0.353, 1.0) * uMiss;
    gl_FragColor = vec4(drop.rgb * drop.a + miss.rgb * miss.a, drop.a + miss.a);
  }
`;
const VIGNETTE_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float t = length((vUv - 0.5) / 0.70710678);  // farthest corner = 1
    float a = 0.6 * clamp((t - 0.6) / 0.4, 0.0, 1.0) * uOpacity;
    gl_FragColor = vec4(vec3(4.0, 2.0, 9.0) / 255.0 * a, a);
  }
`;
// Onto the screen: in play dimmed as the page's CSS does (brightness 0.72, saturate 1.15); on the
// menu (uDim 0) as it is.
const OUT_FRAG = /* glsl */ `
  uniform sampler2D uMap; uniform float uDim;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(uMap, vUv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(mix(c, max(vec3(0.0), mix(vec3(l), c, 1.15)) * 0.72, uDim), 1.0);
  }
`;

const ADD = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor };
const OVER = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };
// Double-sided: the y flip (CSS down, GL up) reverses the triangles' winding.
const common = { depthTest: false, depthWrite: false, transparent: true, side: THREE.DoubleSide };

const px = () => ({ uPixel: { value: 1 } });
const blankTexture = () => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t; };

function quadGlsl(frag: string, uniforms: Record<string, THREE.IUniform>, blend: object) {
  return new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, ...common, ...blend });
}

class Batch {
  readonly mesh: THREE.Mesh;
  readonly geo = new THREE.InstancedBufferGeometry();
  private attrs: THREE.InstancedBufferAttribute[];
  constructor(base: THREE.BufferGeometry, layout: [string, number][], max: number, mat: THREE.ShaderMaterial) {
    this.geo.index = base.index;
    this.geo.setAttribute('corner', base.getAttribute('corner'));
    this.attrs = layout.map(([name, size]) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size).setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(name, a);
      return a;
    });
    this.geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }
  /** Writes `count` instances from flat source rows via `fill(i, attributeArrays)`. */
  set(count: number, fill: (i: number, a: Float32Array[]) => void) {
    const arrays = this.attrs.map((a) => a.array as Float32Array);
    for (let i = 0; i < count; i++) fill(i, arrays);
    for (const a of this.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, count * a.itemSize); a.needsUpdate = true; }
    this.geo.instanceCount = count;
  }
}

function segmentBase() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('corner', new THREE.Float32BufferAttribute([0, -1, 1, -1, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
function circleBase() {
  const g = new THREE.BufferGeometry();
  const c: number[] = [], idx: number[] = [];
  for (let i = 0; i <= CIRCLE_SEG; i++) { c.push(i / CIRCLE_SEG, -1, i / CIRCLE_SEG, 1); if (i < CIRCLE_SEG) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); }
  g.setAttribute('corner', new THREE.Float32BufferAttribute(c, 2));
  g.setIndex(idx);
  return g;
}

/**
 * `playing`: whether a song is being played (the scene behaves a little differently); always,
 * inside the game's stage. `dim`: dimmed for play (the default), or as the menu shows it.
 */
export interface SkyEnv { size(): { w: number; h: number; dpr: number }; levels(): Levels; half: boolean; gpu?: GpuKit | null; playing?: () => boolean; dim?: boolean }

export class SkyGL {
  private sim: SynthScene;
  private shapes: SkyShapes = emptyShapes();
  private cam = new THREE.OrthographicCamera(0, 1, 0, -1, -1, 1);
  private sandRT: THREE.WebGLRenderTarget;
  private skyRT: THREE.WebGLRenderTarget;
  private baseTex: THREE.CanvasTexture;
  private baseVersion = -1;
  private sand: Batch; private ink: Batch; private circles: Batch;
  private sandScene = new THREE.Scene(); private skyScene = new THREE.Scene(); private outScene = new THREE.Scene();
  private fadeScene = new THREE.Scene();
  private segMat: THREE.ShaderMaterial; private inkMat: THREE.ShaderMaterial; private circleMat: THREE.ShaderMaterial;
  private baseMat: THREE.ShaderMaterial; private sandCopy: THREE.ShaderMaterial; private pulseMat: THREE.ShaderMaterial;
  private flashMat: THREE.ShaderMaterial; private vigMat: THREE.ShaderMaterial; private outMat: THREE.ShaderMaterial;
  private quadOrtho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private clear = new THREE.Color();

  constructor(private env: SkyEnv) {
    const G = env.gpu ?? null;
    // WebGPU takes plain render targets (WebGL's are WebGLRenderTargets).
    const rt = () => (G ? new THREE.RenderTarget(1, 1, { depthBuffer: false }) as THREE.WebGLRenderTarget : new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false }));
    this.sandRT = rt();
    this.skyRT = rt();
    // The same passes as GLSL or (profile B) TSL.
    const quadMat = (name: keyof GpuKit['skyFrag'], frag: string, uniforms: Record<string, THREE.IUniform>, blend: object) =>
      G ? (G.quad(uniforms, G.skyFrag[name], { ...common, ...blend }) as unknown as THREE.ShaderMaterial) : quadGlsl(frag, uniforms, blend);
    const segments = (vert: string, frag: string, kind: 'seg' | 'circle') =>
      G ? ((kind === 'seg' ? G.skySegments : G.skyCircles)(px(), { ...common, ...ADD }) as unknown as THREE.ShaderMaterial)
        : new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: px(), ...common, ...ADD });
    const canvas = (w: number, h: number) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
    const ctx = (c: OffscreenCanvas | HTMLCanvasElement) => c.getContext('2d') as CanvasRenderingContext2D;
    this.sim = new SynthScene({ base: ctx(canvas(1, 1)), sand: ctx(canvas(1, 1)), ink: ctx(canvas(1, 1)) }, {
      size: env.size, playing: env.playing ?? (() => true), levels: env.levels, calm: () => false, simOnly: true,
      raf: () => 0, cancelRaf: () => {}, layers: () => {},
    });
    for (const rt of [this.sandRT, this.skyRT]) { rt.texture.generateMipmaps = false; rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter; }
    this.baseTex = new THREE.CanvasTexture(this.sim.baseCanvas as HTMLCanvasElement);
    this.baseTex.colorSpace = THREE.NoColorSpace;
    this.baseTex.generateMipmaps = false;
    this.baseTex.minFilter = THREE.LinearFilter;

    this.segMat = segments(SEG_VERT, SEG_FRAG, 'seg');
    this.inkMat = segments(SEG_VERT, SEG_FRAG, 'seg');
    this.circleMat = segments(CIRCLE_VERT, CIRCLE_FRAG, 'circle');
    const seg = segmentBase();
    const layout: [string, number][] = [['aSeg', 4], ['aColor', 4], ['aWidth', 1]];
    this.sand = new Batch(seg, layout, SAND_MAX, this.segMat);
    this.ink = new Batch(seg, layout, INK_MAX, this.inkMat);
    this.circles = new Batch(circleBase(), [['aCircle', 4], ['aColor', 4]], CIRCLE_MAX, this.circleMat);

    this.baseMat = quadMat('base', BASE_FRAG, { uMap: { value: this.baseTex }, uScale: { value: 1 } }, { blending: THREE.NoBlending });
    this.sandCopy = quadMat('copy', COPY_FRAG, { uMap: { value: this.sandRT.texture } }, OVER);
    this.pulseMat = quadMat('pulse', PULSE_FRAG, { uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uC: { value: new THREE.Vector3() }, uOpacity: { value: 0 }, uScale: { value: 1 }, uAspect: { value: 1 } }, OVER);
    this.flashMat = quadMat('flash', FLASH_FRAG, { uMiss: { value: 0 }, uDrop: { value: 0 }, uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uSize: { value: new THREE.Vector2(1, 1) } }, ADD);
    this.vigMat = quadMat('vignette', VIGNETTE_FRAG, { uOpacity: { value: 1 } }, OVER);
    const dim = env.dim === false ? 0 : 1;
    this.outMat = quadMat('out', OUT_FRAG, { uMap: { value: this.skyRT.texture }, uDim: { value: dim } }, { blending: THREE.NoBlending });
    const fadeBlend = { blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };
    const fade = G ? quadMat('fade', FADE_FRAG, {}, fadeBlend) : new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: FADE_FRAG, ...common, ...fadeBlend });

    const quad = (m: THREE.Material, order: number) => { const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); q.frustumCulled = false; q.renderOrder = order; return q; };
    this.fadeScene.add(quad(fade, 0));
    this.sandScene.add(this.sand.mesh);
    // Quads use their own clip-space vertex shader, so one scene can mix them with the pixel-space batches.
    this.skyScene.add(quad(this.baseMat, 0), quad(this.sandCopy, 1), quad(this.pulseMat, 2));
    this.circles.mesh.renderOrder = 3; this.ink.mesh.renderOrder = 4;
    this.skyScene.add(this.circles.mesh, this.ink.mesh, quad(this.flashMat, 5), quad(this.vigMat, 6));
    if (G) {
      // WebGPU (profile B): fewer passes, same maths and order. The sand's fade goes in the sand's
      // own pass; base, sand and bloom are one pass; flashes, vignette, dimming and the far
      // effects are the final pass (Stage3D skips its own far composite).
      this.composeMat = G.quad({
        uMap: { value: this.baseTex }, uScale: { value: 1 }, uSand: { value: this.sandRT.texture },
        uPA: { value: new THREE.Vector3() }, uPB: { value: new THREE.Vector3() }, uPC: { value: new THREE.Vector3() }, uPOpacity: { value: 0 }, uPScale: { value: 1 },
      }, G.skyFrag.compose, { ...common, blending: THREE.NoBlending }) as unknown as THREE.ShaderMaterial;
      this.finalMat = G.quad({
        uMap: { value: this.skyRT.texture }, uFA: { value: new THREE.Vector3() }, uFB: { value: new THREE.Vector3() }, uSize: { value: new THREE.Vector2(1, 1) },
        uDrop: { value: 0 }, uMiss: { value: 0 }, uVig: { value: 1 }, uDim: { value: dim }, uHasFar: { value: 0 },
        // Until the stage hands over its far effects (never, on the menu): a black pixel.
        uFar: { value: blankTexture() },
      }, G.skyFrag.final, { ...common, blending: THREE.NoBlending }) as unknown as THREE.ShaderMaterial;
      this.fadeScene.clear();
      this.sandScene.add(quad(fade, -1));
      this.skyScene.clear();
      this.skyScene.add(quad(this.composeMat, 0), this.circles.mesh, this.ink.mesh);
      this.outScene.clear();
      this.outScene.add(quad(this.finalMat, 0));
    } else this.outScene.add(quad(this.outMat, 0));
  }

  /** WebGPU merged passes (null on WebGL). */
  private composeMat: THREE.ShaderMaterial | null = null;
  private finalMat: THREE.ShaderMaterial | null = null;
  /** WebGPU: the half-size far effects, added in the final pass. */
  setFar(tex: THREE.Texture) {
    if (!this.finalMat) return false;
    this.finalMat.uniforms.uFar.value = tex;
    this.finalMat.uniforms.uHasFar.value = 1;
    return true;
  }

  handle(e: SceneEvent) { this.sim.handle(e); }

  /** After the stage resized: the scene's size, and the targets (sky at half size with halfFx). */
  resize(renderer: THREE.WebGLRenderer) {
    this.sim.resize();
    const { w, h } = this.env.size();
    this.cam.right = w; this.cam.bottom = -h; this.cam.updateProjectionMatrix();
    this.sandRT.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.skyRT.setSize(Math.max(1, Math.floor(buf.x / (this.env.half ? 2 : 1))), Math.max(1, Math.floor(buf.y / (this.env.half ? 2 : 1))));
  }

  update(dt: number) { this.sim.simulate(dt); }

  /**
   * WebGPU: builds and draws every pass once before the song. The rings and crystals only appear
   * with the first beat or hit, and their first draw (pipelines, buffers) would cost a frame or
   * more right in the count-in. One instance each, all zeros: invisible.
   */
  async warmAsync(renderer: THREE.WebGLRenderer) {
    const r = renderer as unknown as { compileAsync(s: THREE.Object3D, c: THREE.Camera): Promise<void> };
    const batches = [this.sand, this.ink, this.circles];
    const counts = batches.map((b) => b.geo.instanceCount);
    for (const b of batches) b.geo.instanceCount = Math.max(1, b.geo.instanceCount);
    try {
      for (const [target, scenes] of [[this.sandRT, [[this.sandScene, this.cam]]], [this.skyRT, [[this.skyScene, this.cam]]], [null, [[this.outScene, this.quadOrtho]]]] as const) {
        renderer.setRenderTarget(target);
        for (const [scene, camera] of scenes) { await r.compileAsync(scene, camera); renderer.render(scene, camera); }
      }
    } finally {
      renderer.setRenderTarget(null);
      batches.forEach((b, i) => { b.geo.instanceCount = counts[i]; });
    }
  }

  /** Draws the sky onto the current screen (call with the screen as the target, before the scene). */
  render(renderer: THREE.WebGLRenderer) {
    const S = this.shapes;
    this.sim.shapes(S);
    if (this.sim.baseVersion !== this.baseVersion) { this.baseVersion = this.sim.baseVersion; this.baseTex.needsUpdate = true; }
    const { w } = S;
    const fill = (src: number[], n: number) => (i: number, [seg, col, wid]: Float32Array[]) => {
      const o = i * n;
      seg[i * 4] = src[o]; seg[i * 4 + 1] = src[o + 1]; seg[i * 4 + 2] = src[o + 2]; seg[i * 4 + 3] = src[o + 3];
      wid[i] = src[o + 4];
      const [r, g, b] = hslRgb(src[o + 5], src[o + 6], src[o + 7]);
      col[i * 4] = r; col[i * 4 + 1] = g; col[i * 4 + 2] = b; col[i * 4 + 3] = src[o + 8];
    };
    this.sand.set(Math.min(SAND_MAX, S.sand.length / 9), fill(S.sand, 9));
    this.ink.set(Math.min(INK_MAX, S.ink.length / 9), fill(S.ink, 9));
    this.circles.set(Math.min(CIRCLE_MAX, S.circles.length / 8), (i, [cir, col]) => {
      const o = i * 8;
      cir[i * 4] = S.circles[o]; cir[i * 4 + 1] = S.circles[o + 1]; cir[i * 4 + 2] = S.circles[o + 2]; cir[i * 4 + 3] = S.circles[o + 3];
      const [r, g, b] = hslRgb(S.circles[o + 4], S.circles[o + 5], S.circles[o + 6]);
      col[i * 4] = r; col[i * 4 + 1] = g; col[i * 4 + 2] = b; col[i * 4 + 3] = S.circles[o + 7];
    });
    this.segMat.uniforms.uPixel.value = w / this.sandRT.width;
    const skyPx = w / this.skyRT.width;
    this.inkMat.uniforms.uPixel.value = skyPx;
    this.circleMat.uniforms.uPixel.value = skyPx;
    this.baseMat.uniforms.uScale.value = S.baseScale;
    const [hA, hB] = S.songHues;
    (this.pulseMat.uniforms.uA.value as THREE.Vector3).set(...hslRgb(hA, 100, 62));
    (this.pulseMat.uniforms.uB.value as THREE.Vector3).set(...hslRgb(hB, 100, 60));
    (this.pulseMat.uniforms.uC.value as THREE.Vector3).set(...hslRgb(hB, 100, 66));
    this.pulseMat.uniforms.uOpacity.value = S.pulse;
    this.pulseMat.uniforms.uScale.value = S.pulseScale;
    this.flashMat.uniforms.uMiss.value = S.missFlash;
    this.flashMat.uniforms.uDrop.value = S.dropFlash;
    (this.flashMat.uniforms.uA.value as THREE.Vector3).set(...hslRgb(S.hues[0], 100, 70));
    (this.flashMat.uniforms.uB.value as THREE.Vector3).set(...hslRgb(S.hues[1], 100, 55));
    (this.flashMat.uniforms.uSize.value as THREE.Vector2).set(S.w, S.h);
    this.vigMat.uniforms.uOpacity.value = S.vignette;
    if (this.composeMat && this.finalMat) {
      const c = this.composeMat.uniforms, f = this.finalMat.uniforms;
      c.uScale.value = S.baseScale;
      (c.uPA.value as THREE.Vector3).copy(this.pulseMat.uniforms.uA.value as THREE.Vector3);
      (c.uPB.value as THREE.Vector3).copy(this.pulseMat.uniforms.uB.value as THREE.Vector3);
      (c.uPC.value as THREE.Vector3).copy(this.pulseMat.uniforms.uC.value as THREE.Vector3);
      c.uPOpacity.value = S.pulse;
      c.uPScale.value = S.pulseScale;
      (f.uFA.value as THREE.Vector3).copy(this.flashMat.uniforms.uA.value as THREE.Vector3);
      (f.uFB.value as THREE.Vector3).copy(this.flashMat.uniforms.uB.value as THREE.Vector3);
      (f.uSize.value as THREE.Vector2).set(S.w, S.h);
      f.uDrop.value = S.dropFlash;
      f.uMiss.value = S.missFlash;
      f.uVig.value = S.vignette;
    }

    const target = renderer.getRenderTarget();
    const auto = renderer.autoClear;
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    renderer.autoClear = false;
    // Sand: fade the trails, then the grains' new strokes.
    renderer.setRenderTarget(this.sandRT);
    if (!this.composeMat) renderer.render(this.fadeScene, this.quadOrtho); // WebGPU: the fade is in the sand's pass
    renderer.render(this.sandScene, this.cam);
    // The sky.
    renderer.setRenderTarget(this.skyRT);
    renderer.render(this.skyScene, this.cam);
    // Onto the stage.
    renderer.setRenderTarget(target);
    renderer.render(this.outScene, this.quadOrtho);
    renderer.autoClear = auto;
    renderer.setClearColor(this.clear, alpha);
  }

  dispose() {
    for (const rt of [this.sandRT, this.skyRT]) rt.dispose();
    this.baseTex.dispose();
    for (const m of [this.segMat, this.inkMat, this.circleMat, this.baseMat, this.sandCopy, this.pulseMat, this.flashMat, this.vigMat, this.outMat]) m.dispose();
  }
}
