// The trained mapper: Ensomi R2 (@ensomi/runtime, Apache-2.0; model sed-i/ensomi-r2, MIT), a model
// trained on human-made osu!mania 4K charts. It reads the heard audio and places the tiles itself.
// Runs in the mapping worker (listen.worker.ts); the audio stays in the browser.
//
// Its lowest star rating (2) is usually about as busy as this game's Ultra (the whole chart), so it
// charts the song at that rating (again, busier, when Ultra would have under about two tiles a
// beat: nextStar), and every difficulty keeps a subset of its tiles (thin.ts KEEP): Ultra nearly
// all of them (chords of two at most), Hard, Medium and Easy fewer. Its tiles come
// in milliseconds, a little early; they go onto the sounds the onset mapper measured and onto its
// beat grid (soundShift, toChart); its long notes are holds only where the sound rings (RING).

import { DIFFICULTIES, type Chart, type ChartNote, type ChartProgress, type Difficulty, type SoundEvent } from '../api/types';
import type { Ort } from './ort';
import { cachedSource } from './ensomiModel';
import { KEEP, thinChart } from './thin';
import { flowChart } from './lanes';
import { barOf, beatAt, beatMap, beatPlace, snapSec, type BeatMap } from './beatmap';
import { findRepeats, twinSec, type Repeats } from './repeats';
import { noteName, syllableAt, type Syllable } from './voice';

export { KEEP };
// The runtime finds these beside its own module, which a bundler moves; so they're handed to it.
import coreUrl from '../../node_modules/@ensomi/runtime/pkg/ensomi_generate_wasm_bg.wasm?url';
import table24 from '../../node_modules/@ensomi/runtime/resampler/resample-24000.bin?url';
import bound24 from '../../node_modules/@ensomi/runtime/resampler/resample-24000-boundary.bin?url';
import info24 from '../../node_modules/@ensomi/runtime/resampler/resample-24000.json?url';

/** The star rating the model charts at (R2 takes 2 up to 6). */
export const STAR = 2;
const DIFFS = DIFFICULTIES;
/** The same song makes the same charts. */
const SEED = 7;
/** How early the model's tiles usually come, in seconds (see soundShift). */
const EARLY = 0.029;
/** Shorter holds than this (in beats: an 8th) are played as taps. */
const MIN_HOLD = 0.5;
/**
 * A long note is a hold only where a sound rings: the sound it starts on (within 50 ms) must ring
 * at least this share of its length (the onset mapper's measure, SoundEvent.len); else it's a tap.
 * The model writes long notes as a habit of the charts it learned from (a quarter of its tiles on
 * some songs, a beat long), and the charts filled up with holds over sounds that had stopped.
 */
const RING = 0.2;

