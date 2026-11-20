// Where players miss, over the whole bank: every tile's misses (the songs' "heat", kept by the
// server from checked runs: backend TileHeat) summed by the pattern it's in, per difficulty, so a
// rule of the mapper that asks too much shows (a quick repeat on Easy, a chord on Medium...).
//
//   node tools/heat-report.mjs [--api=https://rhythmarchitect.onrender.com] [--min=5]
//
// Patterns: the gap to the tile before (seconds), the same lane again soon (a jack), a leap of three
// lanes, in a chord, a hold, under another lane's hold. --min: groups with fewer tiles reached
// than this are left out. A group's miss rate against its difficulty's is what to read.

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const API = (arg('api') ?? 'https://rhythmarchitect.onrender.com').replace(/\/$/, '');
const MIN = Number(arg('min') ?? 5);
const D = ['easy', 'medium', 'hard', 'ultra'];

async function json(path) {
  const r = await fetch(`${API}/api${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(90_000) });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

/** The patterns a tile is in (its chart sorted by time, `i` its index there). */
function patternsOf(notes, i, spb) {
  const n = notes[i];
  const sec = (x) => x.t * spb;
  const before = notes.slice(0, i).filter((x) => sec(n) - sec(x) > 0.002);
  const prev = before[before.length - 1];
  const out = [];
  const gap = prev ? sec(n) - sec(prev) : Infinity;
  out.push(`gap ${gap < 0.15 ? '< 0.15 s' : gap < 0.25 ? '0.15-0.25 s' : gap < 0.4 ? '0.25-0.4 s' : gap < 0.8 ? '0.4-0.8 s' : '0.8 s +'}`);
  if (prev && prev.lane === n.lane && gap < 0.4) out.push('jack (same lane, under 0.4 s)');
  if (prev && Math.abs(prev.lane - n.lane) === 3 && gap < 0.4) out.push('leap of three lanes (under 0.4 s)');
  if (notes.some((x) => x !== n && Math.abs(sec(x) - sec(n)) < 0.002)) out.push('in a chord');
  if (n.hold) out.push('a hold');
  if (notes.some((x) => x.hold && x.lane !== n.lane && sec(x) < sec(n) - 0.002 && sec(n) < sec(x) + x.len * spb)) out.push('under a hold');
  return out;
}

const lib = (await json('/library')).results;
const groups = Object.fromEntries(D.map((d) => [d, new Map()]));
const totals = Object.fromEntries(D.map((d) => [d, { seen: 0, miss: 0, runs: 0, songs: 0 }]));
for (const s of lib) {
  const song = await json(`/songs/${encodeURIComponent(s.id)}`);
  if (!song.heat) continue;
  const spb = 60 / song.bpm;
  for (const d of D) {
    const h = song.heat[d];
    if (!h?.seen) continue;
    // The heat's tiles are the chart's in its stored order (as the game judged them).
    const notes = song.charts[d].notes;
    if (notes.length !== h.seen.length) continue;
    const sorted = notes.map((n, i) => ({ ...n, i })).sort((a, b) => a.t - b.t || a.lane - b.lane);
    totals[d].runs += h.runs ?? 0; totals[d].songs++;
    sorted.forEach((n, k) => {
      const seen = h.seen[n.i], miss = h.miss[n.i];
      if (!seen) return;
      totals[d].seen += seen; totals[d].miss += miss;
      for (const p of patternsOf(sorted, k, spb)) {
        const g = groups[d].get(p) ?? { seen: 0, miss: 0 };
        g.seen += seen; g.miss += miss;
        groups[d].set(p, g);
      }
    });
  }
}
const pct = (x) => `${(x * 100).toFixed(1)}%`;
let any = false;
for (const d of D) {
  const t = totals[d];
  if (!t.seen) continue;
  any = true;
  console.log(`\n${d}: ${t.runs} runs of ${t.songs} songs, ${t.seen} tiles reached, missed ${pct(t.miss / t.seen)}`);
  for (const [p, g] of [...groups[d].entries()].filter(([, g]) => g.seen >= MIN).sort((a, b) => b[1].miss / b[1].seen - a[1].miss / a[1].seen)) {
    const rate = g.miss / g.seen;
    console.log(`  ${p.padEnd(36)} ${pct(rate).padStart(6)} of ${String(g.seen).padStart(6)}${rate > (t.miss / t.seen) * 1.5 ? '   ← half again the usual' : ''}`);
  }
}
if (!any) console.log('No heat yet: the bank keeps it from runs played since it was added (the game sends each run\'s tiles).');
