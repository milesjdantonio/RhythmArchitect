import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { LETTERS, groupByLetter, matchesSearch } from '../library/bank';
import { audioRunning, handOverPreview, previewSong, takePreview, unlockAudio, type PreviewHandle } from '../audio/playback';
import type { Song, SongSummary } from '../api/types';
import { setAmbient } from '../audio/ambient';
import { FrameTrace } from '../components/FrameTrace';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { SongRow } from '../components/SongRow';
import { VideoSlot } from '../components/VideoSlot';
import { EASE_OUT } from '../lib/motion';
import { bankReturn, href, navigate } from '../lib/router';
import { cachedSong, fetchSong, useLibrary } from '../library/songs';
import { setSettings, useSettings } from '../lib/settings';
import { bus } from '../lib/bus';
import { useScrollEdges } from '../lib/useScrollEdges';

/**
 * The music bank: its own screen (#/bank), opened from the menu's header. Every mapped song A to
 * Z in letter groups, a search at the top (title or artist; typing anywhere goes there), and a
 * rail to jump between letters. The menu's song plays on here, and picking a song plays it here
 * (its video, for a YouTube song, in the card beside the list); otherwise the menu's music plays.
 * Back (or Esc, once the search is empty) returns to the menu with the song that was playing on
 * stage, playing on from where it was.
 */
/** What the "Now playing" card shows (a song from the list, or the whole song once loaded). */
type NowSong = Pick<SongSummary, 'id' | 'title' | 'artist' | 'hues' | 'cover'> & { source: { kind: SongSummary['source']['kind'] } };