// The model reads audio at 22050 Hz (and 24000 Hz for one stage); the listening pass hears at one
// of the two. The runtime's tables for 24000 Hz go with the app.
const TABLES: Record<string, string> = {
  'resample-24000.bin': table24,
  'resample-24000-boundary.bin': bound24,
  'resample-24000.json': info24,
};
async function tables(path: string): Promise<Uint8Array> {
  const url = TABLES[path];
  if (!url) throw Object.assign(new Error(`trained mapper: no table ${path}`), { code: 'ENOENT' });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`trained mapper: table ${path} ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export interface Trained {
  charts: Record<Difficulty, Chart>;
  mapper: string;
  /** The song measured again on the model's beat grid, when that replaced the first grid (see TrainedOptions.regrid). */
  result?: import('./automap').AutomapResult;
  /** Dev (STUDY_KEY): what the steps after the model worked from, for replaying offline. */
  study?: unknown;
}

/** A beat grid: tempo, the seconds into the audio of a downbeat, beats per bar. */
export interface BeatGrid { bpm: number; offset: number; meter: number }

export interface TrainedOptions {
  base: string;
  /** The song's grid (from the onset mapper): tiles are placed in beats from `offset`. */
  bpm: number;
  offset: number;
  /** The sounds the onset mapper found: a tile on a pitched one takes its note name. */
  events: SoundEvent[];
  /** The beat grid is trusted (Easy and Medium then favour tiles on the beat). */
  onGrid: boolean;
  /** Beats per bar (4 when not given). */
  meter?: number;
  /** The beat tracker's own beats (seconds): the beat map tiles are placed on (beatmap.ts). */
  beats?: number[];
  /** The sung syllables (voice.ts, from the vocal split): tiles go on them and thinning favours them. */
  voice?: Syllable[];
  gpu: boolean;
  /** Where it's got: loading the model, listening to the song (its own beat tracking), charting it (0..1 of the song charted). */
  onStage?: (stage: TrainedStage, p?: number) => void;
  /** Each difficulty once its chart is made (done 1 of 1, with its tiles). */
  onProgress?: (p: ChartProgress) => void;
  /**
   * The model's own beat grid (from its larger beat tracker, as its chart's timing), already moved
   * like its tiles: return the song's grid and sounds measured again on it to place the tiles
   * there, or null to keep the first grid (the worker decides: see listen.worker.ts).
   */
  regrid?: (grid: BeatGrid) => Placing | null;
  title?: string;
  artist?: string;
  /** Each chart the model makes, as it made it (its objects in ms, before they're moved and thinned), with the shift it gets: for tools that study its output. */
  onRaw?: (star: number, objects: { lane: number; start_ms: number; end_ms?: number }[], shift: number) => void;
}

/** What the tiles are placed by: the song's grid, its sounds, and the beat tracker's beats. */
export type Placing = Pick<TrainedOptions, 'bpm' | 'offset' | 'events' | 'onGrid' | 'meter' | 'beats' | 'voice'>;

/**
 * Hearing the singing (the vocal split and its syllables: voice.ts, before the model), loading the
 * model, its listening (beat tracking, features), charting, charting again busier (nextStar).
 */
export type TrainedStage = 'voice' | 'load' | 'listen' | 'chart' | 'again';

// A star rating is a difficulty, not a density. On a fast, intense song 2★ spreads its tiles thin,
// and unevenly: it eases the hardest stretches (a 200 BPM shred song: about 7 tiles a second in
// its intro, 2-4 in the loud, busy verses after it, which played sparse and disconnected). So Ultra
// is judged a stretch of the song at a time (WINDOW): each should have about two tiles a beat, more
// or fewer as it has more or fewer sounds than the song's usual stretch (ultraTargets). While too
// little of that is met (COVER), the song is charted again a star busier, from what the model
// already heard (its audio stages aren't run again), and each stretch takes its tiles from the
// chart that fits it best (splice). Every tile is still one of the model's, on a sound it heard.

/** Ultra aims for this many tiles a beat (a stream of 8ths, a little more)... */
const ULTRA_PER_BEAT = 2.2;
/** ...and never more than this many a second. */
const ULTRA_MAX_RATE = 8;
/** The stretches of the song Ultra is judged by, in seconds. */
const WINDOW = 10;
/** Charting again busier stops once Ultra meets this share of its targets. */
const COVER = 0.85;
/** The highest star rating charted for a busier Ultra (on a fast song 4★ has about twice 2★'s tiles). */
export const MAX_STAR = 4;
/** At most this many charts per song (each takes ~15 s on a graphics chip for 5 minutes of song). */
const MAX_TRIES = 3;

type Grid = Pick<TrainedOptions, 'bpm' | 'offset'>;

/**
 * Ultra's tiles to aim for in each WINDOW of the song: ULTRA_PER_BEAT at `bpm` (at most
 * ULTRA_MAX_RATE a second), times how many sounds the stretch has against the song's median
 * stretch (0.6 to 1.25 of it); nothing asked of a stretch with hardly any (under a quarter).
 */
export function ultraTargets(events: Pick<SoundEvent, 'sec'>[], bpm: number, seconds: number): number[] {
  const n = Math.max(1, Math.ceil(seconds / WINDOW));
  const rate = Math.min((ULTRA_PER_BEAT * bpm) / 60, ULTRA_MAX_RATE);
  const sounds = new Array<number>(n).fill(0);
  for (const e of events) {
    const w = Math.floor(e.sec / WINDOW);
    if (w >= 0 && w < n) sounds[w]++;
  }
  const heard = sounds.filter((c) => c > 0).sort((a, b) => a - b);
  const median = heard.length ? heard[heard.length >> 1] : 0;
  return sounds.map((c, w) => {
    const busy = median ? c / median : 0;
    if (busy < 0.25) return 0;
    const secs = Math.max(0, Math.min(WINDOW, seconds - w * WINDOW));
    return Math.round(rate * secs * Math.min(1.25, Math.max(0.6, busy)));
  });
}

const windowOf = (t: number, g: Grid) => Math.floor((g.offset + (t * 60) / g.bpm) / WINDOW);

/** A chart's tiles in each WINDOW (`n` of them). */
export function perWindow(notes: ChartNote[], g: Grid, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  for (const x of notes) {
    const w = windowOf(x.t, g);
    if (w >= 0 && w < n) out[w]++;
  }
  return out;
}

/** The share of the targets a chart meets (tiles over a stretch's target don't make up for another's). */
export function coverage(counts: number[], targets: number[]): number {
  let got = 0, want = 0;
  for (let i = 0; i < targets.length; i++) { got += Math.min(counts[i] ?? 0, targets[i]); want += targets[i]; }
  return want ? got / want : 1;
}

/** How far a stretch's tiles are from its target (falling short counts half again as much). */
const misfit = (n: number, t: number) => (n >= t ? Math.log(n / t) : 1.5 * Math.log(t / Math.max(n, 0.5)));

/**
 * One chart from several of the same song: each WINDOW takes its tiles from the chart whose Ultra
 * there is nearest its target (the first chart where nothing is asked). Ultra's counts per stretch
 * are in `counts`. A tile that would start under a hold from the stretch before is left out.
 */
export function splice(charts: { notes: ChartNote[]; counts: number[] }[], targets: number[], g: Grid): ChartNote[] {
  const pick = targets.map((t, w) => {
    if (!t) return 0;
    let best = 0;
    for (let i = 1; i < charts.length; i++) if (misfit(charts[i].counts[w], t) < misfit(charts[best].counts[w], t)) best = i;
    return best;
  });
  const last = targets.length - 1;
  const chosen = charts.flatMap((c, i) => c.notes.filter((x) => pick[Math.min(last, Math.max(0, windowOf(x.t, g)))] === i));
  chosen.sort((a, b) => a.t - b.t || a.lane - b.lane);
  const held = [-Infinity, -Infinity, -Infinity, -Infinity];
  const out: ChartNote[] = [];
  for (const x of chosen) {
    if (held[x.lane] > x.t + 1e-6) continue;
    if (x.hold) held[x.lane] = x.t + x.len;
    out.push(x);
  }
  return out;
}

/** The next star rating to chart at, or null when done (Ultra meets COVER, or MAX_STAR or MAX_TRIES is reached). */
export function nextStar(stars: number[], cover: number): number | null {
  if (cover >= COVER || stars.length >= MAX_TRIES) return null;
  const next = Math.floor(Math.max(...stars)) + 1;
  return next <= MAX_STAR ? next : null;
}

/** Downloads (or reads from the cache) the model and charts the song. */
export async function trainedCharts(ort: Ort, pcm: Float32Array, sr: number, o: TrainedOptions): Promise<Trained> {
  const rt = await import('@ensomi/runtime');
  const audio = sr === 22050 || sr === 24000 ? pcm : (await import('./beats')).resample(pcm, sr);
  const rate = sr === 22050 || sr === 24000 ? sr : 22050;
  const songMs = (audio.length / rate) * 1000;
  o.onStage?.('load');
  const models = await rt.loadModels(cachedSource(o.base), {
    ort: ort as never,
    backend: o.gpu ? 'webgpu' : 'wasm',
    core: coreUrl,
    runtimeSource: tables,
  });
  try {
    // The stages that read only the audio (its own beat tracking, the features) run once.
    o.onStage?.('listen');
    const prepared = await rt.prepare(models, audio, rate);
    // The chart comes a page at a time, so the screen can show how much of the song is charted.
    // (Pages are meant for playing while it charts: with a lead longer than any song it never
    // waits for play, and the chart is the same as made in one go.)
    const chartAt = async (star: number, stage: TrainedStage) => {
      o.onStage?.(stage, 0);
      const s = await rt.ChartScheduler.create(models, prepared, { star, seed: SEED, title: o.title, artist: o.artist }, {
        mode: 'ahead-of-play',
        renderLeadMs: 1e9,
        onPage: (page) => o.onStage?.(stage, Math.min(1, page.coverage_ms / songMs)),
      });
      let result: Awaited<ReturnType<typeof rt.generateChart>> | undefined;
      try {
        s.start(0);
        for (let i = 0; i < 1e4 && !result; i++) {
          const a = await s.work(); // 'ready' (play could start) and on, until 'done'
          if (a.kind === 'done') {
            if (!a.result) throw new Error('trained mapper: no chart');
            result = a.result;
          }
        }
      } finally {
        s.free();
      }
      if (!result) throw new Error('trained mapper: no chart');
      o.onStage?.(stage, 1);
      return result;
    };
    const first = await chartAt(STAR, 'chart');
    const shift = soundShift(first.chart.objects, o.events);
    o.onRaw?.(STAR, first.chart.objects, shift);
    // The model's own grid (its larger beat tracker) can replace the first one: then the tiles go
    // on that one.
    let on: Placing = o;
    const own = o.regrid ? osuGrid(first.osu, songMs / 1000) : null;
    if (own && o.regrid) {
      const again = o.regrid({ ...own, offset: Math.round((own.offset + shift) * 1000) / 1000 });
      if (again) on = { ...again, beats: o.beats, voice: o.voice };
    }
    const place = placer(on);
    // Ultra a stretch at a time (see ultraTargets): charted again busier while too little is met.
    const targets = ultraTargets(on.events, on.bpm, songMs / 1000);
    const ultraOf = (notes: ChartNote[]) => perWindow(place.ultra(notes).notes, on, targets.length);
    const firstNotes = place.chart(first.chart.objects, shift);
    const tries = [{ star: STAR, notes: firstNotes, counts: ultraOf(firstNotes) }];
    let notes = firstNotes;
    const covers = [coverage(tries[0].counts, targets)];
    for (let star = nextStar([STAR], covers[0]); star != null; star = nextStar(tries.map((t) => t.star), covers[covers.length - 1])) {
      const again = (await chartAt(star, 'again')).chart.objects;
      o.onRaw?.(star, again, shift);
      const more = place.chart(again, shift);
      tries.push({ star, notes: more, counts: ultraOf(more) });
      notes = splice(tries, targets, on);
      covers.push(coverage(ultraOf(notes), targets));
    }
    // The singing: a tile on each sung syllable that has none (voice.ts).
    const sung = place.sung(notes);
    notes = sung.notes;
    const charts = await place.calibrated(notes, rt.starRating);
    for (const d of DIFFS) o.onProgress?.({ difficulty: d, done: 1, total: 1, tiles: charts[d].notes.length });
    const v = models.capabilities.model_version;
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const stars = tries.length > 1
      ? `${tries.map((t) => `${t.star}★`).join(' + ')} by stretch of the song (Ultra met ${pct(covers[0])} of its ${targets.reduce((a, b) => a + b, 0)}-tile target at ${STAR}★; ${tries.slice(1).map((t, i) => `with ${t.star}★ ${pct(covers[i + 1])}`).join(', ')})`
      : `${STAR}★ (Ultra met ${pct(covers[0])} of its target)`;
    return { charts, mapper: `Ensomi R2 trained mapper (${v}, ${stars}; each difficulty a subset, the easier ones thinned to their star ratings: ${DIFFS.map((d) => `${d[0].toUpperCase()} ${charts[d].stars?.toFixed(2)}★`).join(' ')}; tiles moved ${Math.round(shift * 1000)} ms onto the measured sounds${place.note}${sung.note})` };
  } finally {
    await models.dispose().catch(() => {});
  }
}

/**
 * The model's beat grid, from the timing of the .osu chart it writes: its uninherited timing
 * points ("time,beatLength,meter,...,1,..."), the one that covers most of the song (a chart may
 * change tempo), its downbeat moved back to the earliest one at or after 0 s. Null without one,
 * or out of 40-260 BPM.
 */
export function osuGrid(osu: string, songSeconds: number): BeatGrid | null {
  const lines = osu.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() === '[TimingPoints]');
  if (at < 0) return null;
  const red: { t: number; beat: number; meter: number }[] = [];
  for (let i = at + 1; i < lines.length && lines[i].trim() && !lines[i].startsWith('['); i++) {
    const f = lines[i].split(',');
    const beat = Number(f[1]);
    if (f.length >= 7 && f[6].trim() === '1' && beat > 0) red.push({ t: Number(f[0]) / 1000, beat: beat / 1000, meter: Number(f[2]) || 4 });
  }
  if (!red.length) return null;
  red.sort((a, b) => a.t - b.t);
  let best = red[0], span = -1;
  for (let i = 0; i < red.length; i++) {
    const until = i + 1 < red.length ? red[i + 1].t : Math.max(songSeconds, red[i].t);
    if (until - Math.max(0, red[i].t) > span) { span = until - Math.max(0, red[i].t); best = red[i]; }
  }
  const bpm = Math.round((60 / best.beat) * 100) / 100;
  if (!(bpm > 40 && bpm < 260)) return null;
  const meter = best.meter === 3 ? 3 : 4;
  const bar = best.beat * meter;
  const offset = best.t - Math.floor(best.t / bar) * bar;
  return { bpm, offset: Math.round(offset * 1000) / 1000, meter };
}

/**
 * How much later the model's tiles belong. Its tiles come a little early (about 29 ms on a test
 * groove whose hits are known; likely the timing of the charts it learned from), while the onset
 * mapper's sounds are measured on the attacks. So the tiles move by their median distance to the
 * nearest measured sound; with too few near one, by the usual amount.
 */
export function soundShift(objects: { start_ms: number }[], events: { sec: number }[]): number {
  const secs = events.map((e) => e.sec).sort((a, b) => a - b);
  const d: number[] = [];
  let j = 0;
  for (const ob of [...objects].sort((a, b) => a.start_ms - b.start_ms)) {
    const want = ob.start_ms / 1000 + EARLY;
    while (j < secs.length - 1 && secs[j + 1] <= want) j++;
    const near = [secs[j], secs[j + 1]].filter((s) => s !== undefined && Math.abs(s - want) < 0.05).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
    if (near !== undefined) d.push(near - ob.start_ms / 1000);
  }
  if (d.length < 24) return EARLY;
  d.sort((a, b) => a - b);
  return Math.round(d[d.length >> 1] * 1000) / 1000;
}

/**
 * What a row of the kind of sound its phrase follows weighs extra in an easier chart (thin.ts
 * `follow`). Against the human charts of the Creative Commons benchmark (Nov 19), Easy hopped
 * between kinds of sound (the band under each tile) 29% of the time against the humans' 20%; at
 * 0.3, 24% (Easy's F1 against their Easy charts 54% → 55%). At 0.6 it hopped 21%, but on the
 * synthetic band (map-bench) Easy and Medium then caught about 5 points fewer of the strong notes
 * (kick, snare, bass and melody together); at 0.3 they catch as many as without it. A row on the
 * beat weighing more on Easy ("Easy from the beat") was tried and left
 * out: human Easy charts put 26-50% of their tiles on the beat, ours already 41%, and more made
 * them less alike.
 */
const FOLLOW = 0.3;

/** The song's beat map and repeated phrases, found once for all its charts. */
export interface Placed { map: BeatMap | null; repeats: Repeats | null }

/**
 * Everything the model's tiles are placed by, found once: the beat map (from the beat tracker's
 * beats: beatmap.ts) and the repeated phrases on it (repeats.ts). `chart` turns the model's objects
 * into Ultra's tiles; `easier` makes every difficulty from them.
 */
export function placer(on: Placing) {
  const secs = [...on.events].map((e) => e.sec).sort((a, b) => a - b);
  const map = on.beats?.length ? beatMap({ beats: on.beats }, secs, { spb: 60 / on.bpm, offset: on.offset, meter: on.meter ?? 4 }) : null;
  const placed: Placed = { map, repeats: map ? findRepeats(map, on.events) : null };
  const tiled = map ? map.division.filter((d) => d > 0).length / Math.max(1, map.division.length) : 0;
  const triplets = map ? map.division.filter((d) => d === 3 || d === 6).length / Math.max(1, map.division.length) : 0;
  return {
    placed,
    chart: (objects: { lane: number; start_ms: number; end_ms?: number }[], shift: number) => toChart(objects, 'ultra', on, shift, map).notes,
    easier: (notes: ChartNote[]) => easierCharts(notes, on, placed),
    /** Ultra alone (the targets' measure while charting again busier). */
    ultra: (notes: ChartNote[]) => thinner(notes, on, placed)('ultra'),
    /** Every difficulty, the easier ones thinned to their star targets (starTargets). */
    calibrated: (notes: ChartNote[], rate: RateChart) => calibratedCharts(notes, on, placed, rate),
    /** The chart with a tile on each sung syllable it lacks (none without the voice), and a note for the report. */
    sung: (notes: ChartNote[]) => withSyllables(notes, on, map),
    /** For the report: how much of the song has its own grid, and the repeats found. */
    note: map ? `; tiles on the beat map's 16ths or triplets where its sounds follow them (${Math.round(tiled * 100)}% of the song, triplets ${Math.round(triplets * 100)}%), ${placed.repeats?.of.size ?? 0} repeated phrases charted alike` : '',
  };
}

