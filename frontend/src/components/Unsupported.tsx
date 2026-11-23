import { useState } from 'react';

/** localStorage: open the game on Safari anyway (for testing fixes there). */
export const SAFARI_ANYWAY_KEY = 'rythm-architect:safari-anyway';

/** Whether this Safari has chosen to open the game anyway. */
export function safariAnyway(): boolean {
  try { return localStorage.getItem(SAFARI_ANYWAY_KEY) === '1'; } catch { return false; }
}

/**
 * Shown instead of the game on Safari's engine (lib/perf.ts isWebKit: Safari on a Mac, and every
 * browser on iPhone and iPad). The user, Nov 22: the stage, the backdrop and the intro draw wrongly
 * there in several ways, on Macs and phones, and can't be checked from here; until they're fixed,
 * a screen that says the game isn't available on Safari. "Open anyway" is kept for testing fixes.
 * Plain HTML and CSS: nothing here draws with WebGL or starts audio.
 */
export function Unsupported() {
  const [copied, setCopied] = useState(false);
  const mobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const copy = async () => {
    try { await navigator.clipboard.writeText(location.href); setCopied(true); } catch { /* no clipboard */ }
  };
  const anyway = () => {
    try { localStorage.setItem(SAFARI_ANYWAY_KEY, '1'); } catch { /* private mode */ }
    location.reload();
  };
  return (
    <main className="unsupported" aria-labelledby="unsupported-title">
      <div className="unsupported-card">
        <p className="eyebrow">Rythm Architect</p>
        <h1 id="unsupported-title">Not available on Safari yet</h1>
        <p>
          The game&apos;s stage and effects don&apos;t draw correctly in Safari{mobile ? ', and on iPhone and iPad every browser uses Safari’s engine' : ''}.
          {' '}Open it in <b>Chrome</b> or <b>Edge</b> on a computer{mobile ? '' : ', or Chrome on an Android phone'}.
        </p>
        <div className="unsupported-actions">
          <button type="button" className="btn btn-primary" onClick={copy}>{copied ? 'Link copied' : 'Copy the link'}</button>
        </div>
        <button type="button" className="unsupported-anyway" onClick={anyway}>Open it anyway (parts may look wrong)</button>
      </div>
    </main>
  );
}
