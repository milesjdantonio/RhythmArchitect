// The stage on WebGPU (perf profile B, renderer: 'webgpu'). Loaded only by the stage worker when
// that profile asks for it, so the WebGL build never carries it.
//
// three.js's WebGPU renderer only draws node materials, so every stage shader is written again here
// in TSL, line for line with the GLSL in Stage3D.ts, sky.ts, bursts.ts and halfFx.ts. Each material
// keeps a `uniforms` record shaped like a ShaderMaterial's ({ uTime: { value } }) whose entries are
// bound to TSL uniforms, so the stage's own code drives either kind the same way.
//
// Colour: the WebGL stage tone-maps and sRGB-encodes in every fragment, and the light then adds up
// in the framebuffer. WebGPU's renderer would normally add light up linearly and tone-map once at the
// end, which changes how glows look. So here the renderer outputs as-is (no tone mapping, linear
// output) and each scene material tone-maps and encodes itself (`finish`), exactly as in WebGL; the
// sky, bursts and composites write raw values as their GLSL does. Points become instanced sprites
// (WebGPU has no sized points), sized in device pixels as gl_PointSize was.
//
// TSL's TypeScript types are loose for this kind of code; nodes are typed `N` (any) here.

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

// TSL's TypeScript types are too strict for shader code like this: used untyped here (see above).
const {
  Fn, uniform, uniformArray, attribute, instancedBufferAttribute, texture, uv, vec2, vec3, vec4, float,
  sin, cos, mix, smoothstep, clamp, abs, fract, floor, exp, pow, length, dot, normalize, select, Loop,
  positionGeometry, normalView, positionViewDirection, modelViewMatrix, cameraProjectionMatrix, screenDPR,
  screenUV, acesFilmicToneMapping, sRGBTransferOETF, varying, min, max, step, output,
} = TSL as any;

type N = any;
type Uniforms = Record<string, { value: any }>;
export type GpuMaterial = THREE.NodeMaterial & { uniforms: Uniforms };

const sq = (x: N) => x.mul(x);

/** The tone mapping exposure (the WebGL stage's toneMappingExposure: 1.2, dimmed when a run fails). */
export const exposure: { value: number } = uniform(1.2);

/** Tone mapping and sRGB in the fragment, as the GLSL includes do. */
const finish = (c: N) => vec4(sRGBTransferOETF(acesFilmicToneMapping(c.rgb, exposure)), c.a);

/**
 * Binds a ShaderMaterial-style uniforms record to TSL uniforms. Each entry's `value` reads and
 * writes the node (colours and vectors are the same objects, so changing them in place works).
 */
function bind(u: Uniforms): Record<string, N> {
  const nodes: Record<string, N> = {};
  for (const k of Object.keys(u)) {
    const v = u[k].value;
    let node: N;
    if (Array.isArray(v)) node = uniformArray(v, typeof v[0] === 'number' ? 'float' : 'vec4');
    else if (v === null || (v as THREE.Texture)?.isTexture) node = texture((v as THREE.Texture) ?? new THREE.Texture());
    else node = uniform(v);
    nodes[k] = node;
    const isArray = Array.isArray(v);
    u[k] = {
      get value() { return isArray ? node.array : node.value; },
      set value(x: any) { if (isArray) node.array = x; else node.value = x; },
    };
  }
  return nodes;
}

function material(base: THREE.NodeMaterial, u: Uniforms, params: THREE.MaterialParameters = {}): GpuMaterial {
  base.setValues(params);
  return Object.assign(base, { uniforms: u });
}

/** The renderer: as-is output (each material tone-maps and encodes itself; see the note above). */
export function makeRenderer(canvas: OffscreenCanvas | HTMLCanvasElement, opts: { antialias: boolean; alpha: boolean }) {
  const r = new THREE.WebGPURenderer({ canvas: canvas as HTMLCanvasElement, antialias: opts.antialias, alpha: opts.alpha, powerPreference: 'high-performance' });
  r.toneMapping = THREE.NoToneMapping;
  r.outputColorSpace = THREE.LinearSRGBColorSpace;
  return r;
}

/** MeshBasicMaterial, finished like the WebGL stage's (tone-mapped, sRGB). */
export function basic(params: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicNodeMaterial(params);
  m.outputNode = finish(output);
  return m as unknown as THREE.MeshBasicMaterial;
}
export function sprite(params: THREE.SpriteMaterialParameters): THREE.SpriteMaterial {
  const m = new THREE.SpriteNodeMaterial(params);
  m.outputNode = finish(output);
  return m as unknown as THREE.SpriteMaterial;
}

