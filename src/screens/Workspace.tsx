import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Difficulty } from '../api/types';
import { audioRunning, handOverPreview, previewSong, stopSong, takePreview, unlockAudio, wakeAudio, type PreviewHandle } from '../audio/engine';
import { setAmbient } from '../audio/ambient';
import { useQuiet } from '../lib/quiet';
import { AttractScreen } from '../components/AttractScreen';
import { Favorites } from '../components/Favorites';
import { Icon } from '../components/Icon';
import { NameSong } from '../components/NameSong';
import { NowPlaying } from '../components/NowPlaying';
import { FrameTrace } from '../components/FrameTrace';
import { bus } from '../lib/bus';
import { enterDepth, enterRise, entranceTimes, useEntrance } from '../lib/entrance';
import { openBank, parse } from '../lib/router';
import { useSong } from '../lib/songs';
import { setSettings, useSettings } from '../lib/settings';
import { RiveAnim, type RiveHandle } from '../rive/RiveAnim';
import { EASE_OUT } from '../lib/motion';

// three.js arrives after the rest of the workspace has painted.
const StageView = lazy(() => import('../stage/StageView').then((m) => ({ default: m.StageView })));

/**
 * The main screen. Left: the title and the AI (name a song: search the mapped songs, or generate
 * a beatmap). Right: gameplay only. Before a song is picked, the waiting screen; once one is,
 * the stage with a ghost playing it, and the song's name, Preview/Play and difficulty at the bottom.
 */
