// The 3D stage's particle world: the forms it flows through, one per section of the song,
// and the points of each (about unit size).

export type Form = 'galaxy' | 'sphere' | 'ring' | 'wave' | 'helix' | 'bloom' | 'crystal' | 'knot' | 'vortex' | 'atom' | 'hypercube';
// The order the world flows through, one form per section: soft forms and hard-edged ones take turns.
export const FORMS: Form[] = ['galaxy', 'crystal', 'ring', 'knot', 'sphere', 'vortex', 'bloom', 'atom', 'helix', 'hypercube', 'wave'];

export type V3 = [number, number, number];
export const rotX = ([x, y, z]: V3, a: number): V3 => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
export const rotY = ([x, y, z]: V3, a: number): V3 => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];

/** Edge-drawn forms: their line segments, worked out once. */
export const SEGMENTS = (() => {
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

export function seeded(seed: number) {
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
export function formPoints(kind: Form, out: Float32Array, rand: () => number) {
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