// ---------------------------------------------------------------- the stage's shaders

export function highway(u: Uniforms, params: THREE.MaterialParameters, W: number) {
  const n = bind(u);
  const m = material(new THREE.NodeMaterial(), u, params);
  m.fragmentNode = Fn(() => {
    const vPos = positionGeometry.xy;
    const line = (x: N, w: N) => float(1).sub(smoothstep(0, w, abs(x)));
    const d = vPos.y, x = vPos.x;
    const u0 = x.add(W * 0.5).div(W);
    const hue = mix(n.uHueA, n.uHueB, u0);
    const fade = smoothstep(n.uLen, n.uLen.mul(0.5), d).mul(smoothstep(-2.5, 0, d));
    const col = vec3(0.008, 0.012, 0.03).toVar();
    const lanePos = u0.mul(4);
    const tAt = n.uTime.add(d.div(n.uSpeed));
    const beatF = fract(tAt.div(n.uSpb));
    const sub = fract(lanePos.mul(2));
    const dots = line(min(beatF, float(1).sub(beatF)).mul(n.uSpb).mul(n.uSpeed), 0.04).mul(line(min(sub, float(1).sub(sub)), 0.06));
    col.addAssign(hue.mul(dots).mul(0.35));
    const sep = line(fract(lanePos.add(0.5)).sub(0.5), 0.032);
    const edge = line(abs(x).sub(W * 0.5), 0.04);
    col.addAssign(hue.mul(sep).mul(0.22).add(mix(hue, vec3(1), 0.35).mul(edge).mul(n.uBeat.mul(0.9).add(1.3))));
    const barF = fract(tAt.div(n.uSpb.mul(4)));
    const br = line(min(barF, float(1).sub(barF)).mul(n.uSpb).mul(4).mul(n.uSpeed), 0.06);
    col.addAssign(hue.mul(br).mul(0.45));
    const lane = clamp(floor(lanePos), 0, 3).toInt();
    const g = n.uGlow.element(lane);
    const inLane = float(1).sub(smoothstep(0.32, 0.5, abs(fract(lanePos).sub(0.5))));
    col.addAssign(hue.mul(g).mul(exp(max(d, 0).mul(-0.1))).mul(inLane.mul(0.6).add(0.5)));
    const sweep = exp(sq(d.sub(n.uSweep.mul(n.uLen)).mul(0.5)).negate()).mul(step(0.001, n.uSweep)).mul(float(1).sub(n.uSweep));
    col.addAssign(mix(hue, vec3(1), 0.2).mul(sweep).mul(0.6));
    const sh = sin(d.mul(0.6).sub(n.uTime.mul(4)).add(x.mul(1.5))).mul(0.5).add(0.5);
    col.addAssign(vec3(1, 0.82, 0.5).mul(n.uFever).mul(sh.mul(0.1).add(0.06).add(edge.mul(0.8))));
    col.addAssign(hue.mul(0.16).mul(exp(abs(d).mul(-0.7))));
    const grey = vec3(dot(col, vec3(0.33))).mul(vec3(1.2, 0.6, 0.65));
    const outCol = mix(col, grey, n.uMiss.mul(0.7));
    const a = fade.mul(0.84).add(edge.add(sep.mul(0.3)).add(dots.mul(0.2)).mul(0.3).mul(fade));
    return finish(vec4(outCol, a));
  })();
  return m;
}

