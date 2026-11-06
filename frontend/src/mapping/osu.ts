// Fan-made charts from osu! (the fallback when the browser can't listen to a song itself).
// osu!mania 4K is the same game as ours: four lanes, taps and holds, each placed by a person on
// a sound in the song. Other key counts are folded onto four lanes; osu! standard maps are
// converted (circles become taps, sliders and spinners holds), the way osu! itself does.
//
// The chart's times are milliseconds into the fan's copy of the audio. The song plays from
// YouTube instead, so `source.offset` lines the two up (assumed equal; the Map Syncer,
// src/audio/syncer.ts, moves it when the player's hits say it's off).
//
// Pure functions over the .osu text: they run in the mock server, the real backend or a test.

import type { Chart, ChartNote, Difficulty, MapReport, NewSong } from '../api/types';
import { RULES } from './charts';

export interface OsuTiming {
  ms: number;
  /** Milliseconds per beat (uninherited), or a negative speed multiplier (inherited, -100 = 1x). */
  beatLength: number;
  meter: number;
  uninherited: boolean;
  kiai: boolean;
}

export interface OsuObject {
  x: number;
  ms: number;
  type: number;
  /** Hold notes and spinners: when they end. */
  endMs?: number;
  /** Sliders: how many times it runs, and its length in osu! pixels. */
  slides?: number;
  length?: number;
}

export interface OsuMap {
  /** 0 standard, 1 taiko, 2 catch, 3 mania. */
  mode: number;
  /** Mania: the key count (CircleSize). */
  keys: number;
  title: string;
  artist: string;
  creator: string;
  version: string;
  beatmapId: number;
  setId: number;
  sliderMultiplier: number;
  timing: OsuTiming[];
  objects: OsuObject[];
  /** Break periods [start, end] in ms. */
  breaks: [number, number][];
}

/** Reads a .osu file (format v3-v14). */
export function parseOsu(text: string): OsuMap {
  const map: OsuMap = { mode: 0, keys: 4, title: '', artist: '', creator: '', version: '', beatmapId: 0, setId: 0, sliderMultiplier: 1.4, timing: [], objects: [], breaks: [] };
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const head = /^\[(\w+)\]$/.exec(line);
    if (head) { section = head[1]; continue; }
    if (section === 'General' || section === 'Metadata' || section === 'Difficulty') {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
      if (k === 'Mode') map.mode = Number(v) || 0;
      else if (k === 'Title') map.title = v;
      else if (k === 'Artist') map.artist = v;
      else if (k === 'Creator') map.creator = v;
      else if (k === 'Version') map.version = v;
      else if (k === 'BeatmapID') map.beatmapId = Number(v) || 0;
      else if (k === 'BeatmapSetID') map.setId = Number(v) || 0;
      else if (k === 'CircleSize') map.keys = Math.round(Number(v)) || 4;
      else if (k === 'SliderMultiplier') map.sliderMultiplier = Number(v) || 1.4;
    } else if (section === 'Events') {
      const f = line.split(',');
      if ((f[0] === '2' || f[0] === 'Break') && f.length >= 3) map.breaks.push([Number(f[1]), Number(f[2])]);
    } else if (section === 'TimingPoints') {
      const f = line.split(',');
      if (f.length < 2) continue;
      const beatLength = Number(f[1]);
      const effects = Number(f[7] ?? 0);
      map.timing.push({
        ms: Number(f[0]),
        beatLength,
        meter: Number(f[2] ?? 4) || 4,
        // Old files have no "uninherited" column: a positive beat length means a red line.
        uninherited: f[6] !== undefined ? f[6] === '1' : beatLength > 0,
        kiai: (effects & 1) === 1,
      });
    } else if (section === 'HitObjects') {
      const f = line.split(',');
      if (f.length < 4) continue;
      const type = Number(f[3]);
      const o: OsuObject = { x: Number(f[0]), ms: Number(f[2]), type };
      if (type & 128) o.endMs = Number((f[5] ?? '').split(':')[0]); // mania hold: endTime:hitSample
      else if (type & 8) o.endMs = Number(f[5]); // spinner
      else if (type & 2) { o.slides = Number(f[6]) || 1; o.length = Number(f[7]) || 0; }
      if (Number.isFinite(o.ms)) map.objects.push(o);
    }
  }
  map.timing.sort((a, b) => a.ms - b.ms);
  map.objects.sort((a, b) => a.ms - b.ms);
  return map;
}

