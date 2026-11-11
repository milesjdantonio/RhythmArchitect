import { useEffect, useRef, useState } from 'react';
import type { Difficulty, Song } from '../../api/types';
import { audioLevels, resyncPlaying } from '../../audio/playback';
import { syncStatus, syncedOffset } from '../../audio/syncer';
import { KEYS, fallTime, type Game } from '../../game/engine';
import { laneHue } from '../../game/render';
import { cuesFor } from '../../mapping/cues';
import { setSettings, useSettings } from '../../lib/settings';
import { Icon } from '../Icon';

import type { BotMode } from '../../game/autoplay';
export type { BotMode };
export type DevEffect = 'drop' | 'build' | 'flash' | 'milestone' | 'fever' | 'section' | 'miss' | 'climb';

/** What the dev tools can read and do; the game screen provides it. */
export interface DevProbe {
  game(): Game | null;
  /** Song time in seconds (negative during the count-in), or null before a run starts. */
  time(): number | null;
  fps(): number;
  particles(): number | null;
  /** Recent hit offsets in seconds (negative = early). */
  offsets(): number[];
  renderer: '3D' | '2D';
  fx(kind: DevEffect): void;
  /** Re-applies the tile speed after the slider moves. */
  retime(): void;
  deleteMap(): Promise<void>;
}

interface Props {
  song: Song;
  difficulty: Difficulty;
  probe: DevProbe;
  bot: BotMode;
  onBot: (m: BotMode) => void;
  section: string;
  onClose: () => void;
}

const BOTS: { mode: BotMode; label: string }[] = [
  { mode: 'off', label: 'Off' }, { mode: 'perfect', label: 'Perfect' }, { mode: 'human', label: 'Human' }, { mode: 'sloppy', label: 'Sloppy' },
];
const AHEAD = 4; // seconds of queue shown

/**
 * Dev tools on the game screen: autoplay, the queue of notes to come, the clock, live judgements
 * and timing, audio levels and frame rate, live tuning, effect triggers and the map's data.
 */
