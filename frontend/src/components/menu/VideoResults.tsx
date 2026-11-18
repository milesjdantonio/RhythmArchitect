import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { VideoMatch } from '../../api/types';
import { stopSong } from '../../audio/playback';
import { YT_STATE, ytCue, ytOnState, ytPause, ytPlayFrom, VideoError } from '../../audio/youtube';
import { fmtTime } from '../../lib/format';
import { holdQuiet } from '../../lib/quiet';
import { EASE_OUT } from '../../lib/motion';
import type { VideoSearch } from '../../library/videos';
import { Icon } from '../Icon';
import { VideoSlot } from '../VideoSlot';

/** Quiet's key for a preview: the menu's music and song preview wait, the visuals carry on. */
const QUIET = 'yt-preview';

/** Where a preview starts: past the intro of a longer song (about a third in, at most a minute). */
const previewFrom = (seconds: number) => (seconds > 90 ? Math.min(60, Math.round(seconds * 0.3)) : 0);

/**
 * The song on YouTube, under the mapped songs: the videos that play it, best first, each with a
 * Preview (it plays right there, in its own player under the row) and a Generate beatmap for that
 * video. So the player chooses which video is mapped, rather than the search guessing.
 */
export function VideoResults({ search, busy, onStage, onGenerate }: {
  search: VideoSearch;
  /** The Generate dialog is open: no previews, no new ones. */
  busy: boolean;
  /** The song on stage (picking one stops a preview). */
  onStage?: string;
  onGenerate: (video: VideoMatch, from: HTMLElement) => void;
}) {
  const { results, status } = search;
  const [playing, setPlaying] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The video previewing (for the listeners, which outlive a render), and the latest ask.
  const now = useRef<string | null>(null);
  const ask = useRef(0);

  const stop = () => {
    ask.current++;
    if (!now.current) return;
    now.current = null;
    ytPause();
    holdQuiet(QUIET, false);
    setPlaying(null);
  };

  const preview = async (v: VideoMatch) => {
    if (playing === v.videoId) { stop(); return; }
    const mine = ++ask.current;
    setProblem(null);
    // The menu's song and music make way (and come back when the preview stops).
    stopSong();
    holdQuiet(QUIET, true, { still: false });
    now.current = v.videoId;
    setPlaying(v.videoId);
    try {
      const length = await ytCue(v.videoId);
      if (mine !== ask.current) return;
      ytPlayFrom(previewFrom(length || v.seconds || 0));
    } catch (e) {
      if (mine !== ask.current) return;
      stop();
      setProblem(e instanceof VideoError ? e.message : "That video won't play here. Try another.");
    }
  };

  // A preview stops when the video ends, the list moves on without it, a song goes on stage, the
  // Generate dialog opens, Escape is pressed, or the menu goes away.
  useEffect(() => ytOnState((s) => { if (s === YT_STATE.ENDED) stop(); }), []);
  useEffect(() => { if (playing && !results.some((v) => v.videoId === playing)) stop(); }, [results, playing]);
  useEffect(() => { stop(); }, [onStage]);
  useEffect(() => { if (busy) stop(); }, [busy]);
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) stop(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [playing]);
  useEffect(() => () => stop(), []);
  // The preview's player opens under its row: bring it into view (YouTube's player must be seen).
  useEffect(() => {
    if (!playing) return;
    const id = requestAnimationFrame(() => document.querySelector('.yt-row.is-playing')?.scrollIntoView({
      block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    }));
    return () => cancelAnimationFrame(id);
  }, [playing]);

  if (status === 'idle') return null;
  const looking = status === 'waiting' || status === 'searching';
  return (
    <section className={`yt-results ${looking && results.length ? 'is-stale' : ''}`} aria-labelledby="yt-head" aria-busy={looking}>
      <h3 id="yt-head" className="yt-head">
        <span className="yt-mark" aria-hidden /> On YouTube
        {looking && <span className="yt-busy muted">Searching</span>}
      </h3>
      {results.length > 0 && <p className="yt-note muted">Preview a video, then generate a beatmap from the one you want.</p>}
      {status === 'error' && (
        <div className="results-note" role="alert">
          <p>{search.error}</p>
          <button type="button" className="btn btn-sm" onClick={search.retry}><Icon name="retry" size={15} /> Try again</button>
        </div>
      )}
      {looking && !results.length && (
        <div className="yt-list" aria-hidden>{[0, 1].map((i) => <div key={i} className="yt-row skeleton" />)}</div>
      )}
      {problem && <p className="form-error" role="alert">{problem}</p>}
      {results.length > 0 && (
        <ul className="yt-list" aria-label="Videos on YouTube">
          <AnimatePresence initial={false}>
            {results.map((v, i) => {
              const on = playing === v.videoId;
              return (
                <motion.li key={v.videoId} className={`yt-row ${on ? 'is-playing' : ''}`} layout="position"
                  initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.28, delay: Math.min(i, 6) * 0.04, ease: EASE_OUT }}>
                  <div className="yt-main" title={`${v.title} · ${v.channel}`}>
                    <span className="yt-thumb">
                      <img src={v.thumbnail ?? `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`} alt="" loading="lazy" />
                      {v.seconds ? <span className="yt-len mono">{fmtTime(v.seconds)}</span> : null}
                    </span>
                    <span className="yt-title">{v.title}</span>
                    <span className="yt-sub">{v.channel}{i === 0 && results.length > 1 ? <span className="yt-best"> · best match</span> : null}</span>
                  </div>
                  <div className="yt-actions">
                    <button type="button" className={`btn btn-sm yt-preview-btn ${on ? 'is-on' : ''}`} data-nav aria-pressed={on} disabled={busy}
                      onClick={() => preview(v)} aria-label={`${on ? 'Stop the preview of' : 'Preview'} ${v.title}`}>
                      <Icon name={on ? 'stop' : 'play'} size={15} /> {on ? 'Stop' : 'Preview'}
                    </button>
                    <button type="button" className="btn btn-sm btn-primary yt-generate" data-nav disabled={busy}
                      onClick={(e) => onGenerate(v, e.currentTarget)} aria-label={`Generate beatmap from ${v.title}`}>
                      <Icon name="sparkle" size={15} /> Generate beatmap
                    </button>
                  </div>
                  {/* The preview plays here (YouTube's player, at least 200 px tall, nothing over it). */}
                  {on && <VideoSlot className="yt-preview" idle="show" />}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
