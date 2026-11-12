// The trained mapper: Ensomi R2 (@ensomi/runtime, Apache-2.0; model sed-i/ensomi-r2, MIT), a model
// trained on human-made osu!mania 4K charts. It reads the heard audio and places the tiles itself.
// Runs in the mapping worker (listen.worker.ts); the audio stays in the browser.
//
// Its lowest star rating (2) is usually about as busy as this game's Hard, so it charts the song
// at that rating (again, busier, when Hard would have under about two tiles a beat: nextStar), and
// every difficulty keeps a subset of its tiles (thin.ts): Hard most of
// them (chords of two at most), Medium and Easy fewer. Its tiles come
// in milliseconds, a little early; they go onto the sounds the onset mapper measured and onto its
// beat grid (soundShift, toChart).

import type { Chart, ChartNote, ChartProgress, Difficulty, SoundEvent } from '../api/types';
import type { Ort } from './ort';
import { cachedSource } from './ensomiModel';
import { thinChart } from './thin';
// The runtime finds these beside its own module, which a bundler moves; so they're handed to it.
import coreUrl from '../../node_modules/@ensomi/runtime/pkg/ensomi_generate_wasm_bg.wasm?url';
import table24 from '../../node_modules/@ensomi/runtime/resampler/resample-24000.bin?url';
import bound24 from '../../node_modules/@ensomi/runtime/resampler/resample-24000-boundary.bin?url';
import info24 from '../../node_modules/@ensomi/runtime/resampler/resample-24000.json?url';

/** The star rating the model charts at (R2 takes 2 up to 6). */
export const STAR = 2;
const DIFFS: Difficulty[] = ['easy', 'medium', 'hard'];
/** How each difficulty is kept from the model's chart (thin.ts: rows a second, spacing, share, chord size). */
export const KEEP = {
  easy: { rate: 1.15, minGap: 0.5, share: 0.4, maxChord: 1, holdsAlone: true },
  medium: { rate: 2.1, minGap: 0.24, share: 0.65, maxChord: 1, holdsAlone: true },
  // Hard keeps the model's chart nearly whole (chords of two at most, nothing closer than a 16th at
  // 250 BPM): capped at 3.8 a second it felt sparse and disconnected on a 200 BPM shred song.
  hard: { rate: 1000, minGap: 0.06, share: 1, maxChord: 2, holdsAlone: false },
} as const;
/** The same song makes the same charts. */
const SEED = 7;
/** How early the model's tiles usually come, in seconds (see soundShift). */
const EARLY = 0.029;
/** Shorter holds than this (in beats) are played as taps. */
const MIN_HOLD = 0.25;

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
  regrid?: (grid: BeatGrid) => Pick<TrainedOptions, 'bpm' | 'offset' | 'events' | 'onGrid'> | null;
  title?: string;
  artist?: string;
}

/** Loading the model, its listening (beat tracking, features), charting, charting again busier (nextStar). */
export type TrainedStage = 'load' | 'listen' | 'chart' | 'again';

// A star rating is a difficulty, not a density. On a fast, intense song 2★ spreads its tiles thin,
// and unevenly: it eases the hardest stretches (a 200 BPM shred song: about 7 tiles a second in
// its intro, 2-4 in the loud, busy verses after it, which played sparse and disconnected). So Hard
// is judged a stretch of the song at a time (WINDOW): each should have about two tiles a beat, more
// or fewer as it has more or fewer sounds than the song's usual stretch (hardTargets). While too
// little of that is met (COVER), the song is charted again a star busier, from what the model
// already heard (its audio stages aren't run again), and each stretch takes its tiles from the
// chart that fits it best (splice). Every tile is still one of the model's, on a sound it heard.

/** Hard aims for this many tiles a beat (a stream of 8ths, a little more)... */
const HARD_PER_BEAT = 2.2;
/** ...and never more than this many a second. */
const HARD_MAX_RATE = 8;
/** The stretches of the song Hard is judged by, in seconds. */
const WINDOW = 10;
/** Charting again busier stops once Hard meets this share of its targets. */
const COVER = 0.85;
/** The highest star rating charted for a busier Hard (on a fast song 4★ has about twice 2★'s tiles). */
export const MAX_STAR = 4;
/** At most this many charts per song (each takes ~15 s on a graphics chip for 5 minutes of song). */
const MAX_TRIES = 3;

type Grid = Pick<TrainedOptions, 'bpm' | 'offset'>;

/**
 * Hard's tiles to aim for in each WINDOW of the song: HARD_PER_BEAT at `bpm` (at most
 * HARD_MAX_RATE a second), times how many sounds the stretch has against the song's median
 * stretch (0.6 to 1.25 of it); nothing asked of a stretch with hardly any (under a quarter).
 */
