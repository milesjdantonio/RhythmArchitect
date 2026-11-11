import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ApiError, api } from '../../api/client';
import type { Difficulty, Song, SongSummary, VideoMatch } from '../../api/types';
import { stopSong, unlockAudio } from '../../audio/playback';
import { canListen, ListenError, listenTo, mapHeard, requestTabAudio } from '../../mapping/listen';
import { canSplit, prefetchStemModel } from '../../mapping/stemModel';
import { ytCue, ytPause, VideoError } from '../../audio/youtube';
import { holdQuiet } from '../../lib/quiet';
import { chartWithAI, fallbackNote, listenProblem, songFromListening } from '../../mapping/generate';
import { bus } from '../../lib/bus';
import { href, navigate } from '../../lib/router';
import { upsert, useSearch } from '../../library/songs';
import { enterRise } from '../../lib/entrance';
import { FrameTrace } from '../FrameTrace';
import { Icon } from '../Icon';
import { SongRow } from '../SongRow';
import type { ScopeHandle } from '../generate/ListenScope';
import { GenerateDialog, type Flow } from '../generate/GenerateDialog';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** A title's core: no brackets, no "feat." credits ("One Dance (feat. Wizkid & Kyla)" is "one dance"). */
const core = (s: string) => norm(s.replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s(feat|ft|featuring)\.?\s.*$/i, ' '));

/**
 * Name a Song: the player types a title and an artist; every song the AI has mapped is searched
 * as they type. Pick a result to put it on stage, or generate a beatmap for what they typed.
 */