export function wall(u: Uniforms, params: THREE.MaterialParameters, maxClimb: number) {
  const n = bind(u);
  const m = material(new THREE.NodeMaterial(), u, params);
  m.fragmentNode = Fn(() => {
    const h = uv().y;
    const d = float(1).sub(uv().x).mul(n.uLen);
    const reach = n.uReach.mul(n.uLen.add(2));
    const lit = smoothstep(reach.add(1.2), reach.sub(0.6), d).mul(n.uLit);
    const fade = smoothstep(n.uLen.add(0.5), n.uLen.mul(0.88), d).mul(smoothstep(-2, 0.5, d));
    const oneH = float(1).sub(h);
    const a = pow(oneH, 2.6).mul(fade).mul(lit).mul(n.uBeat.mul(0.35).add(0.5).add(n.uFever.mul(0.3)));
    const c = mix(n.uColor, vec3(1, 0.85, 0.55), n.uFever.mul(0.6));
    const col = c.mul(oneH.mul(0.8).add(1)).mul(a).toVar();
    const front = exp(sq(d.sub(reach)).mul(-0.6)).mul(float(1).sub(smoothstep(0.85, 1, n.uReach))).mul(n.uLit).mul(fade);
    col.addAssign(mix(c, vec3(1), 0.5).mul(front).mul(pow(oneH, 1.4)).mul(1.6));
    const far = float(1).sub(smoothstep(n.uLen.mul(0.9), n.uLen, d));
    const body = pow(max(0, oneH), 1.7).mul(0.9).add(0.1);
    const glow = float(0).toVar(), rungs = float(0).toVar(), gold = float(0).toVar();
    Loop(maxClimb, ({ i }: { i: N }) => {
      const k = n.uClimb.element(i);
      const wd = max(0.3, k.z);
      const xx = d.sub(k.x).add(h.mul(1.1));
      const head = exp(sq(xx).div(sq(wd)).negate());
      const tail = select(xx.lessThan(0), exp(xx.div(wd.mul(3))).mul(0.3), float(0));
      const e = head.add(tail).mul(k.y);
      glow.addAssign(e);
      gold.addAssign(e.mul(k.w));
      rungs.addAssign(exp(sq(xx).div(sq(wd).mul(0.03)).negate()).mul(k.y));
    });
    const sat = float(1).sub(exp(glow.negate())).mul(body).mul(far).mul(step(0, d.add(1)));
    const tint = mix(c, vec3(1, 0.84, 0.5), clamp(gold.div(max(glow, 0.001)), 0, 1));
    col.addAssign(tint.mul(sat).mul(0.9).add(vec3(0.9).mul(min(rungs, 1)).mul(body).mul(far).mul(0.5)));
    const capped = min(col, vec3(3));
    const A = clamp(max(capped.r, max(capped.g, capped.b)), 0.0001, 1);
    return finish(vec4(capped.div(A), A));
  })();
  return m;
}

export function pad(u: Uniforms, params: THREE.MaterialParameters) {
  const n = bind(u);
  const m = material(new THREE.NodeMaterial(), u, params);
  m.fragmentNode = Fn(() => {
    const p = uv().sub(0.5);
    const q = abs(p).sub(vec2(0.42, 0.32)).add(0.06);
    const d = length(max(q, 0)).add(min(max(q.x, q.y), 0)).sub(0.06);
    const frame = float(1).sub(smoothstep(0, 0.012, abs(d)));
    const corner = step(0.3, abs(p.x)).mul(step(0.2, abs(p.y)));
    const fill = float(1).sub(smoothstep(-0.01, 0.01, d)).mul(n.uPress.mul(0.45).add(0.05).add(n.uFlash.mul(0.7)));
    const halo = exp(max(d, 0).mul(-22)).mul(n.uFlash.mul(0.9).add(0.15).add(n.uPress.mul(0.2)));
    const c = n.uColor.mul(frame.mul(corner.mul(0.9).add(0.7).add(n.uFlash)).add(fill).add(halo))
      .add(vec3(1).mul(frame.mul(n.uFlash.mul(0.7).add(corner.mul(0.25))).add(fill.mul(n.uFlash).mul(0.4))));
    return finish(vec4(c, clamp(frame.mul(corner.mul(0.45).add(0.55)).add(fill).add(halo.mul(0.6)), 0, 1)));
  })();
  return m;
}

/** Tiles: instanced glass blocks. `colors`: the mesh's instanceColor. */
export function tile(u: Uniforms, params: THREE.MaterialParameters) {
  const n = bind(u);
  const m = material(new THREE.NodeMaterial(), u, params);
  return Object.assign(m, {
    /** Called once the instanced mesh (and its colours) exist. */
    useColors(colors: THREE.InstancedBufferAttribute) {
      m.fragmentNode = Fn(() => {
        const vColor = instancedBufferAttribute(colors, 'vec3');
        const rim = pow(float(1).sub(abs(dot(normalize(normalView), normalize(positionViewDirection)))), 2.2);
        const top = smoothstep(-0.12, 0.12, positionGeometry.y);
        const c = vColor.mul(top.mul(0.75).add(0.55)).add(vec3(1).mul(rim).mul(1.1)).add(vColor.mul(rim).mul(0.8));
        const fever = mix(c, c.mul(vec3(1.15, 1, 0.75)).add(vec3(0.12, 0.08, 0)), n.uFever.mul(0.5));
        return finish(vec4(fever, 0.94));
      })();
      m.needsUpdate = true;
    },
  });
}

