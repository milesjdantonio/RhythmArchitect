// Soft effects at half resolution (perf profile option 3, `halfFx`).
//
// The stage's glows, sparks and world points are soft, so drawing them at half the resolution and
// adding them back costs a quarter of the pixels and looks the same. The scene is split into four
// layers (camera layers), drawn in the order the full scene draws them:
//   FAR    behind the glass: the world's points, ribbons, sky rings, comets, horizon pillars
//   SOLID  full resolution: the highway's glass, the walls, the hit line, the pads
//   NEAR   in front of the glass: sparks, dust, glints, flares, shells, chord bars, rings, beams,
//          the glow under each tile
//   TILES  full resolution, last: tiles and hold bodies draw over every effect
// FAR and NEAR go to their own half-size targets, then are added onto the screen in place.
//
// The targets are flagged like XR targets so three.js writes into them exactly what it would write
// to the screen (tone-mapped, sRGB-encoded); with the same additive blending, adding them back
// gives the same light as drawing straight to the screen.

import * as THREE from 'three';
import type { GpuKit } from './Stage3D';

export const LAYER = { solid: 0, far: 1, near: 2, tiles: 3 } as const;

const COMPOSITE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(uMap, vUv); }
`;

function target(gpu: boolean) {
  if (gpu) {
    // WebGPU: its materials tone-map and encode themselves (gpu.ts), so a plain target holds the
    // same values the screen would.
    const t = new THREE.RenderTarget(1, 1, { depthBuffer: false, type: THREE.UnsignedByteType });
    t.texture.generateMipmaps = false;
    t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
    return t as THREE.WebGLRenderTarget;
  }
  const rt = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, type: THREE.UnsignedByteType });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.generateMipmaps = false;
  rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
  // Written like the screen: tone mapping and sRGB output on (see the note above).
  (rt as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
  return rt;
}

export class HalfFx {
  /** The half-size targets (the stage builds its WebGPU pipelines for them up front). */
  get targets() { return [this.far, this.near]; }
  private far: THREE.WebGLRenderTarget;
  private near: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private orthoScene = new THREE.Scene();
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private clear = new THREE.Color();

  constructor(gpu?: GpuKit | null) {
    this.far = target(!!gpu);
    this.near = target(!!gpu);
    this.mat = gpu ? (gpu.composite({ uMap: { value: null } }) as unknown as THREE.ShaderMaterial) : new THREE.ShaderMaterial({
      vertexShader: COMPOSITE_VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      uniforms: { uMap: { value: null } },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.orthoScene.add(this.quad);
  }

  /** Puts the stage's objects on their layers. Everything not listed stays SOLID. */
  static assign(far: THREE.Object3D[], near: THREE.Object3D[], tiles: THREE.Object3D[], camera: THREE.Camera) {
    for (const o of far) o.layers.set(LAYER.far);
    for (const o of near) o.layers.set(LAYER.near);
    for (const o of tiles) o.layers.set(LAYER.tiles);
    camera.layers.enableAll();
  }

  /** Half the drawing buffer. */
  resize(renderer: THREE.WebGLRenderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.floor(size.x / 2)), h = Math.max(1, Math.floor(size.y / 2));
    this.far.setSize(w, h);
    this.near.setSize(w, h);
  }

  /**
   * Draws the scene: the far and near effects into their targets, then on the screen the
   * background (`under`: the sky, when the stage draws it), far, solid, near, tiles.
   */
  /** The sky adds the far layer in its own final pass (WebGPU), so this skips that composite. */
  skipFar = false;

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, under?: () => void) {
    const auto = renderer.autoClear;
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    renderer.autoClear = false;
    for (const [rt, layer] of [[this.far, LAYER.far], [this.near, LAYER.near]] as const) {
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      camera.layers.set(layer);
      renderer.render(scene, camera);
    }
    renderer.setRenderTarget(null);
    renderer.setClearColor(this.clear, alpha);
    renderer.clear();
    under?.();
    if (!this.skipFar) this.add(renderer, this.far);
    camera.layers.set(LAYER.solid);
    renderer.render(scene, camera);
    this.add(renderer, this.near);
    camera.layers.set(LAYER.tiles);
    renderer.render(scene, camera);
    camera.layers.enableAll();
    renderer.autoClear = auto;
  }

  private add(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget) {
    this.mat.uniforms.uMap.value = rt.texture;
    renderer.render(this.orthoScene, this.ortho);
  }

  dispose() {
    this.far.dispose();
    this.near.dispose();
    this.mat.dispose();
    this.quad.geometry.dispose();
  }
}