export function DevTools({ song, difficulty, probe, bot, onBot, section, onClose }: Props) {
  const settings = useSettings();
  const queue = useRef<HTMLCanvasElement>(null);
  const errors = useRef<HTMLCanvasElement>(null);
  const [, setTick] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  // Resync: the Map Syncer checks this song again and lines up the music playing now.
  const [resynced, setResynced] = useState(false);
  const resync = () => { resyncPlaying(); setResynced(true); setTimeout(() => setResynced(false), 1500); };
  const sync = song.source.kind === 'synth' ? undefined : syncedOffset(song);

  // Canvases redraw every frame; the text refreshes ten times a second.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      drawQueue(queue.current, probe, song.hues);
      drawErrors(errors.current, probe);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const iv = setInterval(() => setTick((n) => n + 1), 100);
    return () => { cancelAnimationFrame(raf); clearInterval(iv); };
  }, [probe, song.hues]);

  const g = probe.game();
  const t = probe.time();
  const spb = 60 / song.bpm;
  const meter = song.meter ?? 4;
  const beat = t !== null ? t / spb : null;
  const lv = audioLevels();
  const offs = probe.offsets();
  const mean = offs.length ? (offs.reduce((a, b) => a + b, 0) / offs.length) * 1000 : null;
  const next = g && t !== null ? g.notes.filter((n) => !n.judged && n.time >= t - 0.2).slice(0, 6) : [];
  const queued = g ? g.notes.filter((n) => !n.judged).length : song.charts[difficulty].notes.length;
  const cues = cuesFor(song.report);

  return (
    <aside className="devtools" aria-label="Dev tools">
      <header className="dev-head">
        <span className="label">Dev tools</span>
        <span className="mono dev-fps" title="Frames per second">{probe.fps().toFixed(0)} fps</span>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close dev tools"><Icon name="close" size={15} /></button>
      </header>

      <section className="dev-sec">
        <h3 className="dev-title">Autoplay</h3>
        <div className="seg" role="radiogroup" aria-label="Autoplay">
          {BOTS.map((b) => (
            <button key={b.mode} type="button" role="radio" aria-checked={bot === b.mode} className={bot === b.mode ? 'is-on' : ''} onClick={() => onBot(b.mode)}>{b.label}</button>
          ))}
        </div>
        <p className="dev-note">{bot === 'off' ? 'You play. Scores are saved.' : 'The bot plays this run. Its score is not saved.'}</p>
      </section>

      <section className="dev-sec">
        <h3 className="dev-title">Queue <span className="mono">{queued} to come · {g ? g.stats.judged : 0}/{g ? g.stats.total : song.charts[difficulty].notes.length} judged</span></h3>
        <canvas ref={queue} className="dev-queue" width={264} height={150} aria-label={`The next ${AHEAD} seconds of notes, lane by lane`} />
        <ol className="dev-next mono">
          {next.length ? next.map((n) => (
            <li key={n.idx}>
              <span>+{Math.max(0, n.time - (t ?? 0)).toFixed(2)}s</span>
              <span className="dev-lane" style={{ color: `hsl(${laneHue(n.lane, 4, song.hues)} 100% 75%)` }}>{KEYS[n.lane]?.label}</span>
              <span>{n.hold ? `hold ${((n.end - n.time) / spb).toFixed(2)}b` : 'tap'}</span>
              <span className="muted">beat {(n.time / spb).toFixed(2)}</span>
            </li>
          )) : <li className="muted">{g ? 'Nothing left to play' : 'Starts when the run starts'}</li>}
        </ol>
      </section>

      <section className="dev-sec">
        <h3 className="dev-title">Clock</h3>
        <dl className="dev-grid mono">
          <div><dt>Time</dt><dd>{t !== null ? `${t.toFixed(2)}s` : '–'}</dd></div>
          <div><dt>Beat</dt><dd>{beat !== null ? beat.toFixed(2) : '–'}</dd></div>
          <div><dt>Bar</dt><dd>{beat !== null && beat >= 0 ? `${Math.floor(beat / meter) + 1}.${Math.floor(beat % meter) + 1}` : '–'}</dd></div>
          <div><dt>Section</dt><dd>{section || '–'}</dd></div>
          <div><dt>Tempo</dt><dd>{song.bpm} BPM · {meter}/4</dd></div>
          <div><dt>Fall</dt><dd>{fallTime(difficulty).toFixed(2)}s</dd></div>
        </dl>
      </section>

      <section className="dev-sec">
        <h3 className="dev-title">Judgements</h3>
        <dl className="dev-grid mono">
          <div><dt>Perfect</dt><dd className="j-perfect">{g?.stats.counts.perfect ?? 0}</dd></div>
          <div><dt>Great</dt><dd className="j-great">{g?.stats.counts.great ?? 0}</dd></div>
          <div><dt>Good</dt><dd className="j-good">{g?.stats.counts.good ?? 0}</dd></div>
          <div><dt>Miss</dt><dd className="j-miss">{g?.stats.counts.miss ?? 0}</dd></div>
          <div><dt>Accuracy</dt><dd>{g ? `${(g.accuracy * 100).toFixed(1)}%` : '–'}</dd></div>
          <div><dt>Combo</dt><dd>{g ? `${g.stats.combo} · ×${g.multiplier}` : '–'}</dd></div>
          <div><dt>Health</dt><dd>{g ? `${Math.round(g.stats.health * 100)}%` : '–'}</dd></div>
          <div><dt>Mean</dt><dd>{mean !== null ? `${mean > 0 ? '+' : ''}${mean.toFixed(1)} ms` : '–'}</dd></div>
        </dl>
        <canvas ref={errors} className="dev-errors" width={264} height={34} aria-label="Hit error: where your recent hits landed, early to late" />
        {g && <p className="dev-note mono">Windows ±{Math.round(g.windows.perfect * 1000)} / {Math.round(g.windows.great * 1000)} / {Math.round(g.windows.good * 1000)} ms</p>}
      </section>

      <section className="dev-sec">
        <h3 className="dev-title">Audio and render</h3>
        <div className="dev-meters" aria-label="Audio levels">
          {(['bass', 'mid', 'high'] as const).map((b) => (
            <div key={b} className="dev-meter"><span className="label">{b}</span><i style={{ transform: `scaleX(${lv[b]})` }} /></div>
          ))}
        </div>
        <dl className="dev-grid mono">
          <div><dt>Renderer</dt><dd>{probe.renderer}</dd></div>
          <div><dt>Particles</dt><dd>{probe.particles() ?? '–'}</dd></div>
          <div><dt>Audio</dt><dd>{song.source.kind === 'stream' ? 'track' : song.source.kind === 'youtube' ? `YouTube · ${song.source.chart === 'fan' ? 'fan chart' : 'listened'}` : song.source.standIn ? 'stand-in synth' : 'synth'}</dd></div>
          <div><dt>Offset</dt><dd>{sync !== undefined ? `${sync.toFixed(3)}s` : '–'}</dd></div>
        </dl>
        <div className="dev-sync">
          <span className="label">Map Syncer</span>
          <p className="small muted">{syncStatus(song)}</p>
          <div className="dev-fx">
            <button type="button" className="btn btn-sm" onClick={resync} title="Check this song again and line up the music playing now">{resynced ? 'Resynced' : 'Resync'}</button>
          </div>
          {song.source.kind === 'youtube' && song.source.credit && <p className="small muted dev-credit">{song.source.credit}</p>}
        </div>
      </section>

      <section className="dev-sec">
        <h3 className="dev-title">Tuning</h3>
        <label className="dev-check">
          <input type="checkbox" checked={settings.noFail} onChange={(e) => { setSettings({ noFail: e.target.checked }); if (g) g.opts.noFail = e.target.checked; }} />
          <span>No fail</span>
        </label>
      </section>

      <section className="dev-sec">
        <h3 className="dev-title">Effects</h3>
        <div className="dev-fx">
          {(['drop', 'build', 'flash', 'section', 'milestone', 'fever', 'miss', 'climb'] as DevEffect[]).map((k) => (
            <button key={k} type="button" className="btn btn-sm" onClick={() => probe.fx(k)}>{k}</button>
          ))}
        </div>
      </section>

      <section className="dev-sec">
        <h3 className="dev-title">Map</h3>
        <dl className="dev-grid mono">
          <div><dt>Mapper</dt><dd>{song.report.mapper}</dd></div>
          {song.report.summary && <div><dt>Charter</dt><dd>{song.report.summary}</dd></div>}
          {song.report.beat && <div><dt>Beat</dt><dd>{song.report.beat}</dd></div>}
          <div><dt>Confidence</dt><dd>{Math.round(song.report.confidence * 100)}%</dd></div>
          <div><dt>Tiles</dt><dd>{song.charts.easy.notes.length} / {song.charts.medium.notes.length} / {song.charts.hard.notes.length}</dd></div>
          <div><dt>Cues</dt><dd>{cues.length}</dd></div>
        </dl>
        <p className="dev-note mono">{song.report.sections.map((s) => `${s.label} @${s.beat}`).join(' · ')}</p>
        {confirm ? (
          <div className="dev-confirm">
            <span>Delete this map for good?</span>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => probe.deleteMap().catch((e) => setDeleteError((e as Error).message))}>Delete</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>Keep</button>
          </div>
        ) : (
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirm(true)} disabled={song.builtIn} title={song.builtIn ? 'Built-in test songs stay' : undefined}>
            <Icon name="trash" size={14} /> Delete map
          </button>
        )}
        {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
      </section>
    </aside>
  );
}

