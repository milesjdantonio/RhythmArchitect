import { useEffect, useRef, useState } from 'react';
import { ytClockSnaps } from '../audio/youtube';
import { backdropInfo, perf, stageInfo, type FrameStats, type ProfileId, type Recorder } from '../lib/perf';

export interface SavedRun extends FrameStats {
  id: ProfileId;
  difficulty: string;
  resyncs: number;
  longFrames: number;
  at: number;
}

const KEY = 'rythm-architect:perf-runs';
export function loadRuns(): Partial<Record<ProfileId, SavedRun>> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}
function saveRun(r: SavedRun) {
  const all = loadRuns();
  all[r.id] = r;
  localStorage.setItem(KEY, JSON.stringify(all));
}
export const clearRuns = () => localStorage.removeItem(KEY);

const GRAPH = 240;

/**
 * The live meter over the game: frame times (graph and percentiles), visible hitches, freezes,
 * clock jumps, video-clock resyncs and the browser's own long-frame reports with where the time
 * went. Updates four times a second (cheap enough not to move the numbers it shows). The run is
 * saved for the comparison table as it goes.
 */
export function PerfMeter({ recorder, difficulty, onBack }: { recorder: Recorder; difficulty: string; onBack: () => void }) {
  const [open, setOpen] = useState(true);
  const [s, setS] = useState<FrameStats | null>(null);
  const [extra, setExtra] = useState({ resyncs: 0, longFrames: 0, culprits: [] as [string, number][], dpr: 0, fx: 1 });
  const graph = useRef<HTMLCanvasElement>(null);
  const snaps0 = useRef(ytClockSnaps());
  const loaf = useRef({ count: 0, by: new Map<string, number>() });

  // The browser's long-animation-frame reports (Chrome): frames over 50 ms and the scripts in them.
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) return;
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { scripts?: { invoker?: string; sourceURL?: string; duration: number }[]; blockingDuration?: number })[]) {
        loaf.current.count++;
        const scripts = e.scripts ?? [];
        let scripted = 0;
        for (const sc of scripts) {
          const file = (sc.sourceURL ?? '').split('/').pop()?.split('?')[0] || 'page';
          const name = `${file}${sc.invoker ? ` · ${sc.invoker.slice(0, 40)}` : ''}`;
          loaf.current.by.set(name, (loaf.current.by.get(name) ?? 0) + sc.duration);
          scripted += sc.duration;
        }
        // Time not in any script: style, layout, paint and the GPU hand-off.
        const rest = Math.max(0, e.duration - scripted);
        if (rest > 5) loaf.current.by.set('render (style, layout, paint)', (loaf.current.by.get('render (style, layout, paint)') ?? 0) + rest);
      }
    });
    try { po.observe({ type: 'long-animation-frame', buffered: false }); } catch { return; }
    return () => po.disconnect();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const st = recorder.stats();
      // Counted from the first beat, like the frames (the video's start and the click to start are not the game).
      if (!st.frames) { snaps0.current = ytClockSnaps(); loaf.current = { count: 0, by: new Map() }; }
      setS(st);
      const culprits = [...loaf.current.by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const resyncs = ytClockSnaps() - snaps0.current;
      setExtra({ resyncs, longFrames: loaf.current.count, culprits, dpr: stageInfo.dpr, fx: stageInfo.fx });
      if (st.frames > 120) saveRun({ ...st, id: perf().id, difficulty, resyncs, longFrames: loaf.current.count, at: Date.now() });
      drawGraph(graph.current, recorder.recent(GRAPH), recorder.refreshMs);
    }, 250);
    return () => window.clearInterval(id);
  }, [recorder, difficulty]);

  const p = perf();
  const bad = (v: number, warn: number, crit: number) => (v >= crit ? 'is-crit' : v >= warn ? 'is-warn' : '');
  const perMin = (n: number) => (s && s.seconds > 0 ? (n / s.seconds) * 60 : 0);

  return (
    <aside className={`perf-meter ${open ? '' : 'is-closed'}`} aria-label="Performance meter">
      <header>
        <span className="eyebrow">{p.name}</span>
        <button type="button" className="perf-meter-btn" onClick={onBack}>Versions</button>
        <button type="button" className="perf-meter-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Hide' : 'Meter'}</button>
      </header>
      {open && (
        <>
          <canvas ref={graph} className="perf-graph" width={GRAPH} height={56} aria-hidden />
          {!s || !s.frames ? <p className="muted perf-wait">Numbers start at the first beat.</p> : (
            <dl className="perf-grid mono">
              <div><dt>FPS</dt><dd className={bad(-s.fps, -50, -30)}>{s.fps.toFixed(0)}</dd></div>
              <div><dt>Avg</dt><dd>{s.avg.toFixed(1)} ms</dd></div>
              <div><dt>p95</dt><dd className={bad(s.p95, 25, 50)}>{s.p95.toFixed(1)}</dd></div>
              <div><dt>p99</dt><dd className={bad(s.p99, 33, 80)}>{s.p99.toFixed(1)}</dd></div>
              <div><dt>Worst</dt><dd className={bad(s.worst, 50, 150)}>{s.worst.toFixed(0)} ms</dd></div>
              <div><dt>Hitches/min</dt><dd className={bad(perMin(s.drops), 5, 30)}>{perMin(s.drops).toFixed(1)}</dd></div>
              <div><dt>Freezes</dt><dd className={bad(s.stalls, 1, 3)}>{s.stalls}</dd></div>
              <div><dt>Clock jumps</dt><dd className={bad(s.jumps, 3, 20)}>{s.jumps}{s.worstJump ? ` · ${s.worstJump.toFixed(0)} ms` : ''}</dd></div>
              <div><dt>Video resyncs</dt><dd className={bad(extra.resyncs, 1, 3)}>{extra.resyncs}</dd></div>
              <div><dt>Long frames</dt><dd className={bad(extra.longFrames, 3, 15)}>{extra.longFrames}</dd></div>
              <div><dt>Renderer</dt><dd>{stageInfo.backend || 'WebGL'}</dd></div>
              <div><dt>Stage CPU</dt><dd>{stageInfo.cpuMs ? `${stageInfo.cpuMs.toFixed(1)} ms (draw ${stageInfo.drawMs.toFixed(1)})` : '–'}</dd></div>
              <div><dt>GPU</dt><dd>{stageInfo.gpuMs ? `${stageInfo.gpuMs.toFixed(1)} ms` : stageInfo.backend ? (stageInfo.gpuTimer ? '…' : 'no timer') : '–'}</dd></div>
              <div><dt>Backdrop</dt><dd>{backdropInfo.ms ? `${backdropInfo.ms.toFixed(1)} ms · ${backdropInfo.thread}` : '–'}</dd></div>
              <div><dt>Played</dt><dd>{s.seconds.toFixed(0)} s</dd></div>
            </dl>
          )}
          {extra.culprits.length > 0 && (
            <div className="perf-culprits">
              <span className="eyebrow">Where long frames went</span>
              <ol className="mono">{extra.culprits.map(([k, v]) => <li key={k}><span>{k}</span><span>{v.toFixed(0)} ms</span></li>)}</ol>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function drawGraph(c: HTMLCanvasElement | null, times: number[], refresh: number) {
  const g = c?.getContext('2d');
  if (!c || !g) return;
  const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  // Guides: the display's frame, and 2× it (a dropped frame).
  const y = (ms: number) => H - Math.min(H, (ms / 66) * H);
  g.strokeStyle = 'rgb(255 255 255 / 0.14)';
  g.lineWidth = 1;
  for (const ms of [refresh, refresh * 2]) { g.beginPath(); g.moveTo(0, y(ms) + 0.5); g.lineTo(W, y(ms) + 0.5); g.stroke(); }
  const x0 = W - times.length;
  for (let i = 0; i < times.length; i++) {
    const ms = times[i];
    g.fillStyle = ms > 100 ? '#ff5a78' : ms > refresh * 1.5 ? '#ffc864' : 'rgb(140 220 255 / 0.85)';
    const top = y(ms);
    g.fillRect(x0 + i, top, 1, H - top);
  }
}
