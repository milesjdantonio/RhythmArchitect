// The mock's stand-in for playing through the controller (the real one: backend PlayController,
// which runs main.Main on the song's model). Main's rules, the same in TypeScript: one queue of the
// difficulty's notes in time order; a press on the next note's lane within 0.1 s is a Perfect,
// 0.2 s Good, 0.3 s Early or Late (else a miss, as is a press on another lane); the clock passing a
// note by more than 0.3 s misses it; Score's points (100, 75, 50), combo and accuracy. Every input
// is reviewed first (review.ts, the backend's InputReview): what it turns down never reaches Main,
// and a best is kept only from a run it passed (keepRun).

import type { Chart, Difficulty, PlayInput, PlayState, Song } from '../src/api/types';
import { replayRun, runFits, tileTimes } from '../src/game/score';
import { InputReview } from './review';

type Result = 'PERFECT' | 'GOOD' | 'EARLY' | 'LATE' | 'MISS';
interface QNote { lane: number; time: number }

const UPCOMING = 4;
const MAX_RUNS = 300;

class MainRun {
  private q: QNote[];
  private head = 0;
  private time = 0;
  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private perfect = 0;
  private good = 0;
  private ok = 0;
  private misses = 0;
  readonly total: number;
  /** The run as the game judged it, and the chart it's confirmed against (PlayController's run). */
  private run = '';
  private chart: Chart;
  private bpm: number;
  private reviewed = 0;
  private refused = false;
  private confirmed = { score: 0, accuracy: 1, maxCombo: 0 };
  readonly reviewer: InputReview;
  readonly songId: string;
  readonly difficulty: Difficulty;
  readonly practice: boolean;
  kept = false;
  /** The player said how it felt (once a run). */
  rated = false;

  constructor(song: Song, difficulty: Difficulty, part?: { from: number; to: number }) {
    this.songId = song.id;
    this.difficulty = difficulty;
    this.practice = !!part;
    const spb = 60 / song.bpm;
    // SongWriter's queue: every tile in time order (lanes in order within a moment); practice:
    // only those starting in [from, to) seconds (Song.getChartBetween).
    this.q = [...song.charts[difficulty].notes].sort((a, b) => a.t - b.t || a.lane - b.lane).map((n) => ({ lane: n.lane, time: n.t * spb }))
      .filter((n) => !part || (n.time >= part.from && n.time < part.to));
    this.total = this.q.length;
    const all = song.charts[difficulty];
    this.chart = { ...all, notes: part ? all.notes.filter((n) => n.t * spb >= part.from && n.t * spb < part.to) : all.notes };
    this.bpm = song.bpm;
    this.reviewer = new InputReview(this.q, undefined, (song.lengthBeats * 60) / song.bpm);
  }

  /** The run as the controller has it, and whether it was refused. */
  get judged() { return { run: this.run, refused: this.refused }; }

  private hit(r: Result) {
    if (r === 'MISS') { this.misses++; this.combo = 0; return; }
    this.score += r === 'PERFECT' ? 100 : r === 'GOOD' ? 75 : 50;
    if (r === 'PERFECT') this.perfect++; else if (r === 'GOOD') this.good++; else this.ok++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
  }

  /** Main.processInput: the result, or null for a lane out of 0-3 or a time that isn't one. */
  input(lane: unknown, time: unknown): Result | null {
    if (!Number.isInteger(lane) || (lane as number) < 0 || (lane as number) > 3 || typeof time !== 'number' || !Number.isFinite(time) || time < 0) return null;
    this.time = time;
    this.tick(time);
    if (this.head >= this.q.length) return 'MISS';
    const next = this.q[this.head];
    if (next.lane !== lane) { this.hit('MISS'); return 'MISS'; }
    const d = time - next.time, ad = Math.abs(d);
    const r: Result = ad <= 0.1 ? 'PERFECT' : ad <= 0.2 ? 'GOOD' : ad <= 0.3 ? (d < 0 ? 'EARLY' : 'LATE') : 'MISS';
    if (r !== 'MISS') this.head++;
    this.hit(r);
    return r;
  }

  /** The run so far, the game's tokens since the last call: confirmed (GameScore's rules), or refused. */
  addRun(more: unknown) {
    if (this.refused) return;
    if (typeof more !== 'string' || this.run.length + more.length > 400_000) { this.refused = true; return; }
    if (!more) return;
    this.run += more;
    const c = runFits(this.run, this.chart, this.bpm) ? replayRun(this.run, tileTimes(this.chart, this.bpm)) : null;
    if (!c) { this.refused = true; return; }
    this.confirmed = { score: c.score, accuracy: c.accuracy, maxCombo: c.maxCombo };
  }