/**
 * Sparks and motes: sized points as instanced sprites (WebGPU only has 1 px points), sized in
 * device pixels like gl_PointSize. `cull`: dead sparks (alpha 0) get no size, so no fill.
 */
export function points(u: Uniforms, params: THREE.MaterialParameters, a: { pos: THREE.BufferAttribute; col: THREE.BufferAttribute; size: THREE.BufferAttribute; alpha: THREE.BufferAttribute }, count: number, cull: boolean) {
  const n = bind(u);
  const m = material(new THREE.PointsNodeMaterial(), u, { ...params, sizeAttenuation: false } as THREE.MaterialParameters);
  const center = instancedBufferAttribute(a.pos, 'vec3');
  const size = instancedBufferAttribute(a.size, 'float');
  const alpha = instancedBufferAttribute(a.alpha, 'float');
  const color = instancedBufferAttribute(a.col, 'vec3');
  m.positionNode = center;
  const viewZ = modelViewMatrix.mul(vec4(center, 1)).z;
  const px = min(size.mul(300).div(viewZ.negate()), 26).mul(n.uPointScale);
  (m as unknown as THREE.PointsNodeMaterial).sizeNode = (cull ? select(alpha.greaterThan(0), px, float(0)) : px).div(screenDPR);
  m.fragmentNode = Fn(() => {
    const r = length(uv().sub(0.5));
    const k = sq(smoothstep(0.5, 0, r));
    return finish(vec4(varying(color).mul(k.mul(1.4).add(0.9)), k.mul(varying(alpha))));
  })();
  const obj = new THREE.Sprite(m as unknown as THREE.SpriteMaterial);
  obj.count = count;
  obj.frustumCulled = false;
  return { object: obj, material: m };
}

/** The particle world: points flowing between forms, swirling with the music. */
export function world(u: Uniforms, params: THREE.MaterialParameters, a: { pos: THREE.BufferAttribute; target: THREE.BufferAttribute; seed: THREE.BufferAttribute }, count: number) {
  const n = bind(u);
  const m = material(new THREE.PointsNodeMaterial(), u, { ...params, sizeAttenuation: false } as THREE.MaterialParameters);
  const pos = instancedBufferAttribute(a.pos, 'vec3');
  const target = instancedBufferAttribute(a.target, 'vec3');
  const seed = instancedBufferAttribute(a.seed, 'float');
  const rot = (v: N, ang: N) => { const c = cos(ang), s = sin(ang); return vec2(c.mul(v.x).add(s.mul(v.y)), s.negate().mul(v.x).add(c.mul(v.y))); };
  // Plain expressions, no mutable variables: Tint (Chrome's WebGPU compiler) rejects swizzles of them.
  const mm = smoothstep(0, 1, clamp(n.uMorph.mul(1.6).sub(seed.mul(0.6)), 0, 1));
  const p0 = mix(pos, target, mm);
  const swirl = sin(mm.mul(Math.PI));
  const xz1 = rot(vec2(p0.x, p0.z), swirl.mul(seed.mul(2.5).add(1.2)));
  const p1 = vec3(xz1.x, p0.y, xz1.y).mul(swirl.mul(0.4).mul(seed.sub(0.25)).add(1));
  const p2 = p1.add(vec3(sin(n.uTime.mul(0.7).add(seed.mul(40))), cos(n.uTime.mul(0.9).add(seed.mul(31))), sin(n.uTime.mul(0.5).add(seed.mul(17)))).mul(0.03));
  const p3 = p2.mul(n.uBeat.mul(0.04).add(1).add(n.uBass.mul(0.06)).add(n.uPulse.mul(0.08)));
  const xz2 = rot(vec2(p3.x, p3.z), n.uTime.mul(n.uSpin));
  const placed = vec3(xz2.x, p3.y, xz2.y);
  m.positionNode = placed;
  const tw = sin(n.uTime.mul(seed.mul(3).add(1.2)).add(seed.mul(90))).mul(0.5).add(0.5);
  const viewZ = modelViewMatrix.mul(vec4(placed, 1)).z;
  const sizePx = min(18, seed.mul(1.9).add(1).mul(tw.mul(0.6).add(0.7)).mul(n.uHigh.mul(0.8).add(1).add(n.uPulse.mul(0.6))).mul(n.uPx).mul(float(300).div(viewZ.negate())));
  (m as unknown as THREE.PointsNodeMaterial).sizeNode = sizePx.div(screenDPR);
  const col = mix(mix(n.uHueA, n.uHueB, fract(seed.mul(7.13))), vec3(1, 0.84, 0.52), n.uFever.mul(0.65)).add(vec3(0.2).mul(step(0.96, seed)));
  const alpha = tw.mul(0.2).add(0.08).mul(n.uBeat.mul(0.45).add(0.7).add(n.uBass.mul(0.3)).add(n.uPulse.mul(0.7))).mul(n.uCalm).mul(n.uBright);
  const vCol = varying(col), vAlpha = varying(alpha);
  m.fragmentNode = Fn(() => {
    const k = smoothstep(0.5, 0.05, length(uv().sub(0.5)));
    return finish(vec4(vCol, k.mul(vAlpha)));
  })();
  const obj = new THREE.Sprite(m as unknown as THREE.SpriteMaterial);
  obj.count = count;
  obj.frustumCulled = false;
  return { object: obj, material: m };
}

