import { describe, expect, it } from 'vitest';
import * as ort from 'onnxruntime-web';
import { hearNotes } from '../../src/mapping/notes';
import type { Ort } from '../../src/mapping/ort';

const SR = 22050;
// The model's bytes from the site's folder (Node's fs, typed here: the tests' tsconfig has no Node types).
const fs = (globalThis as unknown as { process: { getBuiltinModule(m: 'node:fs'): { readFileSync(p: string): Uint8Array } } }).process.getBuiltinModule('node:fs');
const model = fs.readFileSync('public/models/basic-pitch.onnx');

/** A tone with a few harmonics and a soft attack, `len` s long, at MIDI `midi`, into `x` at `at` s. */
function tone(x: Float32Array, at: number, len: number, midi: number) {
  const f = 440 * 2 ** ((midi - 69) / 12);
  const a = Math.round(at * SR), n = Math.round(len * SR);
  for (let i = 0; i < n && a + i < x.length; i++) {
    const env = Math.min(1, i / (0.01 * SR)) * Math.exp(-i / (SR * 0.8)) * Math.min(1, (n - i) / (0.02 * SR));
    const t = i / SR;
    x[a + i] += 0.3 * env * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t));
  }
}

describe('the notes heard (Basic Pitch)', () => {
  it('hears a melody note by note: when each starts, its pitch, how long it sounds', async () => {
    // A tune of 24 notes over 9 s (some legato: one starts as the last ends), across window edges.
    const x = new Float32Array(SR * 10);
    const tune = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 67, 64, 72, 60, 65, 69, 62, 71, 64];
    const truth = tune.map((midi, i) => ({ at: 0.5 + i * 0.37, midi, len: i % 3 === 0 ? 0.6 : 0.37 }));
    for (const t of truth) tone(x, t.at, t.len, t.midi);
    const notes = await hearNotes(ort as unknown as Ort, x, SR, { model });
    let found = 0;
    const err: number[] = [];
    for (const t of truth) {
      const n = notes.find((m) => m.midi === t.midi && Math.abs(m.sec - t.at) < 0.05);
      if (!n) continue;
      found++;
      err.push(Math.abs(n.sec - t.at));
    }
    expect(found).toBeGreaterThanOrEqual(22);
    err.sort((a, b) => a - b);
    // Started within a frame or two (12 ms each) of the note.
    expect(err[err.length >> 1]).toBeLessThan(0.025);
    // A long note is heard long.
    const long = notes.find((m) => m.midi === truth[3].midi && Math.abs(m.sec - truth[3].at) < 0.05)!;
    expect(long.len).toBeGreaterThan(0.4);
    // Nothing much heard that wasn't played (an octave's echo at most now and then).
    expect(notes.length).toBeLessThan(truth.length * 1.5);
  }, 60_000);

  it('hears nothing in silence', async () => {
    expect(await hearNotes(ort as unknown as Ort, new Float32Array(SR * 3), SR, { model })).toEqual([]);
  }, 30_000);
});
