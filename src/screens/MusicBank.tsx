import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { LETTERS, groupByLetter, matchesSearch } from '../lib/bank';
import { audioRunning } from '../audio/engine';
import { setAmbient } from '../audio/ambient';
import { FrameTrace } from '../components/FrameTrace';
import { Icon } from '../components/Icon';
import { SongRow } from '../components/SongRow';
import { EASE_OUT } from '../lib/motion';
import { bankReturn, href, navigate } from '../lib/router';
import { useLibrary } from '../lib/songs';
import { useSettings } from '../lib/settings';
import { useScrollEdges } from '../lib/useScrollEdges';

/**
 * The music bank: its own screen (#/bank), opened from the menu's header. Every mapped song A to
 * Z in letter groups, a search at the top (title or artist; typing anywhere goes there), and a
 * rail to jump between letters. Picking a song puts it on stage in the menu; Back (or Esc, once
 * the search is empty) returns to the menu as it was. The menu's music plays.
 */
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
  const from = useMemo(() => /^#\/song\/([^?]+)/.exec(bankReturn.hash)?.[1], []);

  useEffect(() => { setAmbient(audioRunning() && menuMusic); }, [menuMusic]);
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

      <div className="bank-body">
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
                    <SongRow key={s.id} song={s} index={i} on={s.id === from} onPick={() => navigate(href.song(s.id))} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </motion.div>

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