/** Ribbons of light far behind the track, shaped from attributes aT, aSide, aSeed. */
export function ribbon(u: Uniforms, params: THREE.MaterialParameters) {
  const n = bind(u);
  const m = material(new THREE.NodeMaterial(), u, params);
  const aT = attribute('aT', 'float'), side = attribute('aSide', 'float'), s = attribute('aSeed', 'float');
  const dir = select(s.lessThan(0.5), float(1), float(-1));
  const th = aT.mul(6.2832).mul(s.mul(0.45).add(0.5)).add(n.uFlow.mul(s.mul(0.3).add(0.25)).mul(dir)).add(s.mul(40));
  const R = s.mul(12).add(32).add(sin(th.mul(2).add(s.mul(9)).add(n.uTime.mul(0.2))).mul(6));
  const ripple = sin(aT.mul(34).sub(n.uTime.mul(3.2)).add(s.mul(20))).mul(n.uMid.mul(1.8).add(0.3).add(n.uPulse.mul(1.2)));
  const w = s.mul(0.55).add(0.3).mul(n.uBass.mul(1.5).add(1).add(n.uPulse.mul(2)).add(n.uBeat.mul(0.4)));
  m.positionNode = vec3(
    cos(th).mul(R).mul(1.55),
    s.mul(11).add(8).add(sin(th.mul(1.7).add(n.uTime.mul(0.35)).add(s.mul(13))).mul(5)).add(ripple).add(side.mul(w)),
    sin(th).mul(R).mul(0.55).sub(80),
  );
  const run = fract(aT.mul(1.4).sub(n.uTime.mul(s.mul(0.12).add(0.14)).mul(dir)).add(s));
  const spark = exp(sq(run.sub(0.5).mul(10)).negate());
  const col = mix(mix(n.uHueA, n.uHueB, fract(s.mul(3.7).add(aT.mul(0.8)))), vec3(1, 0.78, 0.42), n.uFever.mul(0.7)).add(vec3(spark.mul(0.45)));
  const alpha = sin(aT.mul(3.14159)).mul(n.uBeat.mul(0.12).add(0.06).add(n.uBass.mul(0.1)).add(spark.mul(0.36)).add(n.uPulse.mul(0.25)).add(n.uFever.mul(0.08)));
  const vCol = varying(col), vAlpha = varying(alpha), vSide = varying(side);
  m.fragmentNode = Fn(() => {
    const a = float(1).sub(sq(vSide));
    return finish(vec4(vCol, sq(a).mul(vAlpha)));
  })();
  return m;
}

// ---------------------------------------------------------------- full-screen and overlay passes

/** A full-screen quad's material: clip-space vertices, `frag` from screen uv (y up, as a plane's uv). */
export function quad(u: Uniforms, frag: (n: Record<string, N>, uvUp: N, screen: N) => N, params: THREE.MaterialParameters) {
  const n = bind(u);
  const m = material(new THREE.NodeMaterial(), u, params);
  m.vertexNode = vec4(positionGeometry.xy, 0, 1);
  const uvUp = vec2(screenUV.x, float(1).sub(screenUV.y));
  m.fragmentNode = Fn(() => frag(n, uvUp, screenUV))();
  return m;
}

