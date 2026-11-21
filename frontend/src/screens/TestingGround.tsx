import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import type { Difficulty, Song } from '../api/types';
import { Icon } from '../components/Icon';
import { EASE_OUT } from '../lib/motion';
import { href, navigate } from '../lib/router';
import { fetchSong } from '../library/songs';

/**
 * The testing ground (#/testingGround): the same song mapped two ways, side by side, to play and
 * compare (the user, Nov 20). Each is a song file in public/testing/ (id "test-…": the song cache
 * reads those from there, library/songs.ts), so they never touch the bank; runs on them aren't saved.
 */
const TESTS: { id: string; label: string; detail: string }[] = [
  { id: 'test-oye-lines', label: 'New: the song’s own lines', detail: 'Every difficulty built from the parts (leadline.ts): Ultra hits every note of the lead, the piano solo note by note, chords where two parts strike together.' },
  { id: 'test-oye-model', label: 'Current: the trained mapper', detail: 'Ultra as the trained mapper (Ensomi R2) charts it, with the sung syllables added (as it is in the bank now).' },
];

export function TestingGround() {
  const [songs, setSongs] = useState<Record<string, Song | null>>({});
  useEffect(() => {
    for (const t of TESTS) fetchSong(t.id).then((s) => setSongs((x) => ({ ...x, [t.id]: s })), () => setSongs((x) => ({ ...x, [t.id]: null })));
  }, []);
  const play = (id: string, d: Difficulty) => navigate(href.play(id, d));

  return (
    <div className="testing">
      <motion.header className="testing-head" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE_OUT }}>
        <button type="button" className="btn btn-sm" onClick={() => navigate(href.home())}><Icon name="back" size={16} /> Menu</button>
        <div>
          <h1>Testing ground</h1>
          <p className="label">Open Your Eyes · CYE · the same song mapped two ways · runs here aren’t saved</p>
        </div>
      </motion.header>
      <div className="testing-cards">
        {TESTS.map((t, i) => {
          const s = songs[t.id];
          const ultra = s?.charts.ultra;
          return (
            <motion.section key={t.id} className="testing-card" aria-labelledby={`${t.id}-h`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.05 + i * 0.05, ease: EASE_OUT }}>
              <h2 id={`${t.id}-h`}>{t.label}</h2>
              <p className="muted">{t.detail}</p>
              {s === null ? <p className="form-error" role="alert">Couldn’t load this map.</p>
                : !s ? <p className="muted" role="status">Loading…</p>
                : (
                  <>
                    <dl className="testing-stats">
                      <div><dt>Ultra</dt><dd className="mono">{ultra?.notes.length} tiles{ultra?.stars ? ` · ${ultra.stars.toFixed(1)}★` : ''}</dd></div>
                      <div><dt>Easy · Medium · Hard</dt><dd className="mono">{(['easy', 'medium', 'hard'] as const).map((d) => s.charts[d].notes.length).join(' · ')}</dd></div>
                    </dl>
                    <button type="button" className="btn btn-primary" onClick={() => play(t.id, 'ultra')} aria-label={`Play Ultra: ${t.label}`}><Icon name="play" /> Play Ultra</button>
                    <div className="testing-more">
                      {(['easy', 'medium', 'hard'] as const).map((d) => (
                        <button key={d} type="button" className="btn btn-ghost btn-sm" onClick={() => play(t.id, d)}>{d[0].toUpperCase() + d.slice(1)}</button>
                      ))}
                    </div>
                  </>
                )}
            </motion.section>
          );
        })}
      </div>
    </div>
  );
}
