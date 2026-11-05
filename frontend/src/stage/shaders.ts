// The 3D stage's GLSL shaders (WebGL). Every one has a TSL twin in gpu.ts for WebGPU: change both.

/** Bands of light climbing each wall (the size of the walls' uClimb array). */
export const MAX_CLIMB = 8;

export const HIGHWAY_VERT = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy; // plane in its own space: x across, y along (toward -z after rotation)
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
export const HIGHWAY_FRAG = /* glsl */ `
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
export const WALL_FRAG = /* glsl */ `
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
export const PAD_FRAG = /* glsl */ `
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
export const UV_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// Tiles: glassy blocks lit from inside, with bright rims that catch the light.
export const TILE_VERT = /* glsl */ `
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
export const TILE_FRAG = /* glsl */ `
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
export const SPARK_VERT = /* glsl */ `
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
export const SPARK_FRAG = /* glsl */ `
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
export const WORLD_VERT = /* glsl */ `
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
export const RIBBON_VERT = /* glsl */ `
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
export const RIBBON_FRAG = /* glsl */ `
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
export const WORLD_FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float a = smoothstep(0.5, 0.05, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(vColor, a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