export function MusicBank() {
  const lib = useLibrary();
  const [q, setQ] = useState('');
  const shown = useMemo(() => lib.results.filter((s) => matchesSearch(s, q)), [lib.results, q]);
  const groups = useMemo(() => groupByLetter(shown), [shown]);
  const search = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useScrollEdges(scroller, [groups.length]);
  const [at, setAt] = useState<string | null>(null);
  const { menuMusic } = useSettings();
  const back = () => navigate(bankReturn.hash);
  const from = useMemo(() => {
    const id = /^#\/song\/([^?]+)/.exec(bankReturn.hash)?.[1];
    return id ? decodeURIComponent(id) : undefined;
  }, []);

  // The song playing here: at first the menu's (it handed its preview over on the way in), then
  // whatever is picked. Its card (and a YouTube song's video spot) is there from the first frame,
  // so the player is never left without a place to show; it goes if nothing turns out to be playing.
  const [nowSong, setNowSong] = useState<NowSong | undefined>(() => (from ? cachedSong(from) : undefined));
  const [playing, setPlaying] = useState(() => !!nowSong && audioRunning());
  const handle = useRef<PreviewHandle | null>(null);
  const pickTicket = useRef(0);
  useEffect(() => {
    const p = from ? takePreview(from) : null;
    if (p) { handle.current = p; p.setOnEnd(() => { if (handle.current === p) setPlaying(false); }); }
    else setPlaying(false);
    // Leaving: the menu takes it over (it shows the same song and it plays on from where it is).
    return () => {
      const cur = handle.current;
      handle.current = null;
      if (cur?.live()) handOverPreview(cur);
    };
  }, [from]);

  /** Plays the song here (the bank stays open) and makes it the menu's song for when it closes. */
  const pick = async (s: SongSummary) => {
    bankReturn.hash = href.song(s.id);
    if (nowSong?.id === s.id && handle.current?.live()) return;
    const ticket = ++pickTicket.current;
    handle.current?.stop();
    handle.current = null;
    setNowSong(s);
    setPlaying(true);
    bus.emit('hues', s.hues);
    try {
      await unlockAudio();
      // Picking a song asks for its sound, as the menu's sound button does.
      setSettings({ autoPreview: true });
      const song: Song = cachedSong(s.id) ?? await fetchSong(s.id);
      if (ticket !== pickTicket.current) return;
      setNowSong(song);
      const p = await previewSong(song, () => { if (handle.current === p) setPlaying(false); });
      if (ticket !== pickTicket.current) { p.stop(); return; }
      handle.current = p;
    } catch {
      if (ticket === pickTicket.current) setPlaying(false);
    }
  };

  useEffect(() => { setAmbient(audioRunning() && menuMusic && !playing); }, [menuMusic, playing]);
  useEffect(() => () => setAmbient(false), []);

  // The letter last jumped to: the last groups can't scroll to the top, so at the end of the list
  // the rail keeps showing it.
  const jumped = useRef<string | null>(null);
  const jump = (letter: string) => {
    const el = document.getElementById(`bank-${letter === '#' ? 'num' : letter}`);
    if (!el) return;
    jumped.current = letter;
    el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setAt(letter);
  };

  // Esc clears the search, then goes back. Typing anywhere goes to the search (as on the menu).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const input = search.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (input && input.value) { setQ(''); input.focus(); } else back();
        return;
      }
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]')) return;
      if (input && (e.key.length === 1 && e.key !== ' ' || e.key === '/')) {
        if (e.key === '/') e.preventDefault();
        input.focus();
      }
    };
    addEventListener('keydown', down);
    return () => removeEventListener('keydown', down);
  }, []);
  // A new search starts at the top of the list.
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); jumped.current = null; }, [q]);

  // The rail follows the scroll: the letter of the group at the top of the list.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const box = el.getBoundingClientRect();
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
      if (atEnd && jumped.current) {
        const g = el.querySelector<HTMLElement>(`[data-letter="${jumped.current}"]`);
        const t = g?.getBoundingClientRect().top ?? -1;
        if (t >= box.top - 4 && t < box.bottom) { setAt(jumped.current); return; }
      }
      const top = box.top + 24;
      let cur: string | null = null;
      for (const g of el.querySelectorAll<HTMLElement>('.bank-group')) {
        if (g.getBoundingClientRect().top <= top) cur = g.dataset.letter ?? null; else break;
      }
      setAt(cur ?? groups[0]?.letter ?? null);
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [groups]);

  const has = new Set(groups.map((g) => g.letter));
  const count = lib.results.length;
  const searching = q.trim() !== '';
  const summary = lib.status !== 'done' ? 'Every mapped song'
    : searching ? `${shown.length} of ${count} ${count === 1 ? 'song' : 'songs'}`
    : `${count} ${count === 1 ? 'song' : 'songs'} · A to Z`;

  return (
    <div className="bank">
      <motion.header className="bank-head" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE_OUT }}>
        <button type="button" className="btn btn-sm bank-back" onClick={back}>
          <Icon name="back" size={16} /> Menu <kbd>Esc</kbd>
        </button>
        <div className="bank-title">
          <h1>Music Bank</h1>
          <p className="label" aria-live="polite">{summary}</p>
        </div>
        <label className="bank-search">
          <Icon name="search" size={16} />
          <span className="sr-only">Search the music bank</span>
          <input ref={search} type="search" placeholder="Search by title or artist" value={q} autoComplete="off" spellCheck={false}
            onChange={(e) => setQ(e.target.value)} />
          {searching && (
            <button type="button" className="bank-search-clear" onClick={() => { setQ(''); search.current?.focus(); }} aria-label="Clear the search">
              <Icon name="close" size={14} />
            </button>
          )}
        </label>
      </motion.header>

      <div className={`bank-body${playing && nowSong ? ' has-now' : ''}`}>
        <motion.div className="bank-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.05, ease: EASE_OUT }}>
          <FrameTrace r={17} />
          <div ref={scroller} className="bank-scroll" tabIndex={-1} aria-label="Songs, A to Z">
            {lib.status === 'error' && (
              <div className="results-note" role="alert">
                <p>{lib.error}</p>
                <button type="button" className="btn btn-sm" onClick={lib.retry}><Icon name="retry" size={15} /> Try again</button>
              </div>
            )}
            {lib.status !== 'done' && lib.status !== 'error' && (
              <div className="result-list bank-rows" aria-hidden>{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="result skeleton" />)}</div>
            )}
            {lib.status === 'done' && count === 0 && (
              <p className="results-hint">No songs mapped yet. Name a song in the menu and generate its beatmap.</p>
            )}
            {lib.status === 'done' && count > 0 && shown.length === 0 && (
              <p className="results-hint">No songs match “{q.trim()}”. Name it in the menu to map it.</p>
            )}
            {groups.map((g) => (
              <section key={g.letter} id={`bank-${g.letter === '#' ? 'num' : g.letter}`} className="bank-group" data-letter={g.letter} aria-labelledby={`bank-h-${g.letter === '#' ? 'num' : g.letter}`}>
                <h2 id={`bank-h-${g.letter === '#' ? 'num' : g.letter}`} className="bank-letter">
                  {g.letter}<span className="mono">{g.songs.length}</span>
                </h2>
                <ul className="result-list bank-rows">
                  {g.songs.map((s, i) => (
                    <SongRow key={s.id} song={s} index={i} on={s.id === nowSong?.id} onPick={() => { void pick(s); }} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </motion.div>

        {playing && nowSong && (
          <motion.aside className="bank-now" aria-label="Now playing" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.08, ease: EASE_OUT }}>
            {nowSong.source.kind === 'youtube'
              ? <VideoSlot className="bank-now-video" />
              : <Cover id={nowSong.id} hues={nowSong.hues} src={nowSong.cover} size={96} playing />}
            <p className="label bank-now-label"><Icon name="notes" size={13} /> Now playing</p>
            <p className="bank-now-title">{nowSong.title}</p>
            <p className="bank-now-artist">{nowSong.artist}</p>
          </motion.aside>
        )}

        <motion.nav className="bank-rail" aria-label="Jump to a letter" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.1, ease: EASE_OUT }}>
          {LETTERS.map((l) => (
            <button key={l} type="button" disabled={!has.has(l)} className={at === l ? 'is-on' : ''} aria-current={at === l || undefined} onClick={() => jump(l)}
              aria-label={l === '#' ? 'Numbers and symbols' : `Letter ${l}`}>{l}</button>
          ))}
        </motion.nav>
      </div>
    </div>
  );
}