/** Half-res effects: adds a layer back as it is. */
export function composite(u: Uniforms) {
  // A layer that covers the screen is sampled at screen uv: 1:1, whatever the backend's y.
  return quad(u, (n, _uv, screen) => n.uMap.sample(screen), {
    depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
}

/** Baked bursts: two frames of the sheet, blended, premultiplied (raw). */
export function burst(u: Uniforms, params: THREE.MaterialParameters) {
  const n = bind(u);
  const m = material(new THREE.NodeMaterial(), u, params);
  m.fragmentNode = Fn(() => {
    const cell = (i: N) => {
      const c = vec2(i.mod(n.uGrid.x), floor(i.div(n.uGrid.x)));
      return n.uMap.sample(vec2(c.x.add(uv().x).div(n.uGrid.x), float(1).sub(c.y.add(1).sub(uv().y).div(n.uGrid.y))));
    };
    return mix(cell(n.uA), cell(n.uB), n.uMix).mul(n.uAlpha);
  })();
  return m;
}

// ---------------------------------------------------------------- the sky (sky.ts)

/** Capsule segments in CSS pixels (y down), from instanced attributes. */
export function skySegments(u: Uniforms, params: THREE.MaterialParameters) {
  const n = bind(u);
  const m = material(new THREE.NodeMaterial(), u, params);
  const corner = attribute('corner', 'vec2');
  const seg = attribute('aSeg', 'vec4'), color = attribute('aColor', 'vec4'), width = attribute('aWidth', 'float');
  const a = seg.xy, b = seg.zw, d = b.sub(a);
  const len = max(length(d), 1e-4);
  const t = d.div(len), nrm = vec2(t.y.negate(), t.x);
  const r = width.mul(0.5).add(n.uPixel);
  const p = a.add(t.mul(corner.x.mul(len.add(r.mul(2))).sub(r))).add(nrm.mul(corner.y).mul(r));
  m.vertexNode = cameraProjectionMatrix.mul(vec4(p.x, p.y.negate(), 0, 1));
  const vP = varying(p), vA = varying(a), vB = varying(b), vR = varying(width.mul(0.5)), vColor = varying(color);
  m.fragmentNode = Fn(() => {
    const pa = vP.sub(vA), ba = vB.sub(vA);
    const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-6)), 0, 1);
    const dist = length(pa.sub(ba.mul(h)));
    const cov = clamp(vR.sub(dist).div(n.uPixel).add(0.5), 0, 1).mul(min(1, vR.mul(2).div(n.uPixel)));
    const al = vColor.a.mul(cov);
    return vec4(vColor.rgb.mul(al), al);
  })();
  return m;
}

/** Thin rings (CSS pixels, y down), from instanced attributes. */
export function skyCircles(u: Uniforms, params: THREE.MaterialParameters) {
  const n = bind(u);
  const m = material(new THREE.NodeMaterial(), u, params);
  const corner = attribute('corner', 'vec2');
  const circle = attribute('aCircle', 'vec4'), color = attribute('aColor', 'vec4');
  const ang = corner.x.mul(6.2831853);
  const off = corner.y.mul(circle.w.mul(0.5).add(n.uPixel));
  const p = circle.xy.add(vec2(cos(ang), sin(ang)).mul(max(0, circle.z.add(off))));
  m.vertexNode = cameraProjectionMatrix.mul(vec4(p.x, p.y.negate(), 0, 1));
  const vOff = varying(off), vHalf = varying(circle.w.mul(0.5)), vColor = varying(color);
  m.fragmentNode = Fn(() => {
    const cov = clamp(vHalf.sub(abs(vOff)).div(n.uPixel).add(0.5), 0, 1).mul(min(1, vHalf.mul(2).div(n.uPixel)));
    const al = vColor.a.mul(cov);
    return vec4(vColor.rgb.mul(al), al);
  })();
  return m;
}

