// Performance profiles: how the game screen draws. Both are "one stage": the backdrop drawn inside
// the 3D stage, soft glows at half resolution, the Rive bursts baked into sprite sheets the stage
// draws, the whole stage on its own thread at the screen's rate, and every main-thread animation on
// one shared loop (lib/ticker.ts). The game picks one at startup (gameProfile): B on WebGPU where
// the browser has it, else A on WebGL.

export type ProfileId = 'unified' | 'webgpu';

export interface PerfProfile {
  id: ProfileId;
  /** The stage's graphics API: WebGL, or WebGPU (falling back to WebGL where it's missing). */
  renderer: 'webgl' | 'webgpu';
  /**
   * The page's big moments (combo callout, section banner, countdown): animated with blur and
   * letter-spacing as designed ('full'), or the same look with only transform and opacity moving
   * ('lite'): no blur, spacing tightened with a horizontal scale. Blur and spacing make the browser
   * repaint on the graphics chip the stage is drawing with, and the stage drops frames.
   */
  uiFx: 'full' | 'lite';
  /** Frames per second at most (0: the display's rate). The menus' workers set MENU_FPS. */
  fpsCap: number;
}

export const PROFILES: Record<ProfileId, PerfProfile> = {
  /** A: one stage, WebGL. */
  unified: { id: 'unified', renderer: 'webgl', uiFx: 'full', fpsCap: 0 },
  /**
   * B: A drawn with WebGPU (every shader in stage/shaders.ts has a TSL twin in stage/gpu.ts,
   * tone-mapped per material so the light adds up as it does in A). Falls back to WebGL where
   * WebGPU is missing.
   */
  webgpu: { id: 'webgpu', renderer: 'webgpu', uiFx: 'lite', fpsCap: 0 },
};

let active: PerfProfile = PROFILES.unified;

export const perf = () => active;

/**
 * The game's profile on this browser: B (WebGPU) where it has WebGPU, A (WebGL) where it doesn't.
 * (Where a worker can't draw, either still runs its stage on the main thread; see Play.tsx.)
 */
export function gameProfile(): ProfileId {
  return typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'unified';
}

/** `overrides`: settings changed on top (the menus' workers cap their frames at MENU_FPS). */
export function setPerf(id: ProfileId, overrides: Partial<PerfProfile> = {}) {
  active = { ...PROFILES[id], ...overrides };
}

// ---------------------------------------------------------------- the frame cap

/**
 * Frames per second at most for the menus' moving parts (the sky, the stage preview, Rive). They
 * move slowly; drawing them at 120 Hz looks the same and leaves less of the graphics chip for
 * everything else. Gameplay and the intro draw at the screen's full rate.
 */
export const MENU_FPS = 60;

let gateTs = Number.NaN;
let gateOk = true;
let gateNext = Number.NaN;
/**
 * Whether to draw on this display frame (when `fpsCap` is set). Every loop passes its
 * requestAnimationFrame timestamp; loops in the same frame get the same one, so they all draw on
 * the same frames and skip the same frames (never the game on one and the backdrop on the next).
 * Draw slots are kept every 1/cap seconds and a frame draws when it reaches the next slot, so 120
 * and 240 Hz screens draw every 2nd or 4th frame and 144 or 165 Hz ones average exactly 60.
 */
export function frameGate(ts: number): boolean {
  const cap = active.fpsCap;
  if (!cap) return true;
  if (ts === gateTs) return gateOk;
  gateTs = ts;
  const iv = 1000 / cap;
  // First frame, fell far behind (a stall, a hidden tab), or a new clock: start the slots here.
  if (!(ts - gateNext <= iv && gateNext - ts <= iv * 2)) gateNext = ts;
  // A frame early by up to 1.5 ms still counts (display timestamps jitter).
  if (ts < gateNext - 1.5) return (gateOk = false);
  gateNext += iv;
  return (gateOk = true);
}
