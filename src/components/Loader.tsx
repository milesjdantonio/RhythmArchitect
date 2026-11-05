import { motion } from 'motion/react';

/**
 * The loading screen: four lanes, tiles of light running down them onto the hit line in a little
 * run (D F J K), the song's name, and what's happening. Pure CSS (transforms and opacity), so it
 * costs nothing while the real work loads. `hues` tints it to the song.
 */
export function Loader({ title, artist, status, hues, className = '' }: {
  title?: string; artist?: string; status: string; hues?: [number, number]; className?: string;
}) {
  return (
    <motion.div className={`loader ${className}`} role="status" aria-live="polite"
      style={hues ? ({ '--hA': hues[0], '--hB': hues[1] } as React.CSSProperties) : undefined}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}>
      <div className="loader-lanes" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="loader-lane" style={{ '--i': i } as React.CSSProperties}><i /></span>
        ))}
        <b className="loader-hit" />
      </div>
      {title && <p className="loader-title">{title}{artist && <span>{artist}</span>}</p>}
      <p className="label loader-status">{status}</p>
      <span className="loader-bar" aria-hidden />
    </motion.div>
  );
}