/** A tile within this (s) of a syllable is on it. */
export const ON_SYLLABLE = 0.05;
/** A syllable's tile keeps this far (s) from any other tile's start. */
const SYLLABLE_GAP = 0.09;
/** A syllable held this long (s, and an 8th or more) is a hold. */
const SUNG_HOLD = 0.35;

/**
 * The chart with a tile on each sung syllable that has none within ON_SYLLABLE: on the beat map
 * where the syllable is within 30 ms of its grid (a singer sits loosely on the beat), else at its
 * own time; a hold where it's sung long; never crowding another tile (SYLLABLE_GAP). A tile crowding
 * it that isn't on a measured sound of its own (within 30 ms) is the same sung moment heard a little
 * off: it's moved onto the syllable instead (on two real listens Ultra's syllables with a tile went
 * 76% → 79% and 82%). A new tile's lane is a placeholder: every difficulty's
 * lanes are flowed after thinning (lanes.ts), with the tune.
 */
export function withSyllables(model: ChartNote[], on: Placing, map: BeatMap | null): { notes: ChartNote[]; note: string } {
  const voice = on.voice;
  if (!voice?.length) return { notes: model, note: '' };
  const spb = 60 / on.bpm;
  const secs = model.map((n) => on.offset + n.t * spb).sort((a, b) => a - b);
  const at = (x: number) => { let lo = 0, hi = secs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (secs[m] < x) lo = m + 1; else hi = m; } return lo; };
  const nearest = (x: number) => { const lo = at(x); return Math.min(lo < secs.length ? Math.abs(secs[lo] - x) : Infinity, lo > 0 ? Math.abs(secs[lo - 1] - x) : Infinity); };
  const added: ChartNote[] = [];
  let had = 0, moved = 0;
  const sounds = on.events.map((e) => e.sec).sort((a, b) => a - b);
  const onSound = (x: number) => { let lo = 0, hi = sounds.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sounds[m] < x) lo = m + 1; else hi = m; } return (lo < sounds.length && sounds[lo] - x <= 0.03) || (lo > 0 && x - sounds[lo - 1] <= 0.03); };
  const out = model.map((n) => ({ ...n }));
  const bySec = new Map<number, ChartNote[]>();
  for (const n of out) { const k = Math.round((on.offset + n.t * spb) * 1000); bySec.set(k, [...(bySec.get(k) ?? []), n]); }
  for (const s of voice) {
    if (nearest(s.sec) <= ON_SYLLABLE) { had++; continue; }
    const sec = map ? snapSec(map, s.sec, 0.03) : s.sec;
    const t = Math.round(((sec - on.offset) / spb) * 1000) / 1000;
    if (t < 0) continue;
    if (nearest(sec) < SYLLABLE_GAP) {
      // The tile crowding it: moved onto the syllable when it's on no sound of its own.
      const i = at(sec), j = [i - 1, i].filter((k) => k >= 0 && k < secs.length).sort((a, b) => Math.abs(secs[a] - sec) - Math.abs(secs[b] - sec))[0];
      const from = secs[j], tiles = bySec.get(Math.round(from * 1000));
      if (!tiles || onSound(from) || secs.some((x) => x !== from && Math.abs(x - sec) < SYLLABLE_GAP)) continue;
      for (const n of tiles) n.t = t;
      bySec.delete(Math.round(from * 1000));
      bySec.set(Math.round(sec * 1000), tiles);
      secs.splice(j, 1);
      secs.splice(at(sec), 0, sec);
      moved++;
      continue;
    }
    const len = Math.round((s.len / spb) * 1000) / 1000;
    const hold = s.len >= SUNG_HOLD && len >= MIN_HOLD;
    const n: ChartNote = { t, lane: added.length % 4, pitch: noteName(s.midi), len: hold ? len : 0.25 };
    if (hold) n.hold = true;
    added.push(n);
    secs.splice(at(sec), 0, sec);
  }
  return {
    notes: [...out, ...added].sort((a, b) => a.t - b.t || a.lane - b.lane),
    note: `; ${voice.length} sung syllables heard (the vocal split): ${had} had a tile, ${added.length} added, ${moved} moved onto them, the easier charts favour them`,
  };
}

