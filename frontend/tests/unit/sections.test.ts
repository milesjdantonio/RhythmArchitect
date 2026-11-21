import { describe, expect, it } from 'vitest';
import { songForm, reportSections, type PhraseFeatures } from '../../src/mapping/sections';

// A pop song's form, phrase by phrase (2 bars each): what was heard in each. Each part has its own
// rhythm and tune (a fingerprint made from a seed), the same every time it comes back.
const SLOTS = 32 * 3 + 12;
/** A seeded random (mulberry32): each part's rhythm and tune its own. */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function print(seed: number, density: number) {
  const r = rand(seed), f = new Float64Array(SLOTS);
  for (let i = 0; i < SLOTS - 12; i++) if (r() < density) f[i] = 0.5 + r() / 2;
  for (let k = 0; k < 3; k++) f[SLOTS - 12 + Math.floor(r() * 12)] = 1;
  return f;
}
function voice(seed: number) {
  const r = rand(seed * 31 + 7), v = new Float64Array(16 + 12);
  for (let i = 0; i < 16; i++) if (r() < 0.4) v[i] = 1;
  for (let k = 0; k < 3; k++) v[16 + Math.floor(r() * 12)] = 2;
  return v;
}
type Part = { name: string; energy: number; drums: number; sung: number; seed: number; phrases: number };
const part = (name: string, energy: number, drums: number, sung: number, seed: number, phrases = 4): Part => ({ name, energy, drums, sung, seed, phrases });
function song(parts: Part[]) {
  const ph: PhraseFeatures[] = [];
  const truth: string[] = [];
  for (const p of parts) {
    for (let k = 0; k < p.phrases; k++) {
      ph.push({ energy: p.energy, bass: p.energy * 0.8, drums: p.drums, sung: p.sung, sounds: p.energy * 2, print: print(p.seed * 10 + k, 0.1 + p.energy * 0.2), ...(p.sung ? { voice: voice(p.seed * 10 + k) } : {}) });
      truth.push(p.name);
    }
  }
  return { ph, truth };
}

describe('the song\'s form (sections.ts)', () => {
  const intro = part('Intro', 0.25, 0.1, 0, 1, 2);
  const verse = part('Verse', 0.55, 0.6, 1.2, 2);
  const chorus = part('Chorus', 0.85, 0.9, 1.5, 3);
  const bridge = part('Bridge', 0.45, 0.4, 1, 4);
  const fade = part('Fade', 0.05, 0, 0, 5, 2);
  const { ph, truth } = song([intro, verse, chorus, verse, chorus, bridge, chorus, fade]);
  const form = songForm(ph);
  const label = (p: number) => form.sections[form.sectionOf[p]].label;

  it('finds the choruses as the music that comes back loudest, and the verses between', () => {
    const chorusPhrases = truth.map((t, p) => [t, p] as const).filter(([t]) => t === 'Chorus').map(([, p]) => p);
    const right = chorusPhrases.filter((p) => label(p) === 'Chorus').length;
    expect(right / chorusPhrases.length).toBeGreaterThan(0.8);
    const versePhrases = truth.map((t, p) => [t, p] as const).filter(([t]) => t === 'Verse').map(([, p]) => p);
    expect(versePhrases.filter((p) => label(p) === 'Verse' || label(p) === 'Build').length / versePhrases.length).toBeGreaterThan(0.7);
    // The choruses are one group, and each return counts.
    const groups = new Set(chorusPhrases.map((p) => form.sections[form.sectionOf[p]].group));
    expect(groups.size).toBe(1);
  });

  it('starts with the intro; the late part like nothing else is the bridge', () => {
    expect(label(0)).toBe('Intro');
    const bridgeAt = truth.indexOf('Bridge');
    expect(label(bridgeAt + 1)).toBe('Bridge');
  });

  it('gives the chorus more density than the verse, the last chorus the most, and the fade none', () => {
    const at = (name: string, nth = 0) => { const p = truth.indexOf(name) + nth * 0; return form.intensity[p + 1]; };
    expect(at('Chorus')).toBeGreaterThan(at('Verse') * 1.15);
    expect(at('Verse')).toBeGreaterThan(at('Intro'));
    const choruses = form.sections.filter((s) => s.label === 'Chorus');
    expect(choruses[choruses.length - 1].last).toBe(true);
    expect(choruses[choruses.length - 1].intensity).toBeGreaterThan(choruses[0].intensity);
    expect(form.fadeFrom).toBe(truth.indexOf('Fade'));
    expect(form.intensity[ph.length - 1]).toBe(0);
    // The song's average is 1: the star calibration sets the density, the form only shares it out.
    const live = form.intensity.filter((x) => x > 0);
    expect(live.reduce((a, b) => a + b, 0) / live.length).toBeCloseTo(1, 5);
  });

  it('a quiet outro that keeps its beat is no fade (human charts play it to the end)', () => {
    const quiet = { ...part('Outro', 0.12, 0.6, 0, 6, 3) };
    const { ph: ph2 } = song([intro, verse, chorus, verse, chorus, quiet]);
    for (const f of ph2.slice(-3)) f.sounds = 1; // the beat goes on
    expect(songForm(ph2).fadeFrom).toBe(Infinity);
  });

  it('reports its sections in beats, neighbours of one kind merged', () => {
    const rep = reportSections(form, (p) => p * 8);
    expect(rep[0]).toEqual({ label: 'Intro', beat: 0 });
    for (let i = 1; i < rep.length; i++) expect(rep[i].beat).toBeGreaterThan(rep[i - 1].beat);
    expect(rep.some((s) => s.label.startsWith('Chorus'))).toBe(true);
  });

  it('a song too short for a form is one section', () => {
    const tiny = songForm(ph.slice(0, 3));
    expect(tiny.sections).toHaveLength(1);
    expect(tiny.intensity.every((x) => x === 1)).toBe(true);
  });
});
