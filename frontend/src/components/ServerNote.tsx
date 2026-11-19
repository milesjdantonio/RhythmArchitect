import { useEffect, useState } from 'react';
import { useServer } from '../lib/server';
import { fmtTime } from '../lib/format';
import { Icon } from './Icon';

/**
 * Where something is waiting on the song server while it wakes (a free server sleeps when nobody
 * has played for a while): a small line saying so, with how long it's been, in place of results
 * that haven't come. Nothing when the server is up. `when`: only while this place is waiting (a
 * search running, a list loading).
 */
export function ServerNote({ when = true, className = '' }: { when?: boolean; className?: string }) {
  const { state, since, retry } = useServer();
  const waking = state === 'waking' || state === 'down';
  const [, tick] = useState(0);
  useEffect(() => {
    if (!waking || !when) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [waking, when]);
  if (!waking || !when) return null;
  const secs = Math.max(0, Math.round((performance.now() - since) / 1000));
  return (
    <div className={`server-note ${state === 'down' ? 'is-down' : ''} ${className}`} role="status" aria-live="polite">
      {state === 'down' ? (
        <>
          <span>The song server isn't answering. It may be down for now.</span>
          <button type="button" className="btn btn-sm" onClick={retry}><Icon name="retry" size={15} /> Try again</button>
        </>
      ) : (
        <>
          <span className="server-note-pulse" aria-hidden />
          <span>Waking the song server <span className="mono muted">{fmtTime(secs)}</span></span>
          <span className="server-note-why muted">It sleeps when nobody has played for a while; about a minute.</span>
        </>
      )}
    </div>
  );
}