/** Each difficulty keeps some of the model's rows (KEEP). */
export function easierCharts(model: ChartNote[], o: Pick<TrainedOptions, 'bpm' | 'offset' | 'events' | 'onGrid' | 'voice'>, placed?: Placed): Record<Difficulty, Chart> {
  const make = thinner(model, o, placed);
  return { easy: make('easy'), medium: make('medium'), hard: make('hard'), ultra: make('ultra') };
}

/**
 * Makes one difficulty from the model's chart (`scale` times KEEP's share and rate: calibrate's
 * dial), everything about the song worked out once.
 */
export function thinner(model: ChartNote[], o: Pick<TrainedOptions, 'bpm' | 'offset' | 'events' | 'onGrid' | 'voice'>, placed?: Placed): (d: Difficulty, scale?: number) => Chart {
  const spb = 60 / o.bpm;
  const map = placed?.map ?? null, repeats = placed?.repeats ?? null;
  const events = [...o.events].sort((a, b) => a.sec - b.sec);
  const secOf = (t: number) => o.offset + t * spb;
  const soundAt = (sec: number, lim: number) => {
    let lo = 0, hi = events.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (events[m].sec < sec) lo = m + 1; else hi = m; }
    return [events[lo - 1], events[lo]].filter((e) => e && Math.abs(e.sec - sec) < lim).sort((a, b) => Math.abs(a.sec - sec) - Math.abs(b.sec - sec))[0];
  };
  // Where a moment sits in the music's own beat, its sound's kind and its phrase, its twin.
  const place = map ? (t: number) => {
    const sec = secOf(t), at = beatPlace(map, sec), i = Math.round(beatAt(map, sec));
    return { beat: at === 'beat', half: at === 'half', downbeat: at === 'beat' && ((i - map.downbeat) % map.meter + map.meter) % map.meter === 0 };
  } : undefined;
  const voice = o.voice?.length ? [...o.voice].sort((a, b) => a.sec - b.sec) : null;
  const syllable = (t: number) => (voice ? syllableAt(voice, secOf(t), ON_SYLLABLE) : undefined);
  // A sung row is of the voice's kind: a phrase that's sung follows the singing.
  const kind = (t: number) => (syllable(t) ? 'voice' : soundAt(secOf(t), 0.05)?.band ?? null);
  const phrase = (t: number) => (map ? Math.floor(barOf(map, beatAt(map, secOf(t))) / 2) : Math.floor(t / 8));
  const twin = repeats ? (t: number) => { const s = twinSec(repeats, secOf(t)); return s == null ? null : (s - o.offset) / spb; } : undefined;
  const pitch = (n: ChartNote) => syllable(n.t)?.midi ?? soundAt(secOf(n.t), 0.03)?.midi ?? null;
  // Each difficulty's tiles, then its lanes flowed for its own speed (lanes.ts: thinning keeps the
  // model's lanes, written for its whole chart), a repeated phrase's tiles in their twins' lanes.
  return (d: Difficulty, scale = 1): Chart => {
    const k = KEEP[d];
    const kept = thinChart(model, {
      ...k, ...(scale !== 1 ? { share: Math.min(1, k.share * scale), rate: k.rate * scale, floor: k.floor * scale } : {}),
      spb, offset: o.offset, events: o.events, onGrid: o.onGrid,
      ...(place ? { place } : {}),
      ...(twin ? { twin } : {}),
      ...(d !== 'ultra' ? { kind, phrase, follow: FOLLOW } : {}),
      ...(voice ? { sung: (t: number) => syllable(t)?.strength ?? 0 } : {}),
    });
    const sorted = [...kept].sort((a, b) => a.t - b.t);
    const tol = 0.03 / spb;
    const twinNote = twin ? (n: ChartNote) => {
      const tw = twin(n.t);
      if (tw == null) return undefined;
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m].t < tw) lo = m + 1; else hi = m; }
      return [sorted[lo - 1], sorted[lo]].find((x) => x && x !== n && Math.abs(x.t - tw) <= tol && x.t < n.t);
    } : undefined;
    return { difficulty: d, lanes: 4, notes: flowChart(kept, d, spb, { twin: twinNote, pitch }) };
  };
}