/** The next few seconds of notes, falling lane by lane toward the line at the bottom. */
function drawQueue(c: HTMLCanvasElement | null, probe: DevProbe, hues: [number, number]) {
  if (!c) return;
  const g = c.getContext('2d')!;
  const { width: w, height: h } = c;
  g.clearRect(0, 0, w, h);
  const laneW = w / 4;
  const line = h - 12;
  const t = probe.time() ?? -AHEAD;
  const y = (time: number) => line - ((time - t) / AHEAD) * (line - 4);
  for (let l = 0; l < 4; l++) {
    g.fillStyle = l % 2 ? 'rgb(255 255 255 / 0.025)' : 'rgb(255 255 255 / 0.045)';
    g.fillRect(l * laneW, 0, laneW, line);
  }
  // Seconds as faint rules.
  g.fillStyle = 'rgb(255 255 255 / 0.08)';
  for (let s = Math.ceil(t); s < t + AHEAD; s++) g.fillRect(0, Math.round(y(s)), w, 1);
  const game = probe.game();
  if (game) {
    for (const n of game.notes) {
      if (n.end < t - 0.3 && n.time < t - 0.3) continue;
      if (n.time > t + AHEAD) break;
      const hue = laneHue(n.lane, 4, hues);
      const x = n.lane * laneW + 6;
      const top = y(n.hold ? n.end : n.time) - 3;
      const bottom = y(n.time) + 3;
      const done = n.judged && n.judged !== 'miss' && (!n.hold || n.holdResult === 'done');
      const missed = n.judged === 'miss' || n.holdResult === 'broken';
      g.fillStyle = missed ? 'rgb(255 111 133 / 0.5)' : done ? `hsl(${hue} 60% 60% / 0.25)` : `hsl(${hue} 100% 72%)`;
      g.fillRect(x, top, laneW - 12, Math.max(4, bottom - top));
      if (n.holding) { g.fillStyle = '#fff'; g.fillRect(x, line - 2, laneW - 12, 3); }
    }
  }
  g.fillStyle = 'rgb(255 255 255 / 0.85)';
  g.fillRect(0, line, w, 1.5);
  g.fillStyle = 'rgb(255 255 255 / 0.5)';
  g.font = '10px "JetBrains Mono", monospace';
  KEYS.forEach((k, l) => g.fillText(k.label, l * laneW + laneW / 2 - 3, h - 1));
}

