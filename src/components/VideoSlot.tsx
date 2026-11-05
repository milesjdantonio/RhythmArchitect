import { useEffect, useRef, type ReactNode } from 'react';
import { dockInto } from '../audio/youtube';
import { bus } from '../lib/bus';

/**
 * Where the YouTube player sits on this screen. The player itself is one element above the whole
 * app (src/audio/youtube.ts) that follows the newest slot on screen, so it never reloads between
 * screens and nothing of ours is ever drawn over it. 16:9, at least 356×200 (YouTube asks for 200+).
 *
 * The slot (frame and all) only shows while the song is playing; `idle="show"` also shows the
 * cued video before that (the Generate dialog, so the player sees which video was found). A slot
 * with `rest` is a dedicated spot: it stays, showing `rest` until the video plays over it. The
 * player can't be clicked or focused: the game drives it.
 *
 * Around it (never on it): a hairline frame with corner ticks like the stage's, a glow that
 * answers the beat, and, if there's a `label`, a caption underneath.
 */
export function VideoSlot({ className = '', label, idle = 'hide', rest }: { className?: string; label?: string; idle?: 'show' | 'hide'; rest?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  useEffect(() => (ref.current ? dockInto(ref.current) : undefined), []);
  useEffect(() => bus.on('beat', ({ downbeat }) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    glow.current?.animate([{ opacity: downbeat ? 1 : 0.6 }, { opacity: 0 }], { duration: downbeat ? 520 : 360, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }), []);
  return (
    <figure className={`video-slot ${rest ? 'has-rest' : ''} ${className}`} aria-hidden={!label && !rest}>
      <div className="video-slot-box">
        <span ref={glow} className="video-slot-glow" aria-hidden />
        <div ref={ref} className="video-slot-frame" data-idle={idle}>
          {rest && <div className="video-slot-rest">{rest}</div>}
        </div>
        <span className="video-slot-ticks" aria-hidden />
      </div>
      {label && (
        <figcaption className="video-slot-cap">
          <span className="yt-mark" aria-hidden />
          <span className="video-slot-label">{label}</span>
        </figcaption>
      )}
    </figure>
  );
}