  /** A press Main took (not turned down). */
  review() { this.reviewed++; }

  /** Main.checkMissedNotes. */
  tick(time: unknown) {
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) return;
    this.time = time;
    while (this.head < this.q.length && time > this.q[this.head].time + 0.3) { this.head++; this.hit('MISS'); }
  }

  state(): PlayState {
    const hits = this.perfect + this.good + this.ok;
    const total = hits + this.misses;
    return {
      confirmed: this.refused ? null : { ...this.confirmed }, reviewed: this.reviewed, review: this.reviewer.toJSON(),
      score: this.score, combo: this.combo, maxCombo: this.maxCombo, hits, misses: this.misses,
      accuracy: total ? ((this.perfect * 100 + this.good * 75 + this.ok * 50) / (total * 100)) * 100 : 0,
      time: this.time, left: this.q.length - this.head, upcoming: this.q.slice(this.head, this.head + UPCOMING),
    };
  }
}

const runs = new Map<string, MainRun>();
let next = 0;

/** Starts a run (POST /api/play). */
export function startRun(song: Song, difficulty: Difficulty, part?: { from: number; to: number }) {
  const run = new MainRun(song, difficulty, part);
  const id = `run-${++next}-${Math.random().toString(36).slice(2, 8)}`;
  runs.set(id, run);
  while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value!);
  return { run: id, notes: run.total, state: run.state() };
}

/** What the player did, in order, and the run since (POST /api/play/:run/inputs); null when there's no such run. */
export function runInputs(id: string, inputs: PlayInput[], more?: unknown) {
  const run = runs.get(id);
  if (!run) return null;
  if (run.kept) return { error: "That run is over: its score was kept" as string };
  const results: (Result | null)[] = [];
  for (const i of inputs as unknown[]) {
    // The review first: what it turns down never reaches Main.
    if (run.reviewer.review(i) !== null) {
      if (i && typeof i === 'object' && 'lane' in i) results.push(null);
      continue;
    }
    const x = i as { lane?: number; time: number };
    if (x.lane !== undefined) {
      const r = run.input(x.lane, x.time);
      if (r) run.review();
      results.push(r);
    } else run.tick(x.time);
  }
  if (more !== undefined) run.addRun(more);
  if (!run.judged.refused) run.reviewer.reviewRun(run.judged.run);
  return { results, state: run.state() };
}

/**
 * A run's score is to be kept (the scores route; PlayController.keep): a run reviewed here, of this
 * song and difficulty, not practice, the run the controller confirmed, passed, not kept before.
 * Null when it may be kept, else the status and why not.
 */
export function keepRun(id: unknown, songId: string, difficulty: Difficulty, judged: string): { status: number; message: string } | null {
  const run = typeof id === 'string' ? runs.get(id) : undefined;
  if (!run) return { status: 422, message: "The controller didn't review this run (the server may have restarted during it), so its score wasn't kept" };
  if (run.songId !== songId || run.difficulty !== difficulty || run.practice) return { status: 422, message: 'That run was of another song or difficulty' };
  if (run.kept) return { status: 409, message: "That run's score was already kept" };
  if (run.judged.refused || run.judged.run !== judged) return { status: 422, message: "The run doesn't match the one the controller reviewed, so its score wasn't kept" };
  run.reviewer.reviewRun(judged);
  if (!run.reviewer.passed) return { status: 422, message: `The controller flagged this run (${run.reviewer.why()}), so its score wasn't kept` };
  run.kept = true;
  return null;
}

/** The player says how a run felt (the feel route; PlayController.rate): a kept run of this song and difficulty, once. */
export function rateRun(id: unknown, songId: string, difficulty: Difficulty): { status: number; message: string } | null {
  const run = typeof id === 'string' ? runs.get(id) : undefined;
  if (!run) return { status: 422, message: "The controller didn't review this run, so how it felt wasn't counted" };
  if (run.songId !== songId || run.difficulty !== difficulty) return { status: 422, message: 'That run was of another song or difficulty' };
  if (!run.kept) return { status: 422, message: 'Only a run whose score was kept can say how it felt' };
  if (run.rated) return { status: 409, message: 'That run already said how it felt' };
  run.rated = true;
  return null;
}