/** Recent hits on an early-to-late bar, over the perfect/great/good windows. */
function drawErrors(c: HTMLCanvasElement | null, probe: DevProbe) {
  if (!c) return;
  const g = c.getContext('2d')!;
  const { width: w, height: h } = c;
  g.clearRect(0, 0, w, h);
  const game = probe.game();
  const win = game?.windows ?? { perfect: 0.045, great: 0.09, good: 0.14 };
  const x = (s: number) => w / 2 + (s / win.good) * (w / 2 - 4);
  const zones: [number, string][] = [[win.good, 'rgb(185 164 255 / 0.18)'], [win.great, 'rgb(255 156 207 / 0.22)'], [win.perfect, 'rgb(143 227 255 / 0.28)']];
  for (const [r, col] of zones) { g.fillStyle = col; g.fillRect(x(-r), h / 2 - 4, x(r) - x(-r), 8); }
  g.fillStyle = 'rgb(255 255 255 / 0.6)';
  g.fillRect(w / 2, 4, 1, h - 8);
  const offs = probe.offsets().slice(-30);
  offs.forEach((o, i) => {
    g.fillStyle = `rgb(255 255 255 / ${0.2 + (0.8 * (i + 1)) / offs.length})`;
    g.fillRect(Math.round(x(Math.max(-win.good, Math.min(win.good, o)))), 6, 2, h - 12);
  });
  g.fillStyle = 'rgb(255 255 255 / 0.45)';
  g.font = '9px "JetBrains Mono", monospace';
  g.fillText('early', 2, h - 2);
  g.fillText('late', w - 22, h - 2);
}