/** The sky's full-screen passes, as sky.ts's GLSL. */
export const skyFrag: Record<string, (n: Record<string, N>, uvUp: N, screen: N) => N> = {
  base: (n: Record<string, N>, uvUp: N) => {
    const o = vec2(0.5, 0.55);
    return vec4(n.uMap.sample(o.add(uvUp.sub(o).div(n.uScale))).rgb, 1);
  },
  copy: (n: Record<string, N>, _uv: N, screen: N) => n.uMap.sample(screen),
  fade: () => vec4(0, 0, 0, 0.3),
  pulse: (n: Record<string, N>, uvUp: N) => {
    const ellipse = (p: N, c: N, r: N, col: N, a: number) => {
      const t = length(p.sub(c).div(r));
      const k = float(a).mul(clamp(float(1).sub(t.div(0.7)), 0, 1));
      return vec4(col.mul(k), k);
    };
    const over = (top: N, under: N) => top.add(under.mul(float(1).sub(top.a)));
    let p = vec2(uvUp.x, float(1).sub(uvUp.y));
    p = p.add(0.1).div(1.2);
    p = p.sub(0.5).div(n.uScale).add(0.5);
    let c = ellipse(p, vec2(0.82, 0.18), vec2(0.6, 0.5), n.uC, 0.16);
    c = over(ellipse(p, vec2(0.2, 0.8), vec2(0.6, 0.5), n.uB, 0.18), c);
    c = over(ellipse(p, vec2(0.5, 0.52), vec2(0.45, 0.4), n.uA, 0.34), c);
    return c.mul(n.uOpacity);
  },
  flash: (n: Record<string, N>, uvUp: N) => {
    const p = uvUp.mul(n.uSize);
    const t = clamp(length(p.sub(n.uSize.mul(0.5))).div(length(n.uSize).mul(0.6)), 0, 1);
    const drop = mix(vec4(n.uA, 0.2), vec4(n.uB, 0.03), t).mul(n.uDrop);
    const miss = vec4(1, 0.235, 0.353, 1).mul(n.uMiss);
    return vec4(drop.rgb.mul(drop.a).add(miss.rgb.mul(miss.a)), drop.a.add(miss.a));
  },
  vignette: (n: Record<string, N>, uvUp: N) => {
    const t = length(uvUp.sub(0.5).div(0.70710678));
    const a = clamp(t.sub(0.6).div(0.4), 0, 1).mul(0.6).mul(n.uOpacity);
    return vec4(vec3(4, 2, 9).div(255).mul(a), a);
  },
  /**
   * Merged (B): deep space, the sand over it and the bloom over that, in one pass. The same maths
   * as the base, copy and pulse passes run one after another.
   */
  compose: (n: Record<string, N>, uvUp: N, screen: N) => {
    const o = vec2(0.5, 0.55);
    const base = n.uMap.sample(o.add(uvUp.sub(o).div(n.uScale))).rgb;
    const sand = n.uSand.sample(screen);
    const withSand = sand.rgb.add(base.mul(float(1).sub(sand.a)));
    const pulse = skyFrag.pulse({ uA: n.uPA, uB: n.uPB, uC: n.uPC, uOpacity: n.uPOpacity, uScale: n.uPScale }, uvUp, screen);
    return vec4(pulse.rgb.add(withSand.mul(float(1).sub(pulse.a))), 1);
  },
  /**
   * Merged (B): onto the stage: the flashes added, the vignette over, dimmed for play, then the
   * half-size layer of effects behind the glass added (as the flash, vignette, out and far
   * composite passes did one after another).
   */
  final: (n: Record<string, N>, uvUp: N, screen: N) => {
    const sky = n.uMap.sample(screen).rgb;
    const flash = skyFrag.flash({ uA: n.uFA, uB: n.uFB, uSize: n.uSize, uDrop: n.uDrop, uMiss: n.uMiss }, uvUp, screen);
    const lit = sky.add(flash.rgb);
    const vig = skyFrag.vignette({ uOpacity: n.uVig }, uvUp, screen);
    const under = vig.rgb.add(lit.mul(float(1).sub(vig.a)));
    const l = dot(under, vec3(0.2126, 0.7152, 0.0722));
    // uDim: 1 in play (dimmed as the page's CSS does), 0 on the menu.
    const dimmed = mix(under, max(vec3(0), mix(vec3(l), under, 1.15)).mul(0.72), n.uDim);
    return vec4(dimmed.add(n.uFar.sample(screen).rgb.mul(n.uHasFar)), 1);
  },
  out: (n: Record<string, N>, _uv: N, screen: N) => {
    const c = n.uMap.sample(screen).rgb;
    const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return vec4(mix(c, max(vec3(0), mix(vec3(l), c, 1.15)).mul(0.72), n.uDim), 1);
  },
};

export { THREE as GPU };
