import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Difficulty } from '../api/types';
import { href, navigate } from '../lib/router';
import { useFavorites } from '../lib/songs';
import { enterRise } from '../lib/entrance';
import { useScrollEdges } from '../lib/useScrollEdges';
import { FrameTrace } from './FrameTrace';
import { Icon } from './Icon';
import { SongRow } from './SongRow';
import { EASE_OUT } from '../lib/motion';

/** Under Name a Song: the player's favourites in a drop-down, with their own search bar. */
export function Favorites({ onStage, difficulty, enterDelay = 0 }: { onStage?: string; difficulty: Difficulty; enterDelay?: number }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const favs = useFavorites(q, open);
  const listRef = useRef<HTMLUListElement>(null);
  useScrollEdges(listRef, [open, favs.results.length > 0]);
  const section = useRef<HTMLElement>(null);
  // Opened low in a short window: bring the drop-down into view once it has grown.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => section.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 420);
    return () => clearTimeout(t);
  }, [open]);

  return (
    <motion.section ref={section} className="favorites" aria-labelledby="fav-title" variants={enterRise} custom={enterDelay}>
      <FrameTrace r={17} />
      <button type="button" className="fav-toggle" aria-expanded={open} aria-controls="fav-panel" onClick={() => setOpen(!open)}>
        <Icon name="star" filled size={15} />
        <span id="fav-title">Favorites</span>
        {open && favs.status === 'done' && !q.trim() && <span className="count mono">{favs.results.length}</span>}
        <span className={`chev ${open ? 'is-open' : ''}`} aria-hidden><Icon name="chevron" size={16} /></span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div id="fav-panel" className="fav-panel" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE_OUT }}>
            <div className="fav-inner">
              <label className="fav-search">
                <Icon name="search" size={15} />
                <span className="sr-only">Search favorites</span>
                <input type="search" placeholder="Search favorites" value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
              </label>
              {favs.status === 'error' && (
                <div className="results-note" role="alert">
                  <p>{favs.error}</p>
                  <button type="button" className="btn btn-sm" onClick={favs.retry}><Icon name="retry" size={15} /> Try again</button>
                </div>
              )}
              {favs.results.length > 0 && (
                <ul ref={listRef} className="result-list fav-list" aria-label="Favourite songs" tabIndex={-1}>
                  <AnimatePresence initial={false}>
                    {favs.results.map((r, i) => (
                      <SongRow key={r.id} song={r} index={i} on={r.id === onStage} onPick={() => navigate(href.song(r.id, difficulty))} />
                    ))}
                  </AnimatePresence>
                </ul>
              )}
              {favs.status === 'done' && favs.results.length === 0 && (
                <p className="results-hint">{q.trim() ? 'No favourites match that.' : 'No favourites yet. Tap the star on any song to keep it here.'}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
