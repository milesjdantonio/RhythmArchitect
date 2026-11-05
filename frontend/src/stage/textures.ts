// The 3D stage's small textures (glow, beam, column, star), drawn once on a canvas.

import * as THREE from 'three';

export function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  // In a worker there is no document: an OffscreenCanvas draws the same.
  const c = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: size, height: size }) : new OffscreenCanvas(size, size);
  draw(c.getContext('2d') as CanvasRenderingContext2D, size);
  const t = new THREE.CanvasTexture(c as HTMLCanvasElement);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const glowTexture = () => canvasTexture(64, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.3, 'rgba(255,255,255,0.4)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, s, s);
});

export const beamTexture = () => canvasTexture(64, (g, s) => {
  const v = g.createLinearGradient(0, s, 0, 0);
  v.addColorStop(0, 'rgba(255,255,255,0.95)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v;
  g.fillRect(0, 0, s, s);
  const h = g.createLinearGradient(0, 0, s, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)');
  h.addColorStop(0.5, 'rgba(0,0,0,0)');
  h.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = h;
  g.fillRect(0, 0, s, s);
});

/** A soft column of light: faint at both ends, brightest a quarter of the way up, soft at the sides. */
export const columnTexture = () => canvasTexture(64, (g, s) => {
  const v = g.createLinearGradient(0, s, 0, 0);
  v.addColorStop(0, 'rgba(255,255,255,0)');
  v.addColorStop(0.22, 'rgba(255,255,255,0.85)');
  v.addColorStop(0.55, 'rgba(255,255,255,0.3)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v;
  g.fillRect(0, 0, s, s);
  const h = g.createLinearGradient(0, 0, s, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)');
  h.addColorStop(0.5, 'rgba(0,0,0,0)');
  h.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = h;
  g.fillRect(0, 0, s, s);
});

/** A four-point star with a soft core: the glint that twinkles off every hit. */
export const starTexture = () => canvasTexture(128, (g, s) => {
  const c = s / 2;
  const core = g.createRadialGradient(c, c, 0, c, c, c * 0.45);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[c * 0.08, c * 0.98], [c * 0.98, c * 0.08]]) {
    const grad = g.createRadialGradient(c, c, 0, c, c, Math.max(w, h));
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(c - w, c); g.lineTo(c, c - h); g.lineTo(c + w, c); g.lineTo(c, c + h);
    g.closePath();
    g.fill();
  }
});
