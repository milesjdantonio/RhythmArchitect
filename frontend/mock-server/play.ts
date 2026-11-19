// The mock's stand-in for playing through the controller (the real one: backend PlayController,
// which runs main.Main on the song's model). Main's rules, the same in TypeScript: one queue of the
// difficulty's notes in time order; a press on the next note's lane within 0.1 s is a Perfect,
// 0.2 s Good, 0.3 s Early or Late (else a miss, as is a press on another lane); the clock passing a
// note by more than 0.3 s misses it; Score's points (100, 75, 50), combo and accuracy.

import type { Difficulty, PlayInput, PlayState, Song } from '../src/api/types';

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

  constructor(song: Song, difficulty: Difficulty, part?: { from: number; to: number }) {
    const spb = 60 / song.bpm;
    // SongWriter's queue: every tile in time order (lanes in order within a moment); practice:
    // only those starting in [from, to) seconds (Song.getChartBetween).
    this.q = [...song.charts[difficulty].notes].sort((a, b) => a.t - b.t || a.lane - b.lane).map((n) => ({ lane: n.lane, time: n.t * spb }))
      .filter((n) => !part || (n.time >= part.from && n.time < part.to));
    this.total = this.q.length;
  }

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

/** What the player did, in order (POST /api/play/:run/inputs); null when there's no such run. */
export function runInputs(id: string, inputs: PlayInput[]) {
  const run = runs.get(id);
  if (!run) return null;
  const results: (Result | null)[] = [];
  for (const i of inputs) {
    if (i && typeof i === 'object' && 'lane' in i) results.push(run.input(i.lane, i.time));
    else run.tick(i?.time);
  }
  return { results, state: run.state() };
}
