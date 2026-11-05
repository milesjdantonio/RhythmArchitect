import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { api } from '../api/client';
import { DIFFICULTIES, type Difficulty, type SongSummary } from '../api/types';
import { SynthBackground } from '../background/SynthBackground';
import { Loader } from '../components/Loader';
import type { BotMode } from '../game/autoplay';
import { bus } from '../lib/bus';
import { PROFILES, Recorder, attachRecorder, measureRefresh, parseOverrides, setPerf, type ProfileId } from '../lib/perf';
import { PerfMeter, clearRuns, loadRuns, type SavedRun } from './PerfMeter';
import '../styles/demo.css';

const Play = lazy(() => import('../screens/Play').then((m) => ({ default: m.Play })));

const CANDIDATES: ProfileId[] = ['unified', 'webgpu'];
const ALL: ProfileId[] = [...CANDIDATES, 'classic'];
const HOUSE: [number, number] = [196, 272];
const BOTS: [BotMode, string][] = [['perfect', 'Autoplay (same every run)'], ['off', 'I’ll play it']];

/**
 * localhost:5173/demo: the performance lab. One song (One Dance, or ?song=<id>) played by the
 * same bot in three optimised versions of the game screen, plus today's build for reference, with
 * a meter over the game and a table to compare the runs. The winners go into the real build.
 */
export function Demo() {
  const [song, setSong] = useState<SongSummary | null | 'missing'>(null);
  const [run, setRun] = useState<ProfileId | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('hard');
  const [bot, setBot] = useState<BotMode>('perfect');
  const [runs, setRuns] = useState(loadRuns);
  const recorder = useMemo(() => new Recorder(), []);
  // Dev: tools read the recorder (tools/demo-check.mjs).
  if (import.meta.env.DEV) (window as unknown as { __recorder?: Recorder }).__recorder = recorder;

  // The song: ?song=<id> if given, else One Dance from the store.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('song');
    const pick = id
      ? api.getSong(id).then((s) => ({ id: s.id, title: s.title, artist: s.artist } as SongSummary))
      : api.search('One Dance', 'Drake').then((r) => r[0] ?? Promise.reject(new Error('none')));
    pick.then(setSong).catch(() => setSong('missing'));
  }, []);

  useEffect(() => { attachRecorder(recorder); return () => attachRecorder(null); }, [recorder]);
  // The display's refresh rate, measured here while nothing heavy runs (hitches are frames over 1.5× it).
  const [hz, setHz] = useState(0);
  useEffect(() => { measureRefresh().then((ms) => setHz(Math.round(1000 / ms))); }, []);
  useEffect(() => bus.on('hues', (h) => {
    const [a, b] = h ?? HOUSE;
    document.documentElement.style.setProperty('--hA', String(Math.round(a)));
    document.documentElement.style.setProperty('--hB', String(Math.round(b)));
  }), []);

  // The game screen's own links (Quit, Back, Esc on the results) change the hash: here that means
  // back to the versions.
  useEffect(() => {
    const back = () => { if (location.hash) { history.replaceState(null, '', location.pathname + location.search); leave(); } };
    addEventListener('hashchange', back);
    return () => removeEventListener('hashchange', back);
  }, []);
  useEffect(() => {
    if (run) return;
    setPerf('classic');
    setRuns(loadRuns());
  }, [run]);

  // Back to the versions: the profile goes back to the current build first, so the versions
  // page's backdrop (remounted by its key) starts the normal way.
  const leave = () => { setPerf('classic'); setRun(null); };

  const start = (id: ProfileId) => {
    // ?set=ticker:false,fpsCap:0 changes single settings on top of the version (experiments).
    setPerf(id, parseOverrides(new URLSearchParams(location.search).get('set')));
    recorder.reset();
    setRun(id);
  };

  if (run && song && song !== 'missing') {
    return (
      <MotionConfig reducedMotion="user">
        <SynthBackground key={`bg-${run}`} />
        <main className="screen screen-play">
          <Suspense fallback={<Loader status="Loading the stage" />}>
            <Play key={run} songId={song.id} difficulty={difficulty} bot={bot} />
          </Suspense>
        </main>
        <PerfMeter recorder={recorder} difficulty={difficulty} onBack={leave} />
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <SynthBackground key="bg-versions" />
      <main className="demo">
        <header className="demo-head">
          <span className="eyebrow">Performance lab</span>
          <h1>One stage, two renderers</h1>
          <p className="muted">
            {song === null ? 'Finding the song…' : song === 'missing' ? 'One Dance isn’t mapped in this store. Map it on the main page, or open /demo?song=<id>.' : <>Every version plays <strong>{song.title}</strong> · {song.artist}, the same way. Run each one, then compare below.</>}
            {hz > 0 && <> Display: {hz} Hz.</>}
          </p>
          <div className="demo-options">
            <label>Difficulty
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}
              </select>
            </label>
            <label>Who plays
              <select value={bot} onChange={(e) => setBot(e.target.value as BotMode)}>
                {BOTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
        </header>

        <section className="demo-cards" aria-label="Versions">
          {ALL.map((id) => {
            const p = PROFILES[id];
            return (
              <article key={id} className={`demo-card ${id === 'classic' ? 'is-reference' : ''}`}>
                <h2>{p.name}</h2>
                <p>{p.blurb}</p>
                <button type="button" className={`btn ${id === 'classic' ? 'btn-sm' : 'btn-primary'}`} disabled={!song || song === 'missing'} onClick={() => start(id)}>
                  {id === 'classic' ? 'Run for reference' : 'Run this version'}
                </button>
              </article>
            );
          })}
        </section>

        <section className="demo-table" aria-label="Comparison">
          <div className="demo-table-head">
            <h2>Comparison</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { clearRuns(); setRuns({}); }}>Clear</button>
          </div>
          <Compare runs={runs} />
          <p className="muted demo-note">
            Saved as you play (the latest run per version). Lower is better everywhere but FPS. For numbers that match a release,
            run <code>npm run build</code> and <code>npm run preview</code>, then open localhost:4173/demo; the dev server is slower.
          </p>
        </section>
      </main>
    </MotionConfig>
  );
}

function Compare({ runs }: { runs: Partial<Record<ProfileId, SavedRun>> }) {
  const rows = ALL.map((id) => [id, runs[id]] as const);
  if (!rows.some(([, r]) => r)) return <p className="muted">No runs yet.</p>;
  const perMin = (r: SavedRun, n: number) => (r.seconds > 0 ? (n / r.seconds) * 60 : 0);
  return (
    <table className="mono">
      <thead>
        <tr><th scope="col">Version</th><th>Played</th><th>FPS</th><th>p95 ms</th><th>p99 ms</th><th>Worst ms</th><th>Hitches/min</th><th>Freezes</th><th>Clock jumps</th><th>Resyncs</th><th>Long frames</th></tr>
      </thead>
      <tbody>
        {rows.map(([id, r]) => (
          <tr key={id}>
            <th scope="row">{PROFILES[id].name}</th>
            {r ? <>
              <td>{r.seconds.toFixed(0)} s · {r.difficulty}</td><td>{r.fps.toFixed(0)}</td><td>{r.p95.toFixed(1)}</td><td>{r.p99.toFixed(1)}</td><td>{r.worst.toFixed(0)}</td>
              <td>{perMin(r, r.drops).toFixed(1)}</td><td>{r.stalls}</td><td>{r.jumps}{r.worstJump ? ` (${r.worstJump.toFixed(0)} ms)` : ''}</td><td>{r.resyncs}</td><td>{r.longFrames}</td>
            </> : <td colSpan={10} className="muted">not run</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