/**
 * Star targets (osu!mania's star rating: @ensomi/runtime starRating). Easy is thinned to EASY_STARS
 * on every song (the median of what KEEP made, Nov 20: by share alone it ranged 0.85-1.11 stars
 * from song to song); Medium and Hard to even steps of stars between it and the song's own Ultra
 * (the whole chart, rated, not thinned: 2.0-3.1 stars). Fixed targets for all three (1.38 and 1.9)
 * were tried first and broke the ladder: on a song whose Ultra is 2.2 stars, Hard at 1.9 sat right
 * under it (×1.05 the tiles) and Easy to Medium doubled; on a sparse one Easy outgrew Medium.
 */
export const EASY_STARS = 0.95;
const STAR_SPREAD = 0.06;
/** Calibration only nudges KEEP: its share and rate scaled within these. */
const SCALE: [number, number] = [0.7, 1.4];
/** Each difficulty keeps at least this many times the tiles of the one below it (else it stays as KEEP made it). */
const MIN_STEP = 1.15;

/** The star targets of a song whose Ultra is rated `ultra`. */
export function starTargets(ultra: number): Record<Exclude<Difficulty, 'ultra'>, number> {
  const r = Math.max(1.1, Math.cbrt(ultra / EASY_STARS));
  return { easy: EASY_STARS, medium: EASY_STARS * r, hard: EASY_STARS * r * r };
}

