// The AI charter's side of mapping, shared by the app and the mock server.
//
// The browser measures the song (automap.ts: the beat grid and every sound in it, exact to a few
// ms) and sends that, as text, to the backend (POST /api/chart). The backend's AI (Claude; see
// docs/claude-backend.txt) decides which sounds become tiles on each difficulty, in which lanes,
// which are held: a ChartPlan that refers to sounds by id. This file
//   - builds the request from what the mapper found (chartRequest),
//   - turns a plan into charts, enforcing the rules so a bad answer can't break the game
//     (chartsFromPlan): every tile stays on a real sound at its measured time,
//   - and makes a plan by the old fixed rules (rulesPlan), for the mock server and tests.

import { DIFFICULTIES, type Chart, type ChartNote, type ChartPlan, type ChartRequest, type Difficulty, type PlanNote } from '../api/types';
import type { AutomapResult } from './automap';
import { buildCharts, type MelodyNote } from './charts';
import { SCALES, midiToName } from './theory';

/** What the app enforces on every plan (also sent to the backend, for its prompt). */
export const CHART_RULES: ChartRequest['rules'] = { lanes: 4, difficulties: [...DIFFICULTIES], maxNotesPerSound: 2, minHoldBeats: 1 };

/** A plan is thrown out (and the on-device charts used) if a difficulty ends up this thin. */
const MIN_NOTES = 8;

/** The request for the AI charter: what the browser measured in the song. */
export function chartRequest(r: AutomapResult, song: { title: string; artist: string; videoId?: string; seconds: number }, meter = 4): ChartRequest {
  return {
    version: 1,
    song,
    timing: { bpm: r.bpm, offset: r.offset, meter, lengthBeats: r.lengthBeats, confidence: r.report.confidence },
    barEnergy: r.barEnergy,
    sections: r.report.sections,
    cues: r.report.cues ?? [],
    events: r.events,
    rules: CHART_RULES,
  };
}

export class PlanError extends Error {}

const round = (x: number, k: number) => Math.round(x * k) / k;

/**
 * Turns the charter's plan into charts. Notes that name no sound, an out-of-range lane, or a third
 * note on one sound are dropped; holds on sounds that don't ring are made taps; a hold that runs
 * into the next tile in its lane is cut short (or made a tap). Throws PlanError when the plan is
 * unusable (a difficulty left nearly empty), so the caller can fall back to the on-device charts.
 */
export function chartsFromPlan(req: ChartRequest, plan: ChartPlan): { charts: Record<Difficulty, Chart>; fixes: number } {
  const L = req.rules.lanes, minHold = req.rules.minHoldBeats;
  const byId = new Map(req.events.map((e) => [e.id, e]));
  let fixes = 0;
  const charts = {} as Record<Difficulty, Chart>;
  for (const d of DIFFICULTIES) {
    const raw: unknown = plan?.charts?.[d];
    if (!Array.isArray(raw)) throw new PlanError(`The plan has no ${d} chart.`);
    const seen = new Set<string>();
    const perSound = new Map<number, number>();
    const picked: { t: number; lane: number; hold: boolean; len: number; midi: number | null }[] = [];
    for (const p of raw as PlanNote[]) {
      const e = byId.get(p?.id);
      const lane = p?.lane;
      if (!e || !Number.isInteger(lane) || lane < 0 || lane >= L) { fixes++; continue; }
      const key = `${e.id}:${lane}`;
      const count = perSound.get(e.id) ?? 0;
      if (seen.has(key) || count >= req.rules.maxNotesPerSound) { fixes++; continue; }
      seen.add(key);
      perSound.set(e.id, count + 1);
      const ring = Math.min(8, e.len);
      const hold = !!p.hold && ring >= minHold;
      if (p.hold && !hold) fixes++;
      const asked = typeof p.len === 'number' && Number.isFinite(p.len) ? p.len : ring;
      const len = hold ? Math.max(minHold, Math.min(ring, asked)) : Math.min(e.len, 1);
      picked.push({ t: e.t, lane, hold, len, midi: e.midi });
    }
    picked.sort((a, b) => a.t - b.t || a.lane - b.lane);
    const notes: ChartNote[] = [];
    const last: (ChartNote | undefined)[] = new Array(L);
    for (const n of picked) {
      // A hold blocks its lane until it ends (and a moment after): cut it short to make room.
      const prev = last[n.lane];
      if (prev?.hold && n.t < prev.t + prev.len + 0.25) {
        const room = round(n.t - prev.t - 0.25, 100);
        if (room >= minHold) prev.len = room;
        else { delete prev.hold; prev.len = Math.min(prev.len, 1); }
        fixes++;
      }
      const note: ChartNote = { t: n.t, lane: n.lane, pitch: midiToName(n.midi ?? 60), len: round(n.len, 100), ...(n.hold ? { hold: true } : {}) };
      notes.push(note);
      last[n.lane] = note;
    }
    if (notes.length < MIN_NOTES && req.events.length >= MIN_NOTES * 4) throw new PlanError(`The ${d} chart is nearly empty (${notes.length} tiles).`);
    charts[d] = { difficulty: d, lanes: L, notes };
  }
  return { charts, fixes };
}

/** A plan by the fixed rules of charts.ts (the mock server's stand-in for the AI; tests). */
export function rulesPlan(req: ChartRequest, mapper = 'Rules charter (no AI)'): ChartPlan {
  const melody: MelodyNote[] = req.events.map((e) => ({
    t: e.t, len: e.len, degree: e.pitched && e.midi !== null ? e.midi : e.bright, midi: e.midi ?? 60,
    strong: e.onBeat, strength: e.strength, accent: e.accent,
  }));
  const built = buildCharts(melody, SCALES.minor, 48, req.timing.bpm);
  const idAt = new Map<number, number>();
  for (const e of req.events) if (!idAt.has(Math.round(e.t * 1000))) idAt.set(Math.round(e.t * 1000), e.id);
  const charts = {} as Record<Difficulty, PlanNote[]>;
  for (const d of DIFFICULTIES) {
    charts[d] = built[d].notes.flatMap((n) => {
      const id = idAt.get(Math.round(n.t * 1000));
      return id === undefined ? [] : [{ id, lane: n.lane, ...(n.hold ? { hold: true, len: n.len } : {}) }];
    });
  }
  return { mapper, charts };
}