export function NameSong({ onStage, difficulty, enterDelay = 0 }: { onStage?: string; difficulty: Difficulty; enterDelay?: number }) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const search = useSearch(title, artist);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [asked, setAsked] = useState({ title: '', artist: '' });
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const artistRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const generateRef = useRef<HTMLButtonElement>(null);
  const scope = useRef<ScopeHandle>(null);

  const typed = title.trim() || artist.trim();
  // The song typed is already mapped: it comes up in the results, and Generate isn't offered.
  const want = core(title), by = norm(artist);
  const mapped = !!want && search.results.some((r) => core(r.title) === want && (!by || norm(r.artist).includes(by) || by.includes(norm(r.artist))));

  const type = (field: 'title' | 'artist', v: string) => {
    if (field === 'title') setTitle(v); else setArtist(v);
    setError(null);
    bus.emit('typing', { length: (field === 'title' ? v : title).length + (field === 'artist' ? v : artist).length });
  };

  const pick = (r: SongSummary) => navigate(href.song(r.id, difficulty));

  const close = () => {
    abort.current?.abort();
    ytPause();
    setFlow(null);
    bus.emit('intensity', 0.15);
    // Back where the player was: the Generate button (enabled again once the dialog is gone).
    setTimeout(() => generateRef.current?.focus({ preventScroll: true }), 50);
  };

  async function finish(song: Song, linger = 900) {
    upsert(song);
    setFlow((f) => f && { ...f, step: 'done', progress: 1 });
    await new Promise((r) => setTimeout(r, linger));
    setFlow(null);
    bus.emit('intensity', 0.15);
    navigate(`${href.song(song.id, difficulty)}&fresh=1`);
  }

  function failed(e: unknown, prefix = '') {
    if ((e as Error).name === 'AbortError') return;
    ytPause();
    setFlow(null);
    bus.emit('intensity', 0.15);
    const known = e instanceof ApiError || e instanceof VideoError || e instanceof ListenError;
    if (!known) console.error('Generate beatmap failed:', e);
    const msg = known ? e.message : "Couldn't map that one. Try again.";
    setError(prefix ? `${prefix} ${msg}` : msg);
  }

  /** The fallback: a fan-made chart, played from the same video. */
  async function fromFanChart(video: VideoMatch, note: string) {
    const signal = abort.current?.signal;
    setFlow({ step: 'fan', video, progress: 0, note });
    try {
      const seconds = video.seconds ?? ((await ytCue(video.videoId).catch(() => 0)) || undefined);
      const song = await api.fanChart({ title: video.songTitle, artist: video.songArtist, videoId: video.videoId, seconds }, signal);
      await finish(song);
    } catch (e) {
      failed(e, note);
    }
  }

  async function generate() {
    const t = title.trim(), a = artist.trim();
    if (!t || flow) return;
    setError(null);
    unlockAudio().catch(() => {});
    // Whatever was previewing stops: the video is about to need the sound.
    stopSong();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setAsked({ title: t, artist: a });
    setFlow({ step: 'find', progress: 0 });
    bus.emit('intensity', 0.6);
    try {
      const video = await api.findVideo(t, a, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setAsked({ title: video.songTitle, artist: video.songArtist });
      if (!canListen()) { await fromFanChart(video, fallbackNote(new ListenError('', 'unsupported'))); return; }
      setFlow({ step: 'ready', video, progress: 0 });
    } catch (e) {
      failed(e);
    }
  }

  /** "Listen and map": straight from the click, because Chrome only shares a tab after one. */
  /** Listening didn't work: back to the start, with what went wrong and a Try again button. */
  function listenFailed(video: VideoMatch, e: ListenError | null) {
    ytPause();
    setError(null);
    setFlow({ step: 'ready', video, progress: 0, problem: listenProblem(e) });
  }

  async function listen() {
    const video = flow?.video;
    if (!video || flow.step !== 'ready') return;
    const signal = abort.current?.signal;
    let stream: MediaStream;
    stopSong(); // nothing but the video may be heard while it listens
    try {
      stream = await requestTabAudio();
    } catch (e) {
      // Browsers that can't share a tab's sound at all fall back to a fan chart; otherwise, say why.
      if (e instanceof ListenError && e.reason === 'unsupported') await fromFanChart(video, fallbackNote(e));
      else listenFailed(video, e instanceof ListenError ? e : null);
      return;
    }
    setFlow({ step: 'listen', video, progress: 0 });
    // With WebGPU the song is split into its parts before mapping (stems.ts): the splitter's model
    // (about 172 MB, cached after the first time) downloads while the song is listened to.
    const split = canSplit();
    void split.then((yes) => { if (yes) prefetchStemModel().catch(() => {}); });
    try {
      const heard = await listenTo(stream, {
        videoId: video.videoId, seconds: video.seconds, signal,
        onProgress: (p) => setFlow((f) => (f && f.step === 'listen' && Math.abs(f.progress - p) > 0.002 ? { ...f, progress: p } : f)),
        onHear: (pos, rms, low, mid, high) => scope.current?.hear(pos, rms, low, mid, high),
      });
      setFlow({ step: 'map', video, progress: 0.5 });
      const mapped = await mapHeard(heard.pcm, heard.sr, { split: await split, onProgress: (what, p) => scope.current?.mapping(what, p) });
      // What was measured settles into the field (every sound, the bar lines) while the AI charts it.
      {
        const r = mapped.result, spb = 60 / r.bpm;
        const bars: number[] = [];
        for (let b = r.offset; b < r.offset + r.lengthBeats * spb; b += spb * 4) bars.push(b);
        scope.current?.sounds(r.events.map((e) => ({ sec: e.sec, band: e.band === 'low' ? 0 : e.band === 'mid' ? 1 : 2, strength: e.strength })), bars);
      }
      // The AI charts it from what was measured (the backend; on-device charts if it can't).
      setFlow({ step: 'chart', video, progress: 0.75 });
      const charted = await chartWithAI(mapped, video, signal, (p) => scope.current?.progress(p));
      const song = await api.createSong(songFromListening(mapped, video, heard, charted));
      // Show the map landing on the sound it came from, then open it.
      const spb = 60 / song.bpm, at = song.source.offset ?? 0;
      scope.current?.tiles(song.charts.hard.notes.map((n) => ({ time: at + n.t * spb, lane: n.lane })),
        { easy: song.charts.easy.notes.length, medium: song.charts.medium.notes.length, hard: song.charts.hard.notes.length });
      await finish(song, 3200);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      if (e instanceof ListenError) { listenFailed(video, e); return; }
      failed(e);
    }
  }

  // "/" anywhere on the menu jumps to the search (unless the player is already typing somewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
      e.preventDefault();
      document.getElementById('song-title')?.focus();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // Escape cancels, like the Cancel button (not once the map is saved).
  // Quiet while the dialog is open: the video is the sound, and the listening pass hears the whole
  // tab, so the stage's preview and the menu music stop (and come back after).
  const open = !!flow;
  useEffect(() => { holdQuiet('generate', open); return () => holdQuiet('generate', false); }, [open]);

  const step = flow?.step;
  useEffect(() => {
    if (!step || step === 'done') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [step]);

  // Show the video as soon as it's found, so the player knows what will play.
  const videoId = flow?.video?.videoId;
  useEffect(() => {
    if (!videoId) return;
    ytCue(videoId).then((d) => {
      if (d) setFlow((f) => (f?.video && !f.video.seconds ? { ...f, video: { ...f.video, seconds: d } } : f));
    }).catch((e) => { if (flow?.step === 'ready') failed(e); });
  }, [videoId]);

  // Arrow keys move between the fields, the results and the Generate button.
  const toList = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown') return;
    const first = listRef.current?.querySelector<HTMLButtonElement>('button.result') ?? generateRef.current;
    if (first) { e.preventDefault(); first.focus(); }
  };
  const inList = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button.result') ?? []), ...(generateRef.current ? [generateRef.current] : [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? items[i - 1] : artistRef.current)?.focus(); }
  };

  return (
    <motion.section className="name-song" aria-labelledby="name-title" variants={enterRise} custom={enterDelay}>
      <FrameTrace r={17} />
      <h2 id="name-title" className="name-heading">Name a Song</h2>
      <form className="name-fields" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="line-field">
          <span className="label">Title</span>
          <input id="song-title" value={title} maxLength={120} autoComplete="off" spellCheck={false} disabled={!!flow}
            onChange={(e) => type('title', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); artistRef.current?.focus(); } toList(e); }} />
        </label>
        <label className="line-field">
          <span className="label">Artist</span>
          <input id="song-artist" ref={artistRef} value={artist} maxLength={120} autoComplete="off" spellCheck={false} disabled={!!flow}
            onChange={(e) => type('artist', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); (listRef.current?.querySelector<HTMLButtonElement>('button.result') ?? generateRef.current)?.focus(); }
              toList(e);
            }} />
        </label>
      </form>

      <div className="search-results" aria-live="polite" aria-busy={search.status === 'searching'}>
        {typed && search.status === 'error' && (
          <div className="results-note" role="alert">
            <p>{search.error}</p>
            <button type="button" className="btn btn-sm" onClick={search.retry}><Icon name="retry" size={15} /> Try again</button>
          </div>
        )}
        {typed && search.results.length > 0 && (
          <ul className="result-list" ref={listRef} onKeyDown={inList} aria-label="Mapped songs">
            <AnimatePresence initial={false}>
              {search.results.map((r, i) => (
                <SongRow key={r.id} song={r} index={i} on={r.id === onStage} onPick={() => pick(r)} />
              ))}
            </AnimatePresence>
          </ul>
        )}
        {typed && search.status === 'searching' && search.results.length === 0 && (
          <div className="result-list" aria-hidden>{[0, 1].map((i) => <div key={i} className="result skeleton" />)}</div>
        )}
        {typed && search.status === 'done' && search.results.length === 0 && (
          <p className="results-hint muted">No beatmap for that yet.</p>
        )}
        {typed && !mapped && (
          <div className="generate">
            <button ref={generateRef} type="button" className="btn btn-primary generate-btn" disabled={!title.trim() || !!flow} aria-busy={flow?.step === 'find'} onClick={generate}
              title={title.trim() ? undefined : 'Add the title (or paste a YouTube link)'}
              onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); const b = listRef.current?.querySelectorAll<HTMLButtonElement>('button.result'); (b?.[b.length - 1] ?? artistRef.current)?.focus(); } }}>
              <Icon name="sparkle" size={16} /> Generate beatmap
            </button>
          </div>
        )}
        <AnimatePresence>
          {error && (
            <motion.p className="form-error" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>{error}</motion.p>
          )}
        </AnimatePresence>
      </div>

      <GenerateDialog flow={flow} asked={asked} scope={scope} onListen={listen} onCancel={close} />
    </motion.section>
  );
}
