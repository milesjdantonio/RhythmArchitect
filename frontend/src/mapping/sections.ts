// The song's form: where its sections start and what each is (intro, verse, build, chorus, bridge,
// break, outro), from what the song repeats and how it builds and releases, not from loudness alone.
// Before, sections were 8-bar blocks labelled by how loud they were (automap.ts), so a loud verse
// was a "Chorus" and a quiet bridge looked like a break.
//
// Human charters plan a chart by its sections first (osu!mania's ranking criteria: "intense parts
// have more rhythm density than calm parts"; mappers mark sections and give equal sections the same
// rhythm): so the charts take each section's intensity (leadline.ts), the visuals its label.
// Measured on human charts (Nov 21): their density moves with the song about twice as much as ours
// did (a 4-bar window's spread, CV, 0.34-0.57 on pop songs' charts against our 0.12-0.31), and as
// much on Easy as on Hard (a mapper's own ladder: 0.30/0.27/0.29, 0.59/0.49); it follows how busy
// the music is (loudness, drums, singing), and a chorus isn't always the densest part (Hotline
// Bling's sung hook is charted lighter than its verses). So a section's intensity is how busy it
// is, held through the section, with the label only adding a little on top (each chorus return a
// little more, the last the most).
//
// Pure functions: the phrases (2 bars on the beat map) come in with what was heard in each.

import type { MapReport, SoundEvent } from '../api/types';
import type { DecodedLevels } from './levels';

export type SectionLabel = 'Intro' | 'Verse' | 'Build' | 'Chorus' | 'Bridge' | 'Break' | 'Outro';

/** What was heard in one phrase (two bars). */
export interface PhraseFeatures {
  /** Loudness, 0..1 (the levels' mean over the phrase). */
  energy: number;
  /** The bass band's loudness, 0..1. */
  bass: number;
  /** Kick and snare a beat (strength). */
  drums: number;
  /** Sung syllables a beat. */
  sung: number;
  /** Every sound's strength a beat (how busy it is). */
  sounds: number;
  /** Its sounds' fingerprint: rhythm by band, harmony (repeats.ts's). */
  print: Float64Array;
  /** The singing's fingerprint: its rhythm (8ths) and tune (pitch classes), where it's sung. */
  voice?: Float64Array;
}

export interface Section {
  label: SectionLabel;
  /** Phrases [from, to). */
  from: number;
  to: number;
  /** Sections that are the same music share a group; `nth` counts its returns (0 the first). */
  group: number;
  nth: number;
  /** How dense its charts are against the song's average (1). */
  intensity: number;
  /** The song's last chorus (its densest moment). */
  last?: boolean;
  /** It starts with a drop: a lift after a build or a break, the bass and drums jumping in. */
  drop?: boolean;
}

export interface SongForm {
  sections: Section[];
  /** Each phrase's section (index into `sections`). */
  sectionOf: number[];
  /** Each phrase's intensity (its section's, a build ramping up through it, a fade trailing off). */
  intensity: number[];
  /** Phrases in a build: rising toward the drop after them (0..1 of the way). */
  build: Map<number, number>;
  /** The phrase where the song has faded out: no tiles from here (Infinity if it doesn't fade). */
  fadeFrom: number;
  /** How alike two phrases are (0 a typical pair of the song's, 1 its most alike). */
  similarity: (i: number, j: number) => number;
}

/**
 * How a section's intensity is made: `contrast`, how far its busyness moves its density (busyness:
 * its loudness, drums, singing and sounds, as z-scores, weighted by `busy`); `label`, on top, by its
 * kind; each return of the chorus `growth` more, the last `last`.
 */
