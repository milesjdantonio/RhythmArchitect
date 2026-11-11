// The trained mapper: Ensomi R2 (@ensomi/runtime, Apache-2.0; model sed-i/ensomi-r2, MIT), a model
// trained on human-made osu!mania 4K charts. It reads the heard audio and places the tiles itself.
// Runs in the mapping worker (listen.worker.ts); the audio stays in the browser.
//
// Its lowest star rating (2) is already about as busy as this game's Hard, so it charts the song
// once, at that rating, and every difficulty keeps a subset of its tiles (thin.ts): Hard most of
// them (its busiest stretches eased, chords of two at most), Medium and Easy fewer. Its tiles come
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
  hard: { rate: 3.8, minGap: 0.1, share: 0.9, maxChord: 2, holdsAlone: false },
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
   * there, or null to keep the first grid. Called only when given (the first grid wasn't the
   * beat tracker's).
   */
  regrid?: (grid: BeatGrid) => Pick<TrainedOptions, 'bpm' | 'offset' | 'events' | 'onGrid'> | null;
  title?: string;
  artist?: string;
}

export type TrainedStage = 'load' | 'listen' | 'chart';

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
    o.onStage?.('chart', 0);
    const s = await rt.ChartScheduler.create(models, prepared, { star: STAR, seed: SEED, title: o.title, artist: o.artist }, {
      mode: 'ahead-of-play',
      renderLeadMs: 1e9,
      onPage: (page) => o.onStage?.('chart', Math.min(1, page.coverage_ms / songMs)),
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
    o.onStage?.('chart', 1);
    const objects = result.chart.objects;
    const shift = soundShift(objects, o.events);
    // When the first grid wasn't the beat tracker's, the model's own grid (its larger beat tracker)
    // can replace it: then the tiles go on that one.
    let on: Pick<TrainedOptions, 'bpm' | 'offset' | 'events' | 'onGrid'> = o;
    const own = o.regrid ? osuGrid(result.osu, songMs / 1000) : null;
    if (own && o.regrid) on = o.regrid({ ...own, offset: Math.round((own.offset + shift) * 1000) / 1000 }) ?? o;
    const charts = easierCharts(toChart(objects, 'hard', on, shift).notes, on);
    for (const d of DIFFS) o.onProgress?.({ difficulty: d, done: 1, total: 1, tiles: charts[d].notes.length });
    const v = models.capabilities.model_version;
    return { charts, mapper: `Ensomi R2 trained mapper (${v}, ${STAR}★; each difficulty a subset; tiles moved ${Math.round(shift * 1000)} ms onto the measured sounds)` };
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
 * it, on a 16th when it's within 20 ms of one); others keep their own time, on a 16th when
 * within 12 ms of one.
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
    const t = Math.max(0, on ? on.t : Math.abs(raw - q) / bps < 0.012 ? q : Math.round(raw * 1000) / 1000);
    const len = ob.end_ms != null ? Math.round(((ob.end_ms - ob.start_ms) / 1000) * bps * 1000) / 1000 : 0;
    // The pitch of the sound it's on, when a pitched one was heard within 60 ms (synth playback only).
    const pitched = close(0.06);
    const n: ChartNote = { t, lane: ob.lane, pitch: pitched?.note ?? 'C5', len: len >= MIN_HOLD ? len : 0.25 };
    if (len >= MIN_HOLD) n.hold = true;
    notes.push(n);
  }
  return { difficulty, lanes: 4, notes };
}
