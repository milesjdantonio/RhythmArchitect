import { useEffect, useRef, useState, type ReactNode } from 'react';
import { applyVolumes, resyncPlaying } from '../audio/playback';
import { DEFAULTS, setSettings, useSettings, type Settings } from '../lib/settings';
import { KEYS, NOTE_SPEED } from '../game/engine';
import { Icon } from './Icon';

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
 * happen (and are kept in this browser). Note speed is not here: it's fixed (game/engine.ts,
 * NOTE_SPEED), the same for every song.
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
          <Slider id="set-volume" label="Volume" value={s.volume} min={0} max={1} step={0.05} show={pct(s.volume)} onChange={(v) => change({ volume: v })} />
          <Slider id="set-backing" label="Backing groove" value={s.backing} min={0} max={1} step={0.05} show={pct(s.backing)}
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
            <span className="set-text"><span>Note speed</span><small className="set-hint">The same on every song, so reading never changes. Tempo shows in how close the tiles are.</small></span>
            <span className="set-value mono">{NOTE_SPEED.toFixed(2)}×</span>
          </div>
        </Group>

        <Group title="Play">
          <Switch label="No fail" hint="Keep playing when the signal runs out." checked={s.noFail} onChange={(v) => change({ noFail: v })} />
          <Switch label="Calm visuals" hint="A still background and fewer effects. Also on when your system asks for less motion." checked={s.calm} onChange={(v) => change({ calm: v })} />
        </Group>

        <Group title="Controls">
          <div className="set-keys">
            <p><span className="muted">Lanes</span> <span className="set-caps">{KEYS.map((k) => <kbd key={k.code}>{k.label}</kbd>)}</span></p>
            <p className="muted">Arrow keys and 1–4 work too. On touch screens, tap the lanes.</p>
            <p><span className="muted">Pause</span> <kbd>Esc</kbd> <span className="muted">Dev tools in a game</span> <kbd>`</kbd></p>
          </div>
        </Group>
      </div>

      <div className="dialog-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => change({ ...DEFAULTS, devTools: s.devTools })}>Reset to defaults</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
      </div>
    </dialog>
  );
}
