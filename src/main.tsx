import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import './styles/workspace.css';
import './styles/intro.css';
import './styles/dialogs.css';
import './styles/video.css';
import './styles/game.css';
import './styles/feedback.css';
import './styles/bank.css';
import { App } from './App';
import { PROFILES, gameProfile, parseOverrides, setPerf, type ProfileId } from './lib/perf';

// localhost:5173/demo is the performance lab (the dev and preview servers serve index.html there).
// It loads on demand, so the game's own bundle doesn't carry it.
const isDemo = location.pathname === '/demo' || location.pathname === '/demo/';
const Demo = lazy(() => import('./demo/Demo').then((m) => ({ default: m.Demo })));
// How the game screen draws on this browser (lib/perf.ts). /demo picks its own per run.
// Dev only: ?perf=classic (or unified, webgpu) to compare the game on another profile.
const forced = import.meta.env.DEV ? (new URLSearchParams(location.search).get('perf') as ProfileId | null) : null;
// Dev only: ?set=key:value,… changes single settings on top (as /demo's experiments).
const sets = import.meta.env.DEV ? parseOverrides(new URLSearchParams(location.search).get('set')) : {};
if (!isDemo) setPerf(forced && forced in PROFILES ? forced : gameProfile(), sets);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDemo ? <Suspense fallback={null}><Demo /></Suspense> : <App />}
  </StrictMode>,
);
