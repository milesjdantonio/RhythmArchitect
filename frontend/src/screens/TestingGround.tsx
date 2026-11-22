import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import type { Difficulty, Song } from '../api/types';
import { Icon } from '../components/Icon';
import { EASE_OUT } from '../lib/motion';
import { href, navigate } from '../lib/router';
import { fetchSong } from '../library/songs';

/**
 * The testing ground (#/testingGround): songs mapped two ways, side by side, to play and compare
 * (the user, Nov 20). Each is a song file in public/testing/ (id "test-…": the song cache reads those
 * from there, library/songs.ts), so they never touch the bank; runs on them aren't saved. `focus` is
 * the difficulty the two ways differ on (the main button plays it).
 */
const BEFORE = 'Round 16: Medium with a few 16ths where the line has them; Ultra as it rated.';
const NOW = 'Round 18: Medium in 8ths or slower, with taps under held notes and the other parts’ big hits; Ultra a little harder (more chords on its drum hits).';
const TESTS: { id: string; song: string; label: string; detail: string; focus: Difficulty }[] = [
  { id: 'test-oye-before', song: 'Open Your Eyes', label: 'Before', detail: BEFORE, focus: 'medium' },
  { id: 'test-oye-now', song: 'Open Your Eyes', label: 'Now', detail: NOW, focus: 'medium' },
  { id: 'test-hb-before', song: 'Hotline Bling', label: 'Before', detail: BEFORE, focus: 'medium' },
  { id: 'test-hb-now', song: 'Hotline Bling', label: 'Now', detail: NOW, focus: 'medium' },
];
const cap = (d: Difficulty) => d[0].toUpperCase() + d.slice(1);

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
          <p className="label">Each song mapped two ways, to play side by side · runs here aren’t saved</p>
        </div>
      </motion.header>
      <div className="testing-cards">
        {TESTS.map((t, i) => {
          const s = songs[t.id];
          const main = s?.charts[t.focus];
          const ultra = s?.charts.ultra;
          const name = `${t.song}: ${t.label}`;
          return (
            <motion.section key={t.id} className="testing-card" aria-label={name} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.05 + i * 0.05, ease: EASE_OUT }}>
              <p className="label">{t.song}</p>
              <h2>{t.label}</h2>
              <p className="muted">{t.detail}</p>
              {s === null ? <p className="form-error" role="alert">Couldn’t load this map.</p>
                : !s ? <p className="muted" role="status">Loading…</p>
                : (
                  <>
                    <dl className="testing-stats">
                      <div><dt>{cap(t.focus)}</dt><dd className="mono">{main?.notes.length} tiles{main?.stars ? ` · ${main.stars.toFixed(2)}★` : ''}</dd></div>
                      <div><dt>Ultra</dt><dd className="mono">{ultra?.notes.length} tiles{ultra?.stars ? ` · ${ultra.stars.toFixed(2)}★` : ''}</dd></div>
                    </dl>
                    <button type="button" className="btn btn-primary" onClick={() => play(t.id, t.focus)} aria-label={`Play ${cap(t.focus)}: ${name}`}><Icon name="play" /> Play {cap(t.focus)}</button>
                    <div className="testing-more">
                      {(['easy', 'medium', 'hard', 'ultra'] as const).filter((d) => d !== t.focus).map((d) => (
                        <button key={d} type="button" className="btn btn-ghost btn-sm" onClick={() => play(t.id, d)}>{cap(d)}</button>
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