export function hardTargets(events: Pick<SoundEvent, 'sec'>[], bpm: number, seconds: number): number[] {
  const n = Math.max(1, Math.ceil(seconds / WINDOW));
  const rate = Math.min((HARD_PER_BEAT * bpm) / 60, HARD_MAX_RATE);
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
 * One chart from several of the same song: each WINDOW takes its tiles from the chart whose Hard
 * there is nearest its target (the first chart where nothing is asked). Hard's counts per stretch
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

/** The next star rating to chart at, or null when done (Hard meets COVER, or MAX_STAR or MAX_TRIES is reached). */
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
    // The model's own grid (its larger beat tracker) can replace the first one: then the tiles go
    // on that one.
    let on: Pick<TrainedOptions, 'bpm' | 'offset' | 'events' | 'onGrid'> = o;
    const own = o.regrid ? osuGrid(first.osu, songMs / 1000) : null;
    if (own && o.regrid) on = o.regrid({ ...own, offset: Math.round((own.offset + shift) * 1000) / 1000 }) ?? o;
    // Hard a stretch at a time (see hardTargets): charted again busier while too little is met.
    const targets = hardTargets(on.events, on.bpm, songMs / 1000);
    const hardOf = (notes: ChartNote[]) => perWindow(easierCharts(notes, on).hard.notes, on, targets.length);
    const firstNotes = toChart(first.chart.objects, 'hard', on, shift).notes;
    const tries = [{ star: STAR, notes: firstNotes, counts: hardOf(firstNotes) }];
    let notes = firstNotes;
    const covers = [coverage(tries[0].counts, targets)];
    for (let star = nextStar([STAR], covers[0]); star != null; star = nextStar(tries.map((t) => t.star), covers[covers.length - 1])) {
      const more = toChart((await chartAt(star, 'again')).chart.objects, 'hard', on, shift).notes;
      tries.push({ star, notes: more, counts: hardOf(more) });
      notes = splice(tries, targets, on);
      covers.push(coverage(hardOf(notes), targets));
    }
    const charts = easierCharts(notes, on);
    for (const d of DIFFS) o.onProgress?.({ difficulty: d, done: 1, total: 1, tiles: charts[d].notes.length });
    const v = models.capabilities.model_version;
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const stars = tries.length > 1
      ? `${tries.map((t) => `${t.star}★`).join(' + ')} by stretch of the song (Hard met ${pct(covers[0])} of its ${targets.reduce((a, b) => a + b, 0)}-tile target at ${STAR}★; ${tries.slice(1).map((t, i) => `with ${t.star}★ ${pct(covers[i + 1])}`).join(', ')})`
      : `${STAR}★ (Hard met ${pct(covers[0])} of its target)`;
    return { charts, mapper: `Ensomi R2 trained mapper (${v}, ${stars}; each difficulty a subset; tiles moved ${Math.round(shift * 1000)} ms onto the measured sounds)` };
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

/** Each difficulty keeps some of the model's rows (KEEP). */
export function easierCharts(model: ChartNote[], o: Pick<TrainedOptions, 'bpm' | 'offset' | 'events' | 'onGrid'>): Record<Difficulty, Chart> {
  const spb = 60 / o.bpm;
  const chart = (d: Difficulty): Chart => ({ difficulty: d, lanes: 4, notes: thinChart(model, { ...KEEP[d], spb, offset: o.offset, events: o.events, onGrid: o.onGrid }) });
  return { easy: chart('easy'), medium: chart('medium'), hard: chart('hard') };
}

/**
 * The model's objects (lane, ms), moved `shift` seconds later, as a chart in beats on the song's
 * grid. A tile within 15 ms of a measured sound takes that sound's place (as the onset mapper put
 * it, on a 16th when it's within 20 ms of one and the grid holds there); others keep their own
 * time, on a 16th when within 12 ms of one where the grid holds.
 */
export function toChart(objects: { lane: number; start_ms: number; end_ms?: number }[], difficulty: Difficulty, o: Pick<TrainedOptions, 'bpm' | 'offset' | 'events'>, shift = 0): Chart {
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
    const t = Math.max(0, on ? on.t : holds && Math.abs(raw - q) / bps < 0.012 ? q : Math.round(raw * 1000) / 1000);
    const len = ob.end_ms != null ? Math.round(((ob.end_ms - ob.start_ms) / 1000) * bps * 1000) / 1000 : 0;
    // The pitch of the sound it's on, when a pitched one was heard within 60 ms (synth playback only).
    const pitched = close(0.06);
    const n: ChartNote = { t, lane: ob.lane, pitch: pitched?.note ?? 'C5', len: len >= MIN_HOLD ? len : 0.25 };
    if (len >= MIN_HOLD) n.hold = true;
    notes.push(n);
  }
  return { difficulty, lanes: 4, notes };
}