export const FORM = {
  // Swept against the human charts of three songs (7 charts, Nov 21): how well our density curve
  // follows theirs (r, Hard and Ultra) went 0.20 with no form → 0.42 with this; the old rank-by-
  // loudness lean 0.27. The loudness counts most (alone 0.38; the drums alone 0.28, the singing
  // 0.25); the labels add (0.34 → 0.42). Contrast 0.5-0.7 all came out the same; more overshoots.
  contrast: 0.55,
  busy: { energy: 0.85, drums: 0, sung: 0, sounds: 0.15 },
  label: { Intro: 0.75, Verse: 0.92, Build: 0.95, Chorus: 1.07, Bridge: 0.85, Break: 0.75, Outro: 0.78 } as Record<SectionLabel, number>,
  growth: 0.04,
  last: 1.15,
};
/** Section lengths (phrases of 2 bars) and what each costs: 8 and 16 bars are the usual. */
const LENGTH_COST: Record<number, number> = { 2: 0.55, 3: 0.75, 4: 0, 5: 0.7, 6: 0.35, 7: 0.75, 8: 0.15 };
const MAX_LEN = 8;
/** A boundary costs this (in novelty's units): fewer, longer sections unless the song changes. */
const BOUNDARY_COST = 0.9;
/** Phrases this alike (0 a typical pair, 1 the song's most alike) are the same music. */
const SAME = 0.55;
/** A repeat (a diagonal of the phrases' likeness) at least this many phrases long marks its ends as boundaries. */
const STRIPE_MIN = 3;
/** Sections this far apart in loudness (0..1 of the song's range) aren't the same music, even on the same chords. */
const SAME_LOUD = 0.3;
/** A build: energy rising at least this much (0..1 of the song's range) through it. */
const BUILD_RISE = 0.12;
/** A drop: the bass or drums jumping at least this much (against the song's spread) at a section start. */
const DROP_JUMP = 1.0;
/** A fade: the song this quiet (against its median) and this sparse (its sounds against their median) to the end. */
const FADE = 0.45;
const FADE_SOUNDS = 0.3;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) || 1e-9; };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
const z = (xs: number[]) => { const m = mean(xs), s = std(xs); return xs.map((x) => (x - m) / s); };

function cos(a: Float64Array, b: Float64Array) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

