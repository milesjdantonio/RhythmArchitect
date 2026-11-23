import { StrictMode } from 'react';
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
import { gameProfile, isWebKit, setPerf } from './lib/perf';
import { Unsupported, safariAnyway } from './components/Unsupported';

// How the game screen draws on this browser (lib/perf.ts).
setPerf(gameProfile());

// Safari's engine (Safari, and every browser on iPhone and iPad): not available yet, unless the
// player chose to open it anyway (components/Unsupported.tsx).
const blocked = isWebKit() && !safariAnyway();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {blocked ? <Unsupported /> : <App />}
  </StrictMode>,
);
