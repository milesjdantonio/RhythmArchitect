import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { DIFFICULTIES, type SongSummary } from '../api/types';
import { fmtTime } from '../lib/format';
import { updateSong } from '../lib/songs';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { EASE_OUT } from '../lib/motion';

const sourceLabel = (r: SongSummary) =>
  r.source.standIn ? 'stand-in' : r.source.kind === 'stream' ? 'real audio' : r.source.kind === 'youtube' ? 'YouTube' : '';

/**
 * One song in a list (search results, favourites): cover, title, artist, a meta line with the best
 * grades, and a star. The title gets the row's full width (two lines, then an ellipsis; the whole
 * name is in the tooltip), so long names stay readable in the narrow favourites column.
 */
export function SongRow({ song: r, on, onPick, index }: { song: SongSummary; on: boolean; onPick: () => void; index: number }) {
  const [fav, setFav] = useState(r.favorite);
  const [fresh, setFresh] = useState(false);
  useEffect(() => setFav(r.favorite), [r.favorite]);
  const toggle = () => {
    const next = !fav;
    setFav(next);
    setFresh(next);
    updateSong(r.id, { favorite: next }).catch(() => setFav(!next));
  };
  const src = sourceLabel(r);
  return (
    <motion.li className="result-row" layout="position" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.28, delay: Math.min(index, 6) * 0.03, ease: EASE_OUT }}>
      <button type="button" className={`result ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={onPick} title={r.artist ? `${r.title} · ${r.artist}` : r.title}
        style={{ '--rA': r.hues[0], '--rB': r.hues[1] } as React.CSSProperties}>
        <Cover id={r.id} hues={r.hues} src={r.cover} size={48} playing={on} />
        <span className="result-title">{r.title}</span>
        <span className="result-artist">{r.artist}</span>
        <span className="result-meta">
          <span className="mono">{Math.round(r.bpm)} BPM · {fmtTime(Math.round((r.lengthBeats * 60) / r.bpm))}{src && ` · ${src}`}</span>
          <span className="grades" aria-label="Best grades">
            {DIFFICULTIES.map((d) => <span key={d} className={`grade-pip diff-${d} ${r.best?.[d] ? 'has' : ''}`} title={`${d}: ${r.best?.[d]?.grade ?? 'not played'}`}>{r.best?.[d]?.grade ?? '·'}</span>)}
          </span>
        </span>
      </button>
      <button type="button" className={`fav-btn ${fav ? 'is-on' : ''} ${fresh ? 'is-fresh' : ''}`} aria-pressed={fav} onClick={toggle} onAnimationEnd={() => setFresh(false)}
        aria-label={fav ? `Remove ${r.title} from favourites` : `Add ${r.title} to favourites`}>
        <Icon name="star" filled={fav} size={15} />
      </button>
    </motion.li>
  );
}
