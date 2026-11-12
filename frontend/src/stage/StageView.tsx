import { useEffect, useRef, useState } from 'react';
import type { Difficulty, Song } from '../api/types';
import { audioLevels, songTime } from '../audio/playback';
import { TRAVEL } from '../game/engine';
import { bus } from '../lib/bus';
import { isQuiet, onQuiet } from '../lib/quiet';
import { isCalm } from '../lib/settings';
import { RiveAnim } from '../rive/RiveAnim';
import { StageProxy } from './proxy';
import { Stage3D, type StageNote } from './Stage3D';

interface Props {
  song: Song | null;
  difficulty: Difficulty;
  /** While a preview plays, the ghost follows the audio clock so hits land on the music. */
  previewBeat0: number | null;
}

/** The workspace centrepiece: the 3D stage, where a ghost plays the song on stage. */
export function StageView({ song, difficulty, previewBeat0 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage3D | StageProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const clockStart = useRef(performance.now());
  const preview = useRef(previewBeat0);
  preview.current = previewBeat0;

  useEffect(() => {
    if (!Stage3D.supported()) { setFailed(true); return; }
    let s: Stage3D | StageProxy;
    try {
      // As the game screen draws it: on its own thread (WebGPU where there is one) with the game's profile.
      s = StageProxy.supported()
        ? new StageProxy(host.current!, { mode: 'showcase' })
        : new Stage3D(host.current!, { mode: 'showcase' });
    } catch {
      setFailed(true);
      return;
    }
    stage.current = s;
    s.onGhostHit = (lane, judgement) => {
      if (preview.current === null) return; // only while the song actually plays
      const r = host.current?.getBoundingClientRect();
      if (r) bus.emit('hit', { judgement, x: (r.left + s.receptor(lane).x) / innerWidth });
    };
    s.onSky = (x, y, strength) => {
      if (preview.current === null) return;
      const r = host.current?.getBoundingClientRect();
      if (r) bus.emit('sky', { x: (r.left + x) / innerWidth, y: (r.top + y) / innerHeight, strength });
    };
    let raf = 0;
    let visible = true;
    // Not while a dialog wants quiet (the Generate dialog listening and mapping: the video, the
    // capture and the mapper need the graphics chip and the processor; the stage is behind it).
    const awake = () => !isCalm() && visible && !isQuiet();
    // A stage in a worker draws on its own frames: it's told when to stop (and start again).
    const proxy = s instanceof StageProxy ? s : null;
    let asleep = false;
    const sleep = (on: boolean) => { if (proxy && on !== asleep) { asleep = on; proxy.sleep(on); } };
    const loop = () => {
      raf = 0;
      const t = preview.current !== null ? songTime(preview.current) : (performance.now() - clockStart.current) / 1000;
      s.setLevels(audioLevels());
      s.frame(t);
      sleep(false);
      if (awake()) raf = requestAnimationFrame(loop);
      // Calm (or quiet): this frame stays (the worker draws it, then holds).
      else if (proxy) setTimeout(() => { if (!raf) sleep(true); }, 100);
    };
    raf = requestAnimationFrame(loop);
    // Off screen (scrolled away on a narrow window): stop drawing until it's back.
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (awake() && !raf) raf = requestAnimationFrame(loop);
      if (!visible) sleep(true);
    });
    io.observe(host.current!);
    // The dialog closed: back to drawing.
    const offQuiet = onQuiet(() => { if (awake() && !raf) raf = requestAnimationFrame(loop); });
    const offBeat = bus.on('beat', ({ downbeat }) => s.onBeat(downbeat));
    const offCue = bus.on('cue', ({ kind, strength }) => s.cue(kind, strength));
    const offSection = bus.on('section', () => s.section());
    return () => { cancelAnimationFrame(raf); io.disconnect(); offQuiet(); offBeat(); offCue(); offSection(); s.destroy(); stage.current = null; };
  }, []);

  // Load the selected song's chart into the ghost.
  useEffect(() => {
    const s = stage.current;
    if (!s || !song) return;
    const spb = 60 / song.bpm;
    s.setHues(song.hues);
    s.setTiming(spb, TRAVEL[difficulty] * 1.25);
    const notes: StageNote[] = song.charts[difficulty].notes.map((n) => ({ lane: n.lane, time: n.t * spb, end: (n.t + (n.hold ? n.len : 0)) * spb, hold: !!n.hold }));
    s.setGhostChart(notes);
    s.setFever(difficulty === 'hard');
    clockStart.current = performance.now() + 1200; // a short run-up before the first tile lands
  }, [song?.id, song?.hues[0], difficulty, failed]);

  return (
    <div className="stage" ref={host}>
      {failed && (
        <div className="stage-fallback">
          <RiveAnim src="logo" stateMachine="Logo" className="stage-fallback-logo" fallback={<img src="/favicon.svg" alt="" width={120} height={120} />} />
          <p className="label">The 3D stage can't run on this device. Everything else works.</p>
        </div>
      )}
    </div>
  );
}
