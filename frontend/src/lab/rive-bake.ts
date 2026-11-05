// Dev-only page (/lab/rive-bake.html): bakes the hit and hold bursts (hit.riv, hold.riv) into sprite
// sheets, frame by frame with the real Rive runtime, so the 3D stage can draw the same art in one
// draw. tools/rive/bake.mjs drives it and saves the result to
// public/rive/baked/. It uses Rive's low-level runtime (the same WASM as the app's Rive canvases):
// each frame is the animations set to an exact time, applied, and drawn, so a bake is repeatable.

import { RuntimeLoader } from '@rive-app/canvas';
import wasmUrl from '@rive-app/canvas/rive.wasm?url';
import { BAKE, type BakeSheet } from '../stage/bursts';

RuntimeLoader.setWasmUrl(wasmUrl);

declare global { interface Window { __bake?: { sheets: Record<string, { png: string; meta: BakeSheet }>; error?: string } } }

/** Animations per file: [clip name, animations applied together in order, length in Rive frames (60 fps), loops]. */
const CLIPS: Record<'hit' | 'hold', [string, string[], number, boolean][]> = {
  hit: [
    ...(['perfect', 'great', 'good'] as const).flatMap((k) => [0, 1, 2, 3, 4].map((v) => [`${k}-${v}`, [`${k}-${v}`], { perfect: 32, great: 28, good: 24 }[k], false] as [string, string[], number, boolean])),
    ['miss', ['miss'], 34, false],
  ],
  hold: [
    ['charge', ['charge', 'rest'], 60, true],
    ['arcs', ['arcs', 'rest'], 90, true],
    ['chevrons', ['chevrons', 'rest'], 36, true],
    ['orbit', ['orbit', 'rest'], 72, true],
    ['beam', ['beam', 'rest'], 30, true],
    ['done', ['idle', 'done'], 30, false],
    ['broken', ['idle', 'broken'], 26, false],
  ],
};
const ARTBOARD = { hit: 'Hit', hold: 'Hold' };

async function bake(file: 'hit' | 'hold') {
  const rive = await RuntimeLoader.awaitInstance();
  const bytes = new Uint8Array(await (await fetch(`/rive/${file}.riv`)).arrayBuffer());
  const riv = await rive.load(bytes);
  const { frame: F, fps, cols } = BAKE;
  const clips = CLIPS[file];
  const counts = clips.map(([, , dur, loop]) => (loop ? Math.round((dur / 60) * fps) : Math.floor((dur / 60) * fps) + 1));
  const total = counts.reduce((a, b) => a + b, 0);
  const rows = Math.ceil(total / cols);
  const atlas = document.createElement('canvas');
  atlas.width = cols * F;
  atlas.height = rows * F;
  const g = atlas.getContext('2d')!;
  const canvas = document.createElement('canvas');
  canvas.width = F;
  canvas.height = F;
  const renderer = rive.makeRenderer(canvas);
  const meta: BakeSheet = { rows, clips: {} };
  let cell = 0;
  for (let c = 0; c < clips.length; c++) {
    const [name, anims, , loop] = clips[c];
    const ab = riv.artboardByName(ARTBOARD[file]);
    const instances = anims.map((a) => new rive.LinearAnimationInstance(ab.animationByName(a), ab));
    meta.clips[name] = { start: cell, count: counts[c], loop };
    for (let i = 0; i < counts[c]; i++) {
      for (const inst of instances) { inst.time = 0; inst.advance(i / fps); inst.apply(1); }
      ab.advance(0);
      renderer.beginFrame(true);
      renderer.save();
      renderer.align(rive.Fit.contain, rive.Alignment.center, { minX: 0, minY: 0, maxX: F, maxY: F }, ab.bounds);
      ab.draw(renderer);
      renderer.restore();
      renderer.flush();
      rive.resolveAnimationFrame(); // the canvas renderer draws its queued commands here
      g.drawImage(canvas, (cell % cols) * F, Math.floor(cell / cols) * F);
      cell++;
    }
    for (const inst of instances) inst.delete();
    ab.delete();
  }
  renderer.delete();
  return { png: atlas.toDataURL('image/png'), meta };
}

(async () => {
  try {
    window.__bake = { sheets: { hit: await bake('hit'), hold: await bake('hold') } };
  } catch (e) {
    window.__bake = { sheets: {}, error: String((e as Error)?.stack ?? e) };
  }
})();