/** A chart's star rating (beats from `offset`, `bpm`), by the runtime's `starRating`. */
export type RateChart = (chart: { duration_ms: number; objects: { lane: number; start_ms: number; end_ms?: number }[] }) => Promise<number>;
export async function chartStars(notes: ChartNote[], g: { bpm: number; offset: number }, rate: RateChart): Promise<number> {
  if (!notes.length) return 0;
  const spb = 60 / g.bpm;
  const objects = notes.map((n) => ({ lane: n.lane, start_ms: Math.max(0, Math.round((g.offset + n.t * spb) * 1000)), ...(n.hold ? { end_ms: Math.round((g.offset + (n.t + n.len) * spb) * 1000) } : {}) }));
  const end = Math.max(...objects.map((x) => x.end_ms ?? x.start_ms));
  return Math.round((await rate({ duration_ms: end + 1000, objects })) * 100) / 100;
}

/**
 * Every difficulty, each easier one thinned to its star target (starTargets: KEEP's share and rate
 * scaled within SCALE, halving the step, at most CALIBRATE tries, the nearest kept), each with its
 * rating. One that would leave less than MIN_STEP between it and its neighbours stays as KEEP made it.
 */
export async function calibratedCharts(model: ChartNote[], o: Pick<TrainedOptions, 'bpm' | 'offset' | 'events' | 'onGrid'>, placed: Placed | undefined, rate: RateChart): Promise<Record<Difficulty, Chart>> {
  const make = thinner(model, o, placed);
  const out = {} as Record<Difficulty, Chart>;
  const ultra = make('ultra');
  out.ultra = { ...ultra, stars: await chartStars(ultra.notes, o, rate) };
  const targets = starTargets(out.ultra.stars ?? EASY_STARS * 2.6);
  // Hard first: each easier one is kept under the one above it.
  for (const d of ['hard', 'medium', 'easy'] as const) {
    const want = targets[d];
    const plain = make(d);
    let chart = plain, stars = await chartStars(chart.notes, o, rate);
    const plainStars = stars;
    let best = { chart, stars };
    let lo = stars > want ? SCALE[0] : 1, hi = stars > want ? 1 : SCALE[1];
    for (let i = 0; i < CALIBRATE && Math.abs(stars - want) > STAR_SPREAD; i++) {
      const scale = (lo + hi) / 2;
      chart = make(d, scale);
      stars = await chartStars(chart.notes, o, rate);
      if (Math.abs(stars - want) < Math.abs(best.stars - want)) best = { chart, stars };
      if (stars > want) hi = scale; else lo = scale;
    }
    const above = out[d === 'hard' ? 'ultra' : d === 'medium' ? 'hard' : 'medium'];
    if (best.chart.notes.length * MIN_STEP > above.notes.length && plain.notes.length < best.chart.notes.length) best = { chart: plain, stars: plainStars };
    out[d] = { ...best.chart, stars: best.stars };
  }
  return { easy: out.easy, medium: out.medium, hard: out.hard, ultra: out.ultra };
}
const CALIBRATE = 7;