/** A tile in the fan chart's time: milliseconds into its audio, on one of four lanes. */
export interface FanNote {
  ms: number;
  lane: number;
  endMs?: number;
}

/** Holds shorter than this are just taps. */
const MIN_HOLD_MS = 120;

/** The red line (tempo) in force at `ms`, and the green line (slider speed) if any. */
function timingAt(map: OsuMap, ms: number) {
  let red = map.timing.find((t) => t.uninherited) ?? { ms: 0, beatLength: 500, meter: 4, uninherited: true, kiai: false };
  let sv = 1;
  for (const t of map.timing) {
    if (t.ms > ms + 1) break;
    if (t.uninherited) { red = t; sv = 1; } else if (t.beatLength < 0) sv = Math.min(10, Math.max(0.1, -100 / t.beatLength));
  }
  return { red, sv };
}

/** The map's tiles on four lanes: mania columns folded onto 4, or a standard map converted. */
export function fanNotes(map: OsuMap): FanNote[] {
  const out: FanNote[] = [];
  if (map.mode === 3) {
    const K = Math.max(1, map.keys);
    for (const o of map.objects) {
      const col = Math.min(K - 1, Math.max(0, Math.floor((o.x * K) / 512)));
      const lane = K === 4 ? col : Math.min(3, Math.floor((col * 4) / K));
      const hold = (o.type & 128) && o.endMs && o.endMs - o.ms >= MIN_HOLD_MS;
      out.push({ ms: o.ms, lane, ...(hold ? { endMs: o.endMs } : {}) });
    }
  } else {
    // Standard (and the others, read the same way): one tile per object, its lane from where it
    // sits across the playfield; sliders and spinners are held as long as they last.
    for (const o of map.objects) {
      const lane = Math.min(3, Math.max(0, Math.floor((o.x * 4) / 512)));
      let endMs: number | undefined;
      if (o.type & 8) endMs = o.endMs;
      else if (o.type & 2) {
        const { red, sv } = timingAt(map, o.ms);
        const perSlide = ((o.length ?? 0) / (map.sliderMultiplier * 100 * sv)) * red.beatLength;
        endMs = o.ms + perSlide * (o.slides ?? 1);
      }
      out.push({ ms: o.ms, lane, ...(endMs && endMs - o.ms >= MIN_HOLD_MS ? { endMs: Math.round(endMs) } : {}) });
    }
  }
  return clean(out);
}

/** One tile per lane at a time: drops duplicates and tiles that start under a hold in their lane. */
function clean(notes: FanNote[]): FanNote[] {
  notes.sort((a, b) => a.ms - b.ms || a.lane - b.lane);
  const busy = [-Infinity, -Infinity, -Infinity, -Infinity];
  const last = [-Infinity, -Infinity, -Infinity, -Infinity];
  const out: FanNote[] = [];
  for (const n of notes) {
    if (n.ms <= busy[n.lane] + 30 || n.ms - last[n.lane] < 30) continue;
    out.push(n);
    last[n.lane] = n.ms;
    busy[n.lane] = n.endMs ?? n.ms;
  }
  return out;
}

/** The tempo that covers most of the song, and where its first beat falls. */
export function beatGrid(map: OsuMap, notes: FanNote[]): { bpm: number; beat0Ms: number; meter: number } {
  const reds = map.timing.filter((t) => t.uninherited && t.beatLength > 0);
  const end = notes.length ? notes[notes.length - 1].endMs ?? notes[notes.length - 1].ms : 0;
  let best = reds[0] ?? { ms: 0, beatLength: 500, meter: 4, uninherited: true, kiai: false }, span = -1;
  reds.forEach((r, i) => {
    const s = (reds[i + 1]?.ms ?? end) - r.ms;
    if (s > span) { span = s; best = r; }
  });
  const meter = best.meter || 4;
  // Beat 0 on a bar line of that tempo, at or before the first tile.
  const bar = best.beatLength * meter;
  const first = notes[0]?.ms ?? best.ms;
  let beat0Ms = best.ms;
  if (beat0Ms > first) beat0Ms -= Math.ceil((beat0Ms - first) / bar) * bar;
  return { bpm: 60000 / best.beatLength, beat0Ms, meter };
}

/** Tiles per second while the song is playing (breaks and silences of 4 s+ left out). */
export function density(notes: FanNote[]): number {
  if (notes.length < 2) return notes.length;
  let active = 0;
  for (let i = 1; i < notes.length; i++) active += Math.min(4000, notes[i].ms - notes[i - 1].ms);
  return notes.length / Math.max(1, active / 1000);
}

