// Replays a real listen from its log (the dev tools' "Download listen log": the timing of the
// listen, no audio) through the recording's placement (src/mapping/capture.ts), and says what
// happened: how much of the song the recording holds, where the gaps are, when the tab was hidden,
// when the position reads broke off, and the stretches of playback.
//
//   node tools/replay-listen.mjs <listen-log.json>        (from frontend/; Node 23.6+ runs the .ts directly)

import { readFileSync } from 'node:fs';
import { holesIn, missLimit, place, stretchesOf } from '../src/mapping/capture.ts';

const file = process.argv[2];
if (!file) { console.log('usage: node tools/replay-listen.mjs <listen-log.json>'); process.exit(1); }
const log = JSON.parse(readFileSync(file, 'utf8'));
const PLAYING = 1;
const m = log.marks;
const marks = m.c.map((c, i) => ({ c, v: m.v[i], playing: m.state[i] === PLAYING }));
const sr = log.sr;
const dur = log.duration || 600;
const s = (x) => `${x.toFixed(1)} s`;

console.log(`${log.videoId} · ${log.at} · ${s(dur)} · ${sr} Hz · capture delay ${Math.round(log.delay * 1000)} ms${log.calibrated ? ' (measured)' : ''}`);
console.log(`chosen: ${log.placement ?? '?'}`);
console.log(`${m.c.length} position reads, ${log.chunks.c.length} chunks of sound`);

// When the tab was hidden, and where the reads broke off for more than a quarter second.
const spans = (pred) => {
  const out = [];
  let start = null;
  for (let i = 0; i < m.c.length; i++) {
    if (pred(i) && start === null) start = m.c[i];
    if (!pred(i) && start !== null) { out.push([start, m.c[i]]); start = null; }
  }
  if (start !== null) out.push([start, m.c[m.c.length - 1]]);
  return out;
};
const t0 = m.c[0] ?? 0;
const rel = ([a, b]) => `${s(a - t0)}-${s(b - t0)}`;
const hidden = spans((i) => m.hidden[i] === 1);
console.log(`tab hidden: ${hidden.length ? hidden.map(rel).join(', ') : 'never'}`);
const gaps = [];
for (let i = 1; i < m.c.length; i++) if (m.c[i] - m.c[i - 1] > 0.25) gaps.push([m.c[i - 1], m.c[i]]);
console.log(`reads broke off (> 0.25 s): ${gaps.length ? `${gaps.length}: ${gaps.slice(0, 12).map(rel).join(', ')}${gaps.length > 12 ? ', …' : ''}` : 'never'}`);
const states = [];
for (let i = 0; i < m.c.length; i++) if (i === 0 || m.state[i] !== m.state[i - 1]) states.push(`${s(m.c[i] - t0)}: ${m.state[i]}`);
console.log(`player states (1 playing, 2 paused, 3 buffering, 0 ended, -1 unstarted): ${states.slice(0, 20).join(' · ')}${states.length > 20 ? ' · …' : ''}`);

// The audio clock against the video (and the page's clock, in logs that have it): every 10 s of
// audio clock, video seconds per audio-clock second. Well off 1 means the browser's audio fell
// behind (the computer too busy), and that much of the sound never reached the capture.
const speeds = [];
for (let i = 1, a = 1; i < m.c.length; i++) {
  if (m.c[i] - m.c[a] < 10 && i < m.c.length - 1) continue;
  if (m.state[a] === PLAYING && m.state[i] === PLAYING) {
    const vs = (m.v[i] - m.v[a]) / (m.c[i] - m.c[a]);
    const ws = m.w ? (m.w[i] - m.w[a]) / (m.c[i] - m.c[a]) : NaN;
    const fps = m.w ? (i - a) / (m.w[i] - m.w[a]) : NaN;
    speeds.push({ at: m.c[a] - t0, vs, ws, fps });
  }
  a = i;
}
const off = speeds.filter((x) => Math.abs(x.vs - 1) > 0.02);
console.log(`audio clock: ${off.length ? `fell behind in ${off.length} of ${speeds.length} windows of 10 s, from ${s(off[0].at)}: video ×${Math.min(...off.map((x) => x.vs)).toFixed(2)} to ×${Math.max(...off.map((x) => x.vs)).toFixed(2)} its speed` : 'kept up with the video'}`);
if (m.w) console.log(`page clock per audio second: ${speeds.map((x) => x.ws.toFixed(2)).join(' ')}\nreads per page second: ${speeds.map((x) => Math.round(x.fps)).join(' ')}`);

// The stretches, and how much of the video the placed recording holds (every chunk filled with sound).
const st = stretchesOf(marks);
console.log(`stretches: ${st.length}: ${st.slice(0, 12).map((x) => `${rel([x.from, x.to])} @${x.offset.toFixed(3)}`).join(', ')}${st.length > 12 ? ', …' : ''}`);
const chunks = log.chunks.c.map((c, i) => ({ c, d: new Float32Array(log.chunks.n[i]).fill(1) }));
const placed = place(chunks, marks, sr, dur);
const pcm = placed.pcm;
if (placed.followed) console.log(`followed the drift in ${placed.followed} stretch(es): ${s(placed.lost)} of the video never reached the capture, the rest spread over it`);
let held = 0;
const missing = [];
let from = -1;
for (let i = 0; i < Math.ceil(dur * sr); i++) {
  const on = i < pcm.length && pcm[i] !== 0;
  if (on) held++;
  if (!on && from < 0) from = i;
  if (on && from >= 0) { if (i - from > sr * 0.5) missing.push([from / sr, i / sr]); from = -1; }
}
if (from >= 0 && Math.ceil(dur * sr) - from > sr * 0.5) missing.push([from / sr, dur]);
console.log(`the recording holds ${s(held / sr)} of ${s(dur)} (${Math.round((held / sr / dur) * 100)}%)`);
console.log(`missing (video time, > 0.5 s): ${missing.length ? missing.slice(0, 12).map(([a, b]) => `${s(a)}-${s(b)}`).join(', ') : 'nothing'}${missing.length > 12 ? ', …' : ''}`);
// The check the listen makes before mapping (listen.ts: too much of the song missed is an error).
const missed = placed.lost + holesIn(pcm, sr);
console.log(`missed: ${s(missed)} (the limit is ${s(missLimit(dur))}): ${missed > missLimit(dur) ? 'not mapped, the player is asked to listen again' : 'mapped'}`);
