import { useEffect, useRef, useState, type ReactNode } from 'react';
import { applyVolumes, resyncPlaying } from '../audio/playback';
import { DEFAULTS, setSettings, useSettings, type Settings } from '../lib/settings';
import { DEFAULT_LANE_KEYS, DEFAULT_OVERDRIVE_KEY, keyLabel, rebind, useBinds } from '../lib/keys';
import { Icon } from './Icon';
import { detectGraphics } from '../lib/graphics';
import { BACKDROP_THEMES } from '../background/themes';

/** A slider that fills with light up to its value (the fill is a CSS variable, --p, 0..100%). */
function Slider({ id, label, value, min, max, step, show, hint, onChange, children }: {
  id: string; label: string; value: number; min: number; max: number; step: number;
  show: string; hint?: ReactNode; onChange: (v: number) => void; children?: ReactNode;
}) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div className="set-row set-slider">
      <div className="set-label">
        <label htmlFor={id}>{label}</label>
        <output className="set-value mono" htmlFor={id}>{show}</output>
      </div>
      <div className="set-track">
        {children}
        <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={show}
          style={{ '--p': `${p}%` } as React.CSSProperties} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
      {hint && <p className="set-hint">{hint}</p>}
    </div>
  );
}

/** An on/off setting as a switch. */
function Switch({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="set-row set-switch">
      <span className="set-text"><span>{label}</span><small className="set-hint">{hint}</small></span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
    </label>
  );
}

/**
 * The keys: a button per lane and one for Overdrive. Click one, then press the key it should be
 * (Esc cancels). A key bound elsewhere swaps places, so none is ever bound twice.
 */
