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
import { gameProfile, setPerf } from './lib/perf';

// How the game screen draws on this browser (lib/perf.ts).
setPerf(gameProfile());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
