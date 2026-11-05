import { Suspense, lazy, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { SynthBackground } from './background/SynthBackground';
import { Intro, shouldShowIntro } from './intro/Intro';
import { Loader } from './components/Loader';
import { SettingsDialog } from './components/SettingsDialog';
import { Workspace } from './screens/Workspace';
import { bus } from './lib/bus';
import { EntranceContext, type EntranceStage } from './lib/entrance';
import { useRoute } from './lib/router';
import { EASE_OUT } from './lib/motion';

// The game screen (and three.js with it) loads on demand.
const Play = lazy(() => import('./screens/Play').then((m) => ({ default: m.Play })));
// The music bank: its own screen, loaded when opened.
const MusicBank = lazy(() => import('./screens/MusicBank').then((m) => ({ default: m.MusicBank })));

const HOUSE: [number, number] = [196, 272];

export function App() {
  const route = useRoute();
  const [settings, setSettings] = useState(false);
  // intro → go (the hand-off: the title flies to the menu) → done.
  const [stage, setStage] = useState<EntranceStage>(() => (shouldShowIntro() ? 'wait' : 'done'));
  const playing = route.name === 'play';
  // Behind the intro the menu is already mounted, hidden, so the hand-off has nothing to load.
  // The game screen is not: it would start playing.
  const showMain = stage !== 'wait' || !playing;
  // Picking songs happens inside one workspace, so moving between them doesn't remount it.
  const key = route.name === 'play' ? `play-${route.songId}-${route.difficulty}` : route.name === 'bank' ? 'bank' : 'workspace';

  useEffect(() => { window.scrollTo(0, 0); }, [key]);
  // The whole interface takes the colours of the song on stage (eased in CSS).
  useEffect(() => bus.on('hues', (h) => {
    const [a, b] = h ?? HOUSE;
    document.documentElement.style.setProperty('--hA', String(Math.round(a)));
    document.documentElement.style.setProperty('--hB', String(Math.round(b)));
  }), []);

  return (
    <MotionConfig reducedMotion="user">
      <SynthBackground />
      <a className="skip" href="#main">Skip to content</a>
      <AnimatePresence>
        {stage !== 'done' && <Intro key="intro" onEnter={() => setStage('go')} onDone={() => setStage('done')} />}
      </AnimatePresence>
      <EntranceContext.Provider value={stage}>
        <AnimatePresence mode="wait">
          {showMain && <motion.main
            id="main"
            key={key}
            className={`screen screen-${playing ? 'play' : route.name === 'bank' ? 'bank' : 'workspace'}${stage === 'wait' ? ' is-veiled' : ''}`}
            inert={stage === 'wait'}
            aria-hidden={stage === 'wait' || undefined}
            initial={{ opacity: 0, scale: playing ? 1.03 : 1 }}
            animate={{ opacity: 1, scale: 1, transitionEnd: { transform: 'none' } }}
            exit={{ opacity: 0, scale: playing ? 0.98 : 1.02 }}
            transition={{ duration: playing ? 0.45 : 0.3, ease: EASE_OUT }}
          >
            {route.name === 'play' ? (
              <Suspense fallback={<Loader status="Loading the stage" />}>
                <Play songId={route.songId} difficulty={route.difficulty} />
              </Suspense>
            ) : route.name === 'bank' ? (
              <Suspense fallback={<Loader status="Opening the music bank" />}>
                <MusicBank />
              </Suspense>
            ) : (
              <Workspace songId={route.songId} difficulty={route.difficulty} fresh={route.fresh} onSettings={() => setSettings(true)} />
            )}
          </motion.main>}
        </AnimatePresence>
      </EntranceContext.Provider>
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </MotionConfig>
  );
}