export function Workspace({ songId, difficulty: routeDifficulty, onSettings }: {
  songId?: string; difficulty?: Difficulty; fresh?: boolean; onSettings: () => void;
}) {
  const { song, status } = useSong(songId);
  const [difficulty, setDifficulty] = useState<Difficulty>(routeDifficulty ?? 'medium');
  const [preview, setPreview] = useState<number | null>(null);
  const [audioReady, setAudioReady] = useState(audioRunning);
  const [previewRun, setPreviewRun] = useState(0);
  const { autoPreview, menuMusic } = useSettings();
  const quiet = useQuiet();
  const wordmark = useRef<RiveHandle>(null);
  // Mounted behind the intro: wait, then come in as its title flies here (src/lib/entrance.ts).
  const stage = useEntrance();
  const [handoff] = useState(() => stage !== 'done');
  const showing = !handoff || stage !== 'wait';
  const T = entranceTimes(handoff);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!showing) return;
    const t = setTimeout(() => setSettled(true), T.settle * 1000);
    return () => clearTimeout(t);
  }, [showing]);
  // On the way in typing goes straight to the search; when the title lands, the wordmark takes
  // over with a flash.
  useEffect(() => {
    if (!handoff) return;
    if (stage === 'go' && matchMedia('(pointer: fine)').matches) document.getElementById('song-title')?.focus({ preventScroll: true });
    if (stage === 'done') wordmark.current?.fire('flash');
  }, [stage]);

  // Browsers only allow sound after the first click or key press: that wakes the audio at once.
  // The synths are built (a few hundred ms of work) once the intro has landed, so its launch runs
  // smoothly; previews and the menu's music start from then on.
  const [woke, setWoke] = useState(audioReady);
  useEffect(() => {
    if (woke) return;
    const go = () => { wakeAudio().then(() => setWoke(true)).catch(() => {}); };
    addEventListener('pointerdown', go, { once: true });
    addEventListener('keydown', go, { once: true });
    return () => { removeEventListener('pointerdown', go); removeEventListener('keydown', go); };
  }, [woke]);
  useEffect(() => {
    if (audioReady || !woke || stage !== 'done') return;
    const t = setTimeout(() => { unlockAudio().then(() => setAudioReady(true)).catch(() => {}); }, 250);
    return () => clearTimeout(t);
  }, [audioReady, woke, stage]);

  useEffect(() => {
    // Fetch the 3D stage and the game screen in the background so they open instantly.
    const t = setTimeout(() => { import('../stage/StageView').catch(() => {}); import('./Play').catch(() => {}); }, 900);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => { if (routeDifficulty) setDifficulty(routeDifficulty); }, [routeDifficulty]);
  useEffect(() => bus.on('beat', ({ downbeat }) => { if (downbeat) wordmark.current?.fire('beat'); }), []);

  // Tint everything with the song on stage.
  useEffect(() => { bus.emit('hues', song?.hues ?? null); }, [song?.id]);
  // Leaving the menu stops its music. (React's development mode also runs this on a pretend unmount,
  // still on the menu: the preview then plays on, see below.)
  useEffect(() => () => { if (parse(location.hash).name !== 'home') stopSong(); bus.emit('hues', null); bus.emit('intensity', 0.15); }, []);

  // The song on stage plays from beginning to end by itself, the ghost in sync, then again.
  // Coming back from the end screen, its replay of this song is taken over and plays on from where
  // it is (engine.ts handOverPreview).
  useEffect(() => {
    if (!song || !audioReady || !autoPreview || !showing || quiet) {
      // No preview now (previews off, a dialog that wants quiet): a handed-over one stops too.
      if (song) takePreview(song.id)?.stop();
      return;
    }
    let cancelled = false;
    let current: PreviewHandle | null = null;
    const onEnd = () => { if (!cancelled) { setPreview(null); setPreviewRun((n) => n + 1); } };
    const play = (p: PreviewHandle) => {
      if (cancelled) { p.stop(); return; }
      current = p;
      setPreview(p.beat0);
      bus.emit('intensity', 0.55);
    };
    const handed = takePreview(song.id);
    if (handed) { handed.setOnEnd(onEnd); play(handed); }
    else previewSong(song, onEnd).then(play).catch(() => {});
    return () => {
      cancelled = true;
      // Handed on, not stopped: if this runs again for the same song (React's development mode
      // runs effects twice), it plays on. Anything else stops it: another song's preview replaces
      // it, the run above stops it, leaving the menu stops it, and untaken it stops by itself.
      // Still loading: cancelled.
      const p = current as PreviewHandle | null;
      if (p) { if (p.live()) handOverPreview(p); } else stopSong();
      setPreview(null);
      bus.emit('intensity', 0.15);
    };
  }, [song?.id, audioReady, autoPreview, previewRun, showing, quiet]);

  // The menu's own music, while no song on stage is playing its preview.
  useEffect(() => { setAmbient(audioReady && showing && menuMusic && !(song && autoPreview)); }, [audioReady, showing, menuMusic, !!song, autoPreview]);
  useEffect(() => () => setAmbient(false), []);

  function toggleSound() {
    if (!audioReady) {
      unlockAudio().then(() => { setAudioReady(true); setSettings({ autoPreview: true }); }).catch(() => {});
      return;
    }
    setSettings({ autoPreview: !autoPreview });
  }

  return (
    <motion.div className="workspace" data-enter={!showing ? 'wait' : settled ? 'done' : 'go'} initial="hide" animate={showing ? 'show' : 'hide'}
      style={{ '--e-play': `${T.play}s`, '--e-name': `${T.name}s`, '--e-fav': `${T.fav}s` } as React.CSSProperties}>
      <aside className="ai-side" aria-label="Name a song">
        <header className="ai-head">
          <RiveAnim ref={wordmark} src="wordmark" stateMachine="Wordmark" inputs={{ settled: handoff }} label="Rythm Architect"
            className="ai-wordmark" style={handoff && stage !== 'done' ? { opacity: 0 } : undefined}
            fallback={<span className="wordmark-fallback">Rythm<span>Architect</span></span>} />
          <h1 className="sr-only">Rythm Architect</h1>
          <div className="head-actions">
            <motion.button type="button" className="btn btn-ghost btn-icon settings-btn" onClick={onSettings} aria-label="Settings" variants={enterRise} custom={T.settings}><Icon name="gear" /></motion.button>
            <motion.button type="button" className="btn btn-sm bank-btn" onClick={openBank} aria-label="Music bank" title="Music bank: every song, A to Z" variants={enterRise} custom={T.settings}>
              <Icon name="bank" size={15} /> Bank
            </motion.button>
          </div>
        </header>
        <NameSong onStage={song?.id} difficulty={difficulty} enterDelay={T.name} />
        <Favorites onStage={song?.id} difficulty={difficulty} enterDelay={T.fav} />
      </aside>

      <motion.section className="play-side" aria-label="Gameplay" variants={enterDepth} custom={T.play}>
        <AnimatePresence mode="wait" initial={false}>
          {song ? (
            <motion.div key="stage" className="stage-screen" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.015 }} transition={{ duration: 0.55, ease: EASE_OUT }}>
              <div className="stage-wrap">
                <span className="frame-ticks" aria-hidden />
                <FrameTrace r={5} />
                <Suspense fallback={null}>
                  <StageView song={song} difficulty={difficulty} previewBeat0={preview} />
                </Suspense>
                <AnimatePresence mode="wait">
                  <motion.p key={song.id} className="stage-caption label" initial={{ opacity: 0, letterSpacing: '0.6em' }} animate={{ opacity: 1, letterSpacing: '0.32em' }} exit={{ opacity: 0 }} transition={{ duration: 0.8, ease: EASE_OUT }}>
                    Preview · {difficulty}
                  </motion.p>
                </AnimatePresence>
              </div>
              <NowPlaying song={song} difficulty={difficulty} onDifficulty={setDifficulty} previewing={preview !== null}
                sound={audioReady && autoPreview} waiting={!audioReady && autoPreview} onSound={toggleSound} />
            </motion.div>
          ) : (
            <motion.div key="attract" className="attract-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.22 } }} transition={{ duration: 0.5, ease: EASE_OUT }}>
              <AttractScreen state={songId && status === 'missing' ? 'missing' : songId ? 'loading' : 'idle'} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
    </motion.div>
  );
}
