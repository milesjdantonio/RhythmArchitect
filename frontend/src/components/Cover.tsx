import { useState } from 'react';
import { RiveAnim } from '../rive/RiveAnim';

/** The cover art's own hue (cover.riv is drawn in ice blue); each song turns it to its own colour. */
const ART_HUE = 195;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * A song's cover: its album art when the backend has it, otherwise a living cover (cover.riv):
 * one of four motifs picked from the song's id, tinted to its colours, faster while it plays.
 */
export function Cover({ id, hues, src, size, playing = false }: { id: string; hues: [number, number]; src?: string; size: number; playing?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return <img className="cover" src={src} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(true)} />;
  }
  return (
    <RiveAnim src="cover" stateMachine="Cover" inputs={{ variant: hash(id) % 4, playing }} className="cover cover-live"
      style={{ width: size, height: size, '--cover-turn': `${Math.round(hues[0] - ART_HUE)}deg` } as React.CSSProperties}
      fallback={<span className="cover-fallback" style={{ background: `linear-gradient(135deg, hsl(${hues[0]} 70% 42%), hsl(${hues[1]} 70% 26%))` }} />} />
  );
}