/** The song's form from its phrases. */
export function songForm(ph: PhraseFeatures[]): SongForm {
  const n = ph.length;
  if (n < 4) {
    const one: Section = { label: 'Verse', from: 0, to: n, group: 0, nth: 0, intensity: 1 };
    return { sections: [one], sectionOf: new Array(n).fill(0), intensity: new Array(n).fill(1), build: new Map(), fadeFrom: Infinity, similarity: () => 0 };
  }
  const E = ph.map((p) => p.energy), B = ph.map((p) => p.bass), K = ph.map((p) => p.drums), V = ph.map((p) => Math.sqrt(p.sung)), S = ph.map((p) => p.sounds);
  const sE = std(E), sB = std(B), sK = std(K), sV = std(V);
  const loE = Math.min(...E), hiE = Math.max(...E), rangeE = hiE - loE || 1;

  // How alike two phrases are: their sounds, and their singing where both are sung (one sung and one
  // not are different music); then against the song's own spread (a pop song's phrases are all
  // alike in their beat): 0 a typical pair, 1 the most alike pairs.
  const raw = (i: number, j: number) => {
    const a = cos(ph[i].print, ph[j].print);
    const vi = ph[i].voice, vj = ph[j].voice;
    if (vi && vj) return 0.4 * a + 0.6 * cos(vi, vj);
    return vi || vj ? 0.6 * a : a;
  };
  const M = Array.from({ length: n }, () => new Float64Array(n));
  const pairs: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) { const v = raw(i, j); M[i][j] = M[j][i] = v; if (j - i >= 2) pairs.push(v); }
  pairs.sort((a, b) => a - b);
  const typical = pairs[pairs.length >> 1] ?? 0, top = pairs[Math.floor(pairs.length * 0.95)] ?? 1;
  const sim = (i: number, j: number) => (M[i][j] - typical) / Math.max(1e-6, top - typical);

  // Repeats: runs along a diagonal (phrase i like phrase i + lag, for STRIPE_MIN phrases or more, a
  // phrase's slip forgiven). Where one starts or ends, in either copy, a section starts or ends;
  // less so inside a loop that goes on (each phrase like the one before).
  const stripe = new Array(n + 1).fill(0);
  for (let lag = 3; lag < n - 2; lag++) {
    for (let i = 0; i + lag < n;) {
      if (sim(i, i + lag) < SAME) { i++; continue; }
      let k = 1, slips = 0;
      while (i + k + lag < n && (sim(i + k, i + k + lag) >= SAME || (slips < 1 && sim(i + k, i + k + lag) >= 0.25 && i + k + 1 + lag < n && sim(i + k + 1, i + k + 1 + lag) >= SAME))) {
        if (sim(i + k, i + k + lag) < SAME) slips++;
        k++;
      }
      if (k >= STRIPE_MIN) {
        const w = Math.min(1.5, k / 4);
        for (const b of [i, i + k, i + lag, i + lag + k]) if (b > 0 && b < n) stripe[b] = Math.max(stripe[b], w * Math.max(0, Math.min(1, 1 - sim(b - 1, b))));
      }
      i += k;
    }
  }

  // Novelty at each boundary (before phrase b): how much the song changes there, two phrases each side.
  const nov = new Array(n + 1).fill(0);
  for (let b = 1; b < n; b++) {
    const L = [b - 2, b - 1].filter((i) => i >= 0), R = [b, b + 1].filter((i) => i < n);
    const d = (xs: number[], s: number) => Math.abs(mean(R.map((i) => xs[i])) - mean(L.map((i) => xs[i]))) / s;
    const within = mean([...(L.length > 1 ? [sim(L[0], L[1])] : []), ...(R.length > 1 ? [sim(R[0], R[1])] : [])]);
    const across = mean(L.flatMap((i) => R.map((j) => sim(i, j))));
    nov[b] = 0.9 * d(E, sE) + 0.5 * d(K, sK) + 0.8 * d(V, sV) + 0.3 * d(B, sB) + 1.2 * Math.max(0, within - across) + 1.2 * stripe[b];
  }

  // The best cut: sections of 2 to 8 phrases, each start's novelty gained, lengths and boundaries paid for.
  const best = new Array(n + 1).fill(-Infinity), from = new Array(n + 1).fill(0);
  best[0] = 0;
  for (let e = 1; e <= n; e++) {
    for (let len = 1; len <= Math.min(MAX_LEN, e); len++) {
      const s = e - len;
      // A section of one phrase only at the very start or end (a pickup, a last hit).
      const cost = len === 1 ? (s === 0 || e === n ? 0.9 : Infinity) : LENGTH_COST[len] ?? 1;
      const v = best[s] + (s > 0 ? nov[s] - BOUNDARY_COST : 0) - cost;
      if (v > best[e]) { best[e] = v; from[e] = s; }
    }
  }
  let cuts: [number, number][] = [];
  for (let e = n; e > 0; e = from[e]) cuts.unshift([from[e], e]);

  // Which sections are the same music: phrase by phrase alike (over the shorter one's length), and
  // not far apart in loudness (a verse and a chorus on the same chords).
  const secMean = (xs: number[], c: [number, number]) => mean(xs.slice(c[0], c[1]));
  const alike = (a: [number, number], b: [number, number]) => {
    const len = Math.min(a[1] - a[0], b[1] - b[0]);
    if (len < 2 || Math.abs(secMean(E, a) - secMean(E, b)) > SAME_LOUD * rangeE) return -Infinity;
    let s = 0;
    for (let k = 0; k < len; k++) s += sim(a[0] + k, b[0] + k);
    return s / len;
  };
  const grouping = () => {
    const g: number[] = [];
    let count = 0;
    for (let i = 0; i < cuts.length; i++) {
      let at = -1, bestSim = SAME;
      for (let j = 0; j < i; j++) { const s = alike(cuts[j], cuts[i]); if (s > bestSim) { bestSim = s; at = g[j]; } }
      g.push(at >= 0 ? at : count++);
    }
    return g;
  };
  let group = grouping();
  // The same music twice in a row is one section (a chorus that sings its line twice).
  const merged: [number, number][] = [];
  for (let i = 0; i < cuts.length; i++) {
    const last = merged[merged.length - 1];
    if (last && i > 0 && group[i] === group[i - 1] && cuts[i][1] - last[0] <= MAX_LEN) last[1] = cuts[i][1];
    else merged.push([...cuts[i]]);
  }
  cuts = merged;
  group = grouping();

  const secE = cuts.map((c) => secMean(E, c)), secK = cuts.map((c) => secMean(K, c)), secV = cuts.map((c) => secMean(V, c));
  const medE = median(E);
  // How busy each phrase is (loudness, drums, singing, sounds), then each section's (its mean).
  const zE = z(E), zK = z(K), zV = z(V), zS = z(S);
  const w = FORM.busy;
  const busy = E.map((_, p) => w.energy * zE[p] + w.drums * zK[p] + w.sung * zV[p] + w.sounds * zS[p]);
  const secBusy = cuts.map((c) => secMean(busy, c));
  const returns = new Map<number, number>();
  for (const g of group) returns.set(g, (returns.get(g) ?? 0) + 1);

  // The chorus: of the music that comes back (twice or more), the one that comes back most, sung,
  // busy; if nothing comes back, none.
  const zSec = (xs: number[]) => { const m = mean(xs), s = std(xs); return (g: number) => mean(cuts.map((_, i) => i).filter((i) => group[i] === g).map((i) => (xs[i] - m) / s)); };
  const gBusy = zSec(secBusy), gV = zSec(secV);
  const candidates = [...returns].filter(([, c]) => c >= 2).map(([g]) => g);
  const score = (g: number) => 0.7 * (returns.get(g) ?? 0) + 1.0 * gBusy(g) + 0.5 * gV(g);
  const chorusGroup = candidates.filter((g) => gBusy(g) > -0.3).sort((a, b) => score(b) - score(a))[0] ?? -1;
  const isChorus = (i: number) => chorusGroup >= 0 && group[i] === chorusGroup;
  const choruses = cuts.map((_, i) => i).filter(isChorus);
  const firstChorus = choruses[0] ?? cuts.length;
  const lastChorus = choruses[choruses.length - 1] ?? -1;
  const quietOf = (i: number) => secE[i] < medE * 0.7 || secK[i] < 0.25 * mean(K);
  const labels: SectionLabel[] = cuts.map((c, i) => {
    if (isChorus(i)) return 'Chorus';
    if (i === 0 && cuts.length > 2 && (quietOf(i) || secV[i] < 0.4 * mean(V) || i < firstChorus) && secBusy[i] < 0.3) return 'Intro';
    if (i === cuts.length - 1 && i > lastChorus && cuts.length > 2) return 'Outro';
    if (quietOf(i)) return 'Break';
    // A part right before a chorus that rises into it.
    if (isChorus(i + 1) && c[1] - c[0] <= 4 && E[c[1] - 1] - E[c[0]] >= BUILD_RISE * rangeE) return 'Build';
    // Late, after the second chorus, and like nothing else: the bridge.
    if ((returns.get(group[i]) ?? 1) === 1 && choruses.length >= 2 && i > choruses[1] && i < lastChorus) return 'Bridge';
    return 'Verse';
  });
  // The intro runs on while the song hasn't started; the outro is everything quiet after the last chorus.
  for (let i = 1; i < cuts.length && labels[i] === 'Break' && labels[i - 1] === 'Intro'; i++) labels[i] = 'Intro';
  for (let i = cuts.length - 1; i > lastChorus && i > 0 && (labels[i] === 'Break' || labels[i] === 'Outro'); i--) labels[i] = 'Outro';

  // The fade: from where the song stays quiet and sparse to the end (a quiet outro that still plays
  // its beat isn't one: human charts play Hotline Bling's to the end).
  const medS = median(S);
  let fadeFrom = Infinity;
  for (let p = n - 1; p >= Math.floor(n * 0.75); p--) { if (E[p] < medE * FADE && S[p] < medS * FADE_SOUNDS) fadeFrom = p; else break; }

  // Each section's intensity: how busy it is, held through it, and a little by its kind.
  const nth = new Map<number, number>();
  let chorusSeen = 0;
  const sections: Section[] = cuts.map(([a, b], i) => {
    const k = nth.get(group[i]) ?? 0;
    nth.set(group[i], k + 1);
    const label = labels[i];
    let kind = FORM.label[label];
    const last = label === 'Chorus' && i === lastChorus && choruses.length >= 2;
    if (label === 'Chorus') { kind = last ? FORM.last : kind + FORM.growth * chorusSeen; chorusSeen++; }
    return { label, from: a, to: b, group: group[i], nth: k, intensity: Math.exp(FORM.contrast * secBusy[i]) * kind, ...(last ? { last: true } : {}) };
  });
  // Drops: a section starting with the bass and drums jumping in after a build or a break.
  for (let i = 1; i < sections.length; i++) {
    const s = sections[i], prev = sections[i - 1];
    const jump = Math.max((B[s.from] - B[s.from - 1]) / sB, (K[s.from] - K[s.from - 1]) / sK);
    if (jump >= DROP_JUMP && (prev.label === 'Build' || prev.label === 'Break' || prev.label === 'Intro' || (s.label === 'Chorus' && E[s.from] > E[s.from - 1]))) s.drop = true;
  }
  const sectionOf = new Array(n).fill(0);
  sections.forEach((s, i) => { for (let p = s.from; p < s.to; p++) sectionOf[p] = i; });
  // A build ramps up through itself toward the drop's intensity; so do the last two phrases of a
  // verse before a drop.
  const build = new Map<number, number>();
  const intensity = sectionOf.map((i) => sections[i].intensity);
  sections.forEach((s, i) => {
    const next = sections[i + 1];
    if (!next || !(s.label === 'Build' || (next.drop && s.label === 'Verse'))) return;
    const a = s.label === 'Build' ? s.from : Math.max(s.from, s.to - 2), len = s.to - a;
    for (let p = a; p < s.to; p++) {
      const f = (p - a + 1) / (len + 1);
      build.set(p, f);
      intensity[p] = Math.max(intensity[p], s.intensity + (next.intensity - s.intensity) * f * 0.8);
    }
  });
  // The fade: nothing.
  for (let p = fadeFrom; p < n; p++) intensity[p] = 0;
  // The song's average at 1 (the star calibration sets the overall density; this only shares it out).
  const avg = mean(intensity.filter((x) => x > 0)) || 1;
  for (let p = 0; p < n; p++) intensity[p] /= avg;
  for (const s of sections) s.intensity /= avg;
  return { sections, sectionOf, intensity, build, fadeFrom, similarity: sim };
}