const LANE_PITCH = ['C4', 'E4', 'G4', 'C5'];

/** How strongly a tile sits on the beat: downbeats first, then beats, 8ths, 16ths. */
function strength(t: number, meter: number, hold: boolean, chord: number) {
  const r = (g: number) => Math.abs(t / g - Math.round(t / g)) < 0.04;
  const grid = r(meter) ? 1 : r(1) ? 0.8 : r(0.5) ? 0.6 : r(0.25) ? 0.4 : 0.25;
  return grid + (hold ? 0.15 : 0) + (chord > 1 ? 0.1 : 0);
}

/**
 * A fan chart (in beats) shaped to one of our difficulties: Easy and Medium keep the tiles that
 * sit most on the beat, spaced as RULES says, one at a time, with holds only where they're long.
 * Nothing is moved or added: every tile is still one the fan placed on a sound.
 */
export function shapeChart(notes: ChartNote[], difficulty: Difficulty, bpm: number, meter: number): Chart {
  const rule = RULES[difficulty];
  if (difficulty === 'hard') return { difficulty, lanes: 4, notes };
  const f = bpm > 150 ? 2 : bpm > 125 ? 1.5 : 1;
  const minGap = rule.minGap * f;
  const chordSize = new Map<number, number>();
  for (const n of notes) chordSize.set(n.t, (chordSize.get(n.t) ?? 0) + 1);
  const ranked = notes
    .map((n, i) => ({ n, i, s: strength(n.t, meter, !!n.hold, chordSize.get(n.t) ?? 1) }))
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const kept: ChartNote[] = [];
  const fits = (n: ChartNote) => kept.every((k) => {
    const kEnd = k.t + (k.hold ? k.len : 0), nEnd = n.t + (n.hold ? n.len : 0);
    // Nothing while a hold is down, and the minimum gap between tiles.
    if (n.t >= k.t && n.t < kEnd + minGap * 0.5) return false;
    if (k.t >= n.t && k.t < nEnd + minGap * 0.5) return false;
    return Math.abs(k.t - n.t) >= minGap - 1e-6;
  });
  for (const { n } of ranked) {
    const shaped: ChartNote = n.hold && n.len < rule.holdMin ? { ...n, hold: undefined, len: Math.min(n.len, 0.5) } : n;
    if (fits(shaped)) kept.push(shaped);
  }
  kept.sort((a, b) => a.t - b.t || a.lane - b.lane);
  return { difficulty, lanes: 4, notes: kept.map(({ hold, ...rest }) => (hold ? { ...rest, hold } : rest)) };
}

/** Rough sections from the fan chart: kiai (the chart's highlight) is a chorus, breaks are breaks. */
function sectionsFor(map: OsuMap, toBeat: (ms: number) => number, lastBeat: number, meter: number): MapReport['sections'] {
  const marks: { beat: number; label: string }[] = [{ beat: 0, label: 'Intro' }];
  let inKiai = false;
  for (const t of map.timing) {
    if (t.kiai !== inKiai) {
      inKiai = t.kiai;
      marks.push({ beat: toBeat(t.ms), label: inKiai ? 'Chorus' : 'Verse' });
    }
  }
  for (const [a, b] of map.breaks) {
    marks.push({ beat: toBeat(a), label: 'Break' });
    marks.push({ beat: toBeat(b), label: 'Verse' });
  }
  const out: MapReport['sections'] = [];
  for (const m of marks.sort((a, b) => a.beat - b.beat)) {
    const beat = Math.max(0, Math.round(m.beat / meter) * meter);
    if (beat >= lastBeat) continue;
    if (out.length && out[out.length - 1].beat === beat) out[out.length - 1] = { label: m.label, beat };
    else if (out[out.length - 1]?.label !== m.label) out.push({ label: m.label, beat });
  }
  if (out.length === 1 && lastBeat > 64) {
    // No kiai or breaks: a verse after the intro, so the visuals still move on.
    out.push({ label: 'Verse', beat: Math.min(lastBeat - 1, 8 * meter) });
  }
  return out;
}

/** Two hues from a name, so every song has its own colours. */
export function huesFor(name: string): [number, number] {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = h % 360;
  return [a, (a + 80) % 360];
}