/**
 * The model's objects (lane, ms), moved `shift` seconds later, as a chart in beats on the song's
 * grid. A tile within 15 ms of a measured sound takes that sound's place (as the onset mapper put
 * it, on a 16th when it's within 20 ms of one and the grid holds there); others keep their own
 * time, on a 16th when within 12 ms of one where the grid holds.
 */
export function toChart(objects: { lane: number; start_ms: number; end_ms?: number }[], difficulty: Difficulty, o: Pick<TrainedOptions, 'bpm' | 'offset' | 'events'>, shift = 0, map: BeatMap | null = null): Chart {
  const bps = o.bpm / 60;
  const events = [...o.events].sort((a, b) => a.sec - b.sec);
  const notes: ChartNote[] = [];
  let j = 0;
  for (const ob of [...objects].sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane)) {
    const sec = ob.start_ms / 1000 + shift;
    const raw = (sec - o.offset) * bps;
    if (raw < -0.05 || ob.lane < 0 || ob.lane > 3) continue; // before beat 0, as the onset mapper does
    while (j < events.length - 1 && events[j + 1].sec <= sec) j++;
    const close = (lim: number) => [events[j], events[j + 1]].filter((e) => e && Math.abs(e.sec - sec) < lim).sort((a, b) => Math.abs(a.sec - sec) - Math.abs(b.sec - sec))[0];
    const on = close(0.015);
    const q = Math.round(raw * 4) / 4;
    // Its own time goes onto a 16th only where the grid holds (the onset mapper put the sounds
    // around it on 16ths: automap.ts gridHolds); elsewhere the grid is off the music there.
    let holds = false;
    for (let k = Math.max(0, j - 4); k < Math.min(events.length, j + 5) && !holds; k++) {
      holds = Math.abs(events[k].sec - sec) < 0.5 && Math.abs(events[k].t * 4 - Math.round(events[k].t * 4)) < 1e-6;
    }
    // On the beat map, the stretch's own grid (16ths or triplets) where its sounds follow one: the
    // sound's time (or the tile's own) moved onto it when within 20 ms (12 ms for its own).
    // (Where it has no grid, the straight grid's placement as before.)
    const heard = on ? on.sec : sec;
    const moved = map ? snapSec(map, heard, on ? 0.02 : 0.012) : heard;
    const snapped = moved !== heard ? moved : null;
    const t = Math.max(0, snapped != null ? Math.round((snapped - o.offset) * bps * 1000) / 1000
      : on ? on.t : holds && Math.abs(raw - q) / bps < 0.012 ? q : Math.round(raw * 1000) / 1000);
    const len = ob.end_ms != null ? Math.round(((ob.end_ms - ob.start_ms) / 1000) * bps * 1000) / 1000 : 0;
    // The pitch of the sound it's on, when a pitched one was heard within 60 ms (synth playback only).
    const pitched = close(0.06);
    const rings = close(0.05);
    const hold = len >= MIN_HOLD && !!rings && rings.len >= len * RING;
    const n: ChartNote = { t, lane: ob.lane, pitch: pitched?.note ?? 'C5', len: hold ? len : 0.25 };
    if (hold) n.hold = true;
    notes.push(n);
  }
  return { difficulty, lanes: 4, notes };
}
