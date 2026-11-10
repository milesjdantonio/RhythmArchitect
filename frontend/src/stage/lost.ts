// When the browser takes the graphics chip away from a canvas: moving the window to a monitor on
// another graphics adapter, a driver reset, the laptop switching GPUs, or the browser reclaiming
// memory. The canvas then shows nothing (white) until the stage is built again on a fresh one;
// proxy.ts and background/host.ts do that when they hear about it from here.

import type * as THREE from 'three';

/**
 * Calls `onLost` once when `renderer` loses its GPU: a WebGPU device lost (WebGPURenderer's
 * onDeviceLost), or a WebGL context lost (the canvas's webglcontextlost, also fired on an
 * OffscreenCanvas in a worker). Returns the unsubscribe.
 */
export function watchLost(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement | OffscreenCanvas, onLost: (why: string) => void) {
  let done = false;
  const once = (why: string) => { if (!done) { done = true; onLost(why); } };
  const r = renderer as unknown as { onDeviceLost?: (info: { message?: string; reason?: string }) => void; backend?: { isWebGPUBackend?: boolean } };
  if ('onDeviceLost' in r) {
    const before = r.onDeviceLost;
    r.onDeviceLost = (info) => {
      before?.call(renderer, info);
      once(`WebGPU device lost${info?.reason ? ` (${info.reason})` : ''}`);
    };
  }
  const onWebgl = (e: Event) => { e.preventDefault(); once('WebGL context lost'); };
  canvas.addEventListener('webglcontextlost', onWebgl);
  return () => canvas.removeEventListener('webglcontextlost', onWebgl);
}