export interface FanSongOptions {
  title: string;
  artist: string;
  videoId: string;
  /** The video's length in seconds (the song runs to the end of it). */
  seconds?: number;
}

/**
 * A playable song from one beatmap set's difficulties (already parsed): the hardest one up to
 * about 7 tiles a second is Hard, the easiest is Easy, one between is Medium. With fewer than
 * three, the missing ones are shaped from the hardest.
 */
export function fanSong(maps: OsuMap[], opts: FanSongOptions): NewSong {
  const usable = maps.map((m) => ({ m, notes: fanNotes(m) })).filter((x) => x.notes.length >= 16);
  if (!usable.length) throw new Error('That fan chart has no playable tiles.');
  usable.sort((a, b) => density(a.notes) - density(b.notes));
  const hardIdx = Math.max(0, usable.reduce((k, x, i) => (density(x.notes) <= 7 ? i : k), 0));
  const hard = usable[hardIdx];
  const easy = usable[0] === hard ? hard : usable[0];
  const mids = usable.slice(1, hardIdx);
  const medium = mids.length ? mids[Math.floor(mids.length / 2)] : hard;
  const { bpm, beat0Ms, meter } = beatGrid(hard.m, hard.notes);
  const spbMs = 60000 / bpm;
  const toBeat = (ms: number) => (ms - beat0Ms) / spbMs;
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  const toChart = (notes: FanNote[]): ChartNote[] => notes.map((n) => {
    const t = r4(toBeat(n.ms));
    const len = n.endMs ? r4((n.endMs - n.ms) / spbMs) : 0.25;
    return { t, lane: n.lane, pitch: LANE_PITCH[n.lane], len, ...(n.endMs ? { hold: true } : {}) };
  });
  const charts: Record<Difficulty, Chart> = {
    easy: shapeChart(toChart(easy.notes), 'easy', bpm, meter),
    medium: shapeChart(toChart(medium.notes), 'medium', bpm, meter),
    hard: shapeChart(toChart(hard.notes), 'hard', bpm, meter),
  };
  const all = charts.hard.notes;
  const lastBeat = Math.max(...all.map((n) => n.t + (n.hold ? n.len : 0)));
  const videoBeats = opts.seconds ? (opts.seconds - beat0Ms / 1000) / (spbMs / 1000) : 0;
  const lengthBeats = r4(Math.max(lastBeat + 2, Math.min(videoBeats, lastBeat + 32)));
  // Energy: how busy the chart is across the song (48 points), smoothed.
  const energy = new Array(48).fill(0);
  for (const n of all) energy[Math.min(47, Math.max(0, Math.floor((n.t / lengthBeats) * 48)))] += 1;
  const peak = Math.max(1, ...energy);
  const smooth = energy.map((_, i) => (energy[Math.max(0, i - 1)] + energy[i] * 2 + energy[Math.min(47, i + 1)]) / 4 / peak);
  const sections = sectionsFor(hard.m, toBeat, lastBeat, meter);
  const m = hard.m;
  return {
    title: opts.title,
    artist: opts.artist,
    prompt: `${opts.title}${opts.artist ? ` by ${opts.artist}` : ''}`,
    bpm: Math.round(bpm * 1000) / 1000,
    meter,
    key: 'C',
    scale: 'Minor',
    mood: 'Fan chart',
    lengthBeats,
    hues: huesFor(`${opts.title} ${opts.artist}`.toLowerCase()),
    cover: `https://i.ytimg.com/vi/${opts.videoId}/mqdefault.jpg`,
    source: {
      kind: 'youtube', videoId: opts.videoId, chart: 'fan', offset: Math.round(beat0Ms) / 1000,
      credit: `Chart by ${m.creator || 'an osu! mapper'} on osu! (beatmap set ${m.setId}${usable.length > 1 ? `, ${usable.length} difficulties` : m.version ? `, “${m.version}”` : ''}). https://osu.ppy.sh/beatmapsets/${m.setId}`,
    },
    report: { mapper: `Fan chart by ${m.creator || 'an osu! mapper'} (osu!${m.mode === 3 ? `mania ${m.keys}K` : ' standard, converted'})`, confidence: 0.7, sections, energy: smooth.map((x) => Math.round(x * 100) / 100) },
    patch: { name: 'Glass Bell', oscillator: 'triangle', attack: 0.002, decay: 0.3, sustain: 0.05, release: 0.4, cutoff: 6000, space: 0.3 },
    backing: { bass: ['C2'], drums: '................' },
    charts,
  };
}