export interface FormInput {
  /** The sounds (automap.ts), with their parts where the song was split. */
  events: Pick<SoundEvent, 'sec' | 'band' | 'strength' | 'midi' | 'part' | 'accent'>[];
  /** Sung syllables' starts (s) and pitches. */
  voice?: { sec: number; midi?: number | null }[];
  levels?: DecodedLevels;
  /** Phrases: how many, where each starts (s), beats a phrase, and a moment's place in its phrase (0..1). */
  phrases: number;
  startOf: (p: number) => number;
  beatsPerPhrase: number;
  phraseAt: (sec: number) => { p: number; at: number };
}

/** What was heard in each phrase: its loudness, bass, drums, singing, sounds and fingerprints. */
export function phraseFeatures(o: FormInput): PhraseFeatures[] {
  const n = o.phrases, slots = o.beatsPerPhrase * 4, size = slots * 3 + 12;
  const out: PhraseFeatures[] = Array.from({ length: n }, () => ({ energy: 0, bass: 0, drums: 0, sung: 0, sounds: 0, print: new Float64Array(size) }));
  const split = o.events.some((e) => e.part);
  for (const e of o.events) {
    const { p, at } = o.phraseAt(e.sec);
    if (p < 0 || p >= n) continue;
    const f = out[p];
    const slot = Math.min(slots - 1, Math.max(0, Math.round(at * slots)));
    const band = e.band === 'low' ? 0 : e.band === 'mid' ? 1 : 2;
    f.print[slot * 3 + band] += e.strength;
    f.sounds += e.strength;
    if (e.midi != null) f.print[slots * 3 + (((Math.round(e.midi) % 12) + 12) % 12)] += e.strength * 0.5;
    // The drums: the kick and snare where the song was split, else the low and mid attacks.
    if (split ? e.part === 'drums' && e.band !== 'high' : e.band !== 'high' && e.midi == null) f.drums += e.strength;
  }
  // The singing: its rhythm (to an 8th) and its tune (pitch classes): a chorus is its melody coming back.
  const vSlots = o.beatsPerPhrase * 2;
  for (const s of o.voice ?? []) {
    const { p, at } = o.phraseAt(s.sec);
    if (p < 0 || p >= n) continue;
    const f = out[p];
    f.sung++;
    f.voice ??= new Float64Array(vSlots + 12);
    f.voice[Math.min(vSlots - 1, Math.max(0, Math.round(at * vSlots)))] += 1;
    if (s.midi != null) f.voice[vSlots + (((Math.round(s.midi) % 12) + 12) % 12)] += 1;
  }
  for (const f of out) { f.drums /= o.beatsPerPhrase; f.sung /= o.beatsPerPhrase; f.sounds /= o.beatsPerPhrase; }
  const L = o.levels;
  for (let p = 0; p < n; p++) {
    if (L) {
      const i0 = Math.max(0, Math.floor(o.startOf(p) * L.rate)), i1 = Math.min(L.bass.length, Math.ceil(o.startOf(p + 1) * L.rate));
      let s = 0, b = 0;
      for (let i = i0; i < i1; i++) { s += L.bass[i] + L.mid[i] + L.high[i]; b += L.bass[i]; }
      out[p].energy = i1 > i0 ? s / (i1 - i0) / 765 : 0;
      out[p].bass = i1 > i0 ? b / (i1 - i0) / 255 : 0;
    } else {
      // Without the loudness curve: the sounds' strength a beat (the low band's for the bass).
      let b = 0;
      for (let k = 0; k < slots; k++) b += out[p].print[k * 3];
      out[p].energy = out[p].sounds;
      out[p].bass = b / o.beatsPerPhrase;
    }
  }
  if (!L) {
    const top = Math.max(...out.map((f) => f.energy)) || 1, topB = Math.max(...out.map((f) => f.bass)) || 1;
    for (const f of out) { f.energy /= top; f.bass /= topB; }
  }
  return out;
}

/** The form as the report's sections (beats), neighbours of the same kind merged (a drop starts its own). */
export function reportSections(form: SongForm, beatOfPhrase: (p: number) => number): MapReport['sections'] {
  const out: MapReport['sections'] = [];
  let last: Section | null = null;
  for (const s of form.sections) {
    if (last && last.label === s.label && last.to === s.from && !(s.drop && s.label === 'Chorus')) { last = s; continue; }
    out.push({ label: s.drop && s.label === 'Chorus' ? 'Chorus (drop)' : s.label, beat: Math.max(0, Math.round(beatOfPhrase(s.from) * 1000) / 1000) });
    last = s;
  }
  return out;
}
