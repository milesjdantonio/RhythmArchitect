// The timing of the last listening pass, to find out what went wrong in a real listen: every read
// of the video's position (smoothed and as the player reported it, its state, whether the tab was
// hidden) and when each chunk of sound arrived. No audio. The dev tools offer it as a download
// ("Download listen log") so a listen can be replayed exactly (capture.ts placeChunks takes it).

export interface ListenLog {
  version: 1;
  at: string;
  videoId: string;
  /** The video's length (s), the recording's sample rate, the capture delay (s). */
  duration: number;
  sr: number;
  delay: number;
  calibrated: boolean;
  /** How the recording was lined up (chooseRecording's note). */
  placement?: string;
  userAgent: string;
  /**
   * Position reads: audio-context time, smoothed position, the player's report, its state, tab
   * hidden (1), and the page's own clock (s: tells an audio clock that fell behind, or few frames).
   */
  marks: { c: number[]; v: number[]; raw: number[]; state: number[]; hidden: number[]; w?: number[] };
  /** Chunks of sound: audio-context time of the first sample (less the delay), samples. */
  chunks: { c: number[]; n: number[] };
}

const KEY = 'rythm-architect:last-listen';
let last: ListenLog | null = null;
const r = (x: number, d = 1000) => Math.round(x * d) / d;

export function newListenLog(videoId: string, duration: number, sr: number, delay: number, calibrated: boolean): ListenLog {
  return {
    version: 1, at: new Date().toISOString(), videoId, duration: r(duration), sr, delay: r(delay, 10000), calibrated,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    marks: { c: [], v: [], raw: [], state: [], hidden: [], w: [] },
    chunks: { c: [], n: [] },
  };
}

export function logMark(log: ListenLog, c: number, v: number, raw: number, state: number, hidden: boolean, wall: number) {
  const m = log.marks;
  m.c.push(r(c, 10000)); m.v.push(r(v, 10000)); m.raw.push(r(raw)); m.state.push(state); m.hidden.push(hidden ? 1 : 0); m.w?.push(r(wall, 10000));
}

export function logChunk(log: ListenLog, c: number, n: number) {
  log.chunks.c.push(r(c, 100000)); log.chunks.n.push(n);
}

/** For the browser's storage (a few MB at most): position reads at most every 50 ms, plus every change of state or hiding and every jump. */
function thinned(log: ListenLog): ListenLog {
  const m = log.marks;
  const out: ListenLog['marks'] = { c: [], v: [], raw: [], state: [], hidden: [], w: [] };
  let at = -Infinity, prevD = NaN, prevState = NaN, prevHidden = NaN;
  for (let i = 0; i < m.c.length; i++) {
    const d = m.c[i] - m.v[i];
    if (m.c[i] - at < 0.05 && m.state[i] === prevState && m.hidden[i] === prevHidden && Math.abs(d - prevD) < 0.03) continue;
    at = m.c[i]; prevD = d; prevState = m.state[i]; prevHidden = m.hidden[i];
    out.c.push(m.c[i]); out.v.push(m.v[i]); out.raw.push(m.raw[i]); out.state.push(m.state[i]); out.hidden.push(m.hidden[i]); if (m.w) out.w!.push(m.w[i]);
  }
  return { ...log, marks: out };
}

/** Keeps the log of the listen just made (in memory, and in the browser's storage across reloads). */
export function saveListenLog(log: ListenLog, placement: string) {
  log.placement = placement;
  last = log;
  try {
    localStorage.setItem(KEY, JSON.stringify(thinned(log)));
  } catch { /* storage full or blocked: memory only */ }
}

/** The log of the last listen (of this video, when given), or null. */
export function lastListenLog(videoId?: string): ListenLog | null {
  let log = last;
  if (!log) {
    try {
      const raw = localStorage.getItem(KEY);
      log = raw ? (JSON.parse(raw) as ListenLog) : null;
    } catch {
      log = null;
    }
  }
  return log && (!videoId || log.videoId === videoId) ? log : null;
}

/** Saves the log as a JSON file. */
export function downloadListenLog(log: ListenLog) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(log)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `listen-log-${log.videoId}-${log.at.slice(0, 19).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
