import { useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty, Song } from '../../api/types';
import { fmtTime } from '../../lib/format';

/** Bars a column of the map covers. */
const BARS = 4;
/** A section's name shows where it fits: about this many pixels a letter (10px, spaced capitals), plus its mark's padding. */
const LETTER = 7.4;
const PAD = 8;

/**
 * The song at a glance before a run (the start card): how dense the chosen difficulty's chart is
 * through it (tiles per 4 bars), and its sections (the song's form: sections.ts), the choruses lit.
 * It shows the chart was planned with the song: calm where the song is, busiest in its choruses.
 * In practice, a section's name picks that section as the loop (`onPick`, seconds).
 */
export function SongMap({ song, difficulty, loop, onPick }: {
  song: Song; difficulty: Difficulty;
  /** The practice loop (seconds), drawn over the map. */
  loop?: [number, number];
  onPick?: (from: number, to: number) => void;
}) {
  const spb = 60 / song.bpm;
  // The strip's width, so a name shows only where it fits (else its mark, named on hover).
  const box = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(480);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWide(e.contentRect.width || 480));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const beats = Math.max(1, song.lengthBeats);
  const meter = song.meter || 4;
  const map = useMemo(() => {
    const per = meter * BARS;
    const columns = new Array(Math.max(1, Math.ceil(beats / per))).fill(0);
    const seen = new Set<number>();
    for (const n of song.charts[difficulty]?.notes ?? []) {
      const key = Math.round(n.t * 1000);
      if (seen.has(key)) continue; // a chord is one moment
      seen.add(key);
      const k = Math.floor(n.t / per);
      if (k >= 0 && k < columns.length) columns[k]++;
    }
    const top = Math.max(1, ...columns);
    const list = (song.report?.sections ?? []).filter((s) => s.beat < beats).sort((a, b) => a.beat - b.beat);
    const sections = list.map((s, i) => ({ label: s.label, from: s.beat, to: list[i + 1]?.beat ?? beats }));
    const lit = (beat: number) => sections.some((s) => /chorus|drop/i.test(s.label) && beat >= s.from && beat < s.to);
    return { columns: columns.map((c, k) => ({ h: c / top, lit: lit((k + 0.5) * per) })), sections };
  }, [song, difficulty, beats, meter]);
  if (map.sections.length < 2) return null;
  const summary = map.sections.map((s) => s.label).join(', ');
  return (
    <div ref={box} className="song-map" style={{ '--a': loop ? `${((loop[0] / spb) / beats) * 100}%` : '0%', '--b': loop ? `${((loop[1] / spb) / beats) * 100}%` : '100%' } as React.CSSProperties}>
      <div className={`song-map-bars${loop ? ' has-loop' : ''}`} role="img" aria-label={`The chart through the song: ${summary}`}>
        {map.columns.map((c, k) => <i key={k} className={c.lit ? 'is-lit' : undefined} style={{ height: `${Math.max(6, c.h * 100)}%` }} />)}
      </div>
      <div className="song-map-sections">
        {map.sections.map((s) => {
          const left = s.from / beats, width = (s.to - s.from) / beats;
          const full = s.label.replace(/ \(drop\)$/, '');
          const name = width * wide >= full.length * LETTER + PAD ? full : '';
          const at = `${fmtTime(Math.round(s.from * spb))}–${fmtTime(Math.round(s.to * spb))}`;
          const style = { left: `${left * 100}%`, width: `${width * 100}%` };
          return onPick
            ? <button key={s.from} type="button" className="song-map-section" style={style} title={`Loop the ${s.label} (${at})`} aria-label={`Loop the ${s.label}, ${at}`}
              onClick={() => onPick(s.from * spb, s.to * spb)}>{name}</button>
            : <span key={s.from} className="song-map-section" style={style} title={`${s.label} (${at})`}>{name}</span>;
        })}
      </div>
    </div>
  );
}