function KeyBinds() {
  const binds = useBinds();
  const [listening, setListening] = useState<number | 'overdrive' | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (listening === null) return;
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') { setListening(null); setNote(''); return; }
      const next = rebind(binds, listening, e.code);
      if (!next) { setNote(`${keyLabel(e.code)} is kept for the game (pause, start, dev tools). Pick another key.`); return; }
      setSettings({ laneKeys: next.lanes, overdriveKey: next.overdrive });
      setNote('');
      setListening(null);
    };
    // Capture: the dialog's own Esc (closing it) waits while a key is being set.
    addEventListener('keydown', down, true);
    return () => removeEventListener('keydown', down, true);
  }, [listening, binds]);
  const slot = (key: number | 'overdrive', code: string, name: string) => (
    <button key={String(key)} type="button" className={`btn btn-sm keybind ${listening === key ? 'is-listening' : ''}`}
      aria-label={`${name}: ${keyLabel(code) || 'none'}. Change`} onClick={() => setListening(listening === key ? null : key)}>
      <span className="keybind-name">{name}</span>
      <kbd>{listening === key ? 'Press a key' : keyLabel(code) || '—'}</kbd>
    </button>
  );
  const isDefault = binds.lanes.join() === DEFAULT_LANE_KEYS.join() && binds.overdrive === DEFAULT_OVERDRIVE_KEY;
  return (
    <div className="set-keys">
      <div className="keybind-row" role="group" aria-label="Lane keys">
        {binds.lanes.map((code, l) => slot(l, code, `Lane ${l + 1}`))}
      </div>
      <div className="keybind-row" role="group" aria-label="Overdrive key">
        {slot('overdrive', binds.overdrive, 'Overdrive')}
        {!isDefault && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSettings({ laneKeys: DEFAULT_LANE_KEYS, overdriveKey: DEFAULT_OVERDRIVE_KEY })}>Default keys</button>
        )}
      </div>
      <p className="muted" aria-live="polite">{note || (listening !== null ? 'Press the new key, or Esc to cancel.' : 'Click a key to change it. Arrow keys and 1–4 play the lanes too. On touch screens, tap the lanes.')}</p>
      <p><span className="muted">Pause</span> <kbd>Esc</kbd> <span className="muted">Dev tools in a game</span> <kbd>`</kbd></p>
    </div>
  );
}

/** Settings → Graphics (lib/graphics.ts). */
const GRAPHICS: { id: Settings['graphics']; name: string; hint: string }[] = [
  { id: 'auto', name: 'Auto', hint: '' },
  { id: 'full', name: 'Full', hint: 'Every effect, at full resolution.' },
  { id: 'light', name: 'Light', hint: 'The 3D stage with fewer effects and a lower resolution, for older or built-in graphics.' },
  { id: 'simple', name: 'Simple', hint: 'A flat 2D stage and a still background, for computers that struggle with 3D.' },
];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="set-group" aria-label={title}>
      <h3 className="eyebrow">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Settings: sound, timing, play, visuals and the keys, in framed groups. Changes apply as they
 * happen (and are kept in this browser). Note speed is not here: each difficulty and song sets its
 * own (game/engine.ts, fallTime).
 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const s = useSettings();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const change = (patch: Partial<Settings>) => { setSettings(patch); applyVolumes(); };
  // Resync: the Map Syncer measures every song again and lines up whatever is playing.
  const [resynced, setResynced] = useState(false);
  useEffect(() => { if (!resynced) return; const t = setTimeout(() => setResynced(false), 2000); return () => clearTimeout(t); }, [resynced]);
  const resync = () => { resyncPlaying(); setResynced(true); };
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const auto = detectGraphics();
  const autoHint = `Picks for this computer: ${GRAPHICS.find((g) => g.id === auto.level)!.name}${auto.why ? ` (${auto.why})` : ''}.`;

  return (
    <dialog ref={ref} className="dialog settings" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-labelledby="settings-title">
      <div className="dialog-head">
        <div>
          <h2 id="settings-title">Settings</h2>
          <p className="muted settings-sub">Saved in this browser as you change them.</p>
        </div>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close settings"><Icon name="close" /></button>
      </div>

      <div className="settings-body">
        <Group title="Sound">
          <Slider id="set-volume" label="Volume" value={s.volume} min={0} max={1} step={0.01} show={pct(s.volume)} onChange={(v) => change({ volume: v })} />
          <Slider id="set-backing" label="Backing groove" value={s.backing} min={0} max={1} step={0.01} show={pct(s.backing)}
            hint="The drums and bass under songs whose notes the game plays itself." onChange={(v) => change({ backing: v })} />
          <Switch label="Menu music" hint="A calm piece while no song is playing." checked={s.menuMusic} onChange={(v) => change({ menuMusic: v })} />
          <Switch label="Play previews by themselves" hint="The song on stage plays with its ghost run." checked={s.autoPreview} onChange={(v) => change({ autoPreview: v })} />
        </Group>

        <Group title="Timing">
          <div className="set-row set-fixed">
            <span className="set-text"><span>Sync</span><small className="set-hint">Tiles stay on the music by themselves. If a song still feels out of step, resync to check it again.</small></span>
            <button type="button" className="btn btn-sm set-resync" onClick={resync} aria-live="polite">{resynced ? 'Resynced' : 'Resync'}</button>
          </div>
          <div className="set-row set-fixed">
            <span className="set-text"><span>Note speed</span><small className="set-hint">Set by the map: tiles fall faster on harder difficulties and on faster songs. The start card shows it.</small></span>
            <span className="set-value">By map</span>
          </div>
        </Group>

        <Group title="Play">
          <Switch label="No fail" hint="Keep playing when the signal runs out." checked={s.noFail} onChange={(v) => change({ noFail: v })} />
          <Switch label="Calm visuals" hint="A still background and fewer effects. Also on when your system asks for less motion." checked={s.calm} onChange={(v) => change({ calm: v })} />
        </Group>

        <Group title="Graphics">
          <div className="set-row set-graphics" role="radiogroup" aria-label="Graphics">
            {GRAPHICS.map((g) => (
              <label key={g.id} className={`set-choice ${s.graphics === g.id ? 'is-on' : ''}`}>
                <input type="radio" name="graphics" value={g.id} checked={s.graphics === g.id} onChange={() => change({ graphics: g.id })} />
                <span className="set-choice-name">{g.name}</span>
                <small className="set-hint">{g.id === 'auto' ? autoHint : g.hint}</small>
              </label>
            ))}
          </div>
          <p className="set-hint set-note">Applies from the next song you start.</p>
        </Group>

        <Group title="Minimum requirements">
          <ul className="set-reqs">
            <li><span>Browser</span>Chrome or Edge on a computer. Firefox plays songs, but mapping a new one needs Chrome or Edge (they can share a tab's sound). Safari, and every browser on iPhone and iPad, isn't supported yet.</li>
            <li><span>Graphics</span>WebGL 2 with a graphics chip. On an older or built-in chip, use Light or Simple above. Splitting a song into its parts while mapping needs WebGPU (recent Chrome or Edge).</li>
            <li><span>Computer</span>A 4-core processor and 4 GB of memory to play; 8 GB to map new songs (the mapper downloads about 300 MB of models the first time).</li>
            <li><span>Screen</span>1280 × 720 or larger, or a phone or tablet held sideways for touch.</li>
            <li><span>Internet</span>About 5 Mbps for the song's YouTube video.</li>
            <li><span>Controls</span>A keyboard (four lane keys and Overdrive, set under Controls) or a touch screen.</li>
          </ul>
        </Group>

        <Group title="Background">
          <div className="set-row set-backdrop" role="radiogroup" aria-label="Background colours">
            {BACKDROP_THEMES.map((t) => (
              <label key={t.id} className={`backdrop-swatch ${s.backdrop === t.id ? 'is-on' : ''}`} title={t.name}>
                <input type="radio" name="backdrop" value={t.id} checked={s.backdrop === t.id} onChange={() => change({ backdrop: t.id })} />
                <span className={`backdrop-chip ${t.hues ? '' : 'is-dynamic'}`} aria-hidden
                  style={t.hues ? ({ '--a': t.hues[0], '--b': t.hues[1] } as React.CSSProperties) : undefined} />
                <span className="backdrop-name">{t.name}</span>
              </label>
            ))}
          </div>
        </Group>

        <Group title="Controls">
          <KeyBinds />
        </Group>
      </div>

      <div className="dialog-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => change({ ...DEFAULTS, devTools: s.devTools })}>Reset to defaults</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
      </div>
    </dialog>
  );
}
