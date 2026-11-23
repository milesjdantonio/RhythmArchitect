// How much the game draws on this computer (the user, Nov 22: "on some systems it can't even run
// cause too much GPU"). Settings → Graphics: Auto (picked here), Full, Light or Simple.
//
//   full    the 3D stage as designed
//   light   the 3D stage with less to draw: a lower resolution cap, no particle world or far layer
//           behind the track, half the particles, no warp streaks or drop lasers (Stage3D `light`)
//   simple  the flat 2D stage (game/render.ts, the fallback where WebGL is missing) and a still
//           background on the menus
//
// Auto: Simple where the browser draws in software (no graphics chip: SwiftShader, llvmpipe,
// Microsoft's basic renderer) or has no WebGL; Light on a small machine (4 cores or fewer, 4 GB of
// memory or less where the browser says) or an older integrated chip; else Full.

import { getSettings } from './settings';

export type GraphicsLevel = 'full' | 'light' | 'simple';
export type GraphicsSetting = 'auto' | GraphicsLevel;

let detected: { level: GraphicsLevel; why: string } | null = null;

/** What Auto picks here, and why (Settings shows it). Measured once. */
export function detectGraphics(): { level: GraphicsLevel; why: string } {
  if (detected) return detected;
  detected = measure();
  return detected;
}

function measure(): { level: GraphicsLevel; why: string } {
  if (typeof document === 'undefined') return { level: 'full', why: '' };
  let renderer = '';
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return { level: 'simple', why: 'no WebGL' };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return { level: 'simple', why: 'no WebGL' };
  }
  if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) return { level: 'simple', why: 'no graphics chip (drawn in software)' };
  const cores = navigator.hardwareConcurrency || 8;
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  if (cores <= 4) return { level: 'light', why: `${cores} processor cores` };
  if (memory !== undefined && memory <= 4) return { level: 'light', why: `${memory} GB of memory` };
  if (/intel\(r\) (hd|uhd) graphics( [1-6]\d\d)?\b|mali-[gt]?\d{2}\b|adreno \(tm\) [3-5]\d\d/i.test(renderer)) return { level: 'light', why: 'an older built-in graphics chip' };
  return { level: 'full', why: '' };
}

/** The level the game draws at now: the setting, or Auto's pick. */
export function graphicsLevel(): GraphicsLevel {
  const s = getSettings().graphics;
  return s === 'auto' ? detectGraphics().level : s;
}
