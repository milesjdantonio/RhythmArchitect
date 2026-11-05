// Dev-only page (/rive-lab.html) that loads .riv files with the real runtime, lists their
// artboards, animations and state-machine inputs, and gives a control per input.
// tools/rive/check.mjs drives it headlessly.  ?file=logo,hit  limits which files load.

import { Rive, Layout, Fit, Alignment, RuntimeLoader, StateMachineInputType } from '@rive-app/canvas';
import wasmUrl from '@rive-app/canvas/rive.wasm?url';

RuntimeLoader.setWasmUrl(wasmUrl);
Rive.suppressDeprecationWarnings = ['default-state-machine', 'state-machine-inputs', 'state-machines-param'];

type Report = { name: string; loaded: boolean; error?: string; animations: string[]; stateMachines: { name: string; inputs: { name: string; type: string }[] }[] };
declare global { interface Window { __rive: Record<string, Report>; __riveInputs: Record<string, Record<string, { value: number | boolean; fire: () => void }>> } }
window.__rive = {};
window.__riveInputs = {};

const ALL = ['intro', 'attract', 'cover', 'logo', 'wordmark', 'composing', 'hit', 'hold', 'combo', 'result', 'difficulty', 'cassette'];
const q = new URLSearchParams(location.search).get('file');
const files = q ? q.split(',') : ALL;
// "file:Artboard" picks an artboard; otherwise each artboard listed in ARTBOARDS gets a panel.
const ARTBOARDS: Record<string, string[]> = { result: ['Clear', 'Failed'], difficulty: ['Easy', 'Medium', 'Hard'] };
// State machine to start, by file or file:artboard (the runtime only starts machines named up front).
const MACHINES: Record<string, string> = {
  intro: 'Intro', attract: 'Attract', cover: 'Cover', logo: 'Logo', wordmark: 'Wordmark', composing: 'Composing', hit: 'Hit', hold: 'Hold', combo: 'Combo',
  'result:Clear': 'Clear', 'result:Failed': 'Failed', difficulty: 'Difficulty', cassette: 'Cassette',
};

for (const spec of files) {
  const [file, only] = spec.split(':');
  for (const artboard of only ? [only] : ARTBOARDS[file] ?? [undefined]) mount(file, artboard);
}

function mount(file: string, artboard?: string) {
  const key = artboard ? `${file}:${artboard}` : file;
  const sec = document.createElement('section');
  sec.innerHTML = `<h2>${key}</h2><div class="stage"><canvas></canvas></div><div class="controls"></div>`;
  document.body.append(sec);
  const canvas = sec.querySelector('canvas')!;
  const controls = sec.querySelector('.controls')!;
  const report: Report = { name: key, loaded: false, animations: [], stateMachines: [] };
  window.__rive[key] = report;
  const machine = MACHINES[key] ?? MACHINES[file];
  const r: Rive = new Rive({
    src: `/rive/${file}.riv`, canvas, artboard, autoplay: true, stateMachines: machine,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
    onLoad: () => {
      r.resizeDrawingSurfaceToCanvas();
      report.loaded = true;
      report.animations = r.animationNames;
      for (const sm of r.stateMachineNames) {
        const inputs = r.stateMachineInputs(sm) ?? [];
        report.stateMachines.push({ name: sm, inputs: inputs.map((i) => ({ name: i.name, type: StateMachineInputType[i.type] })) });
      }
      const sm = machine;
      window.__riveInputs[key] = Object.fromEntries((r.stateMachineInputs(sm) ?? []).map((i) => [i.name, i]));
      if (sm) {
        for (const i of r.stateMachineInputs(sm) ?? []) {
          if (i.type === StateMachineInputType.Trigger) {
            const b = document.createElement('button');
            b.textContent = i.name;
            b.onclick = () => i.fire();
            controls.append(b);
          } else if (i.type === StateMachineInputType.Boolean) {
            const l = document.createElement('label');
            l.innerHTML = `<input type="checkbox"> ${i.name}`;
            l.querySelector('input')!.onchange = (e) => { i.value = (e.target as HTMLInputElement).checked; };
            controls.append(l);
          } else {
            const l = document.createElement('label');
            l.innerHTML = `${i.name} <input type="range" min="0" max="4" step="1" value="0">`;
            l.querySelector('input')!.oninput = (e) => { i.value = Number((e.target as HTMLInputElement).value); };
            controls.append(l);
          }
        }
      }
    },
    onLoadError: (e) => { report.error = String((e as { data?: unknown })?.data ?? 'load error'); },
  });
}
