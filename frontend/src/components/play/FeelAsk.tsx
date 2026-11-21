import { useState } from 'react';
import { api } from '../../api/client';
import type { Difficulty, FeelWhy } from '../../api/types';
import { FEEL_LABEL, FEEL_WHY } from '../../game/feel';
import { upsert } from '../../library/songs';

/**
 * "How did that feel?" under a kept run's results: one tap, Felt right or Felt off; off asks why
 * (any of FEEL_WHY) and sends on Send. Counts only (game/feel.ts, the server's RunFeel), once a
 * run, to tune the mapper from real play beside where players miss.
 */
export function FeelAsk({ songId, difficulty, run }: { songId: string; difficulty: Difficulty; run: string }) {
  const [step, setStep] = useState<'ask' | 'why' | 'sending' | 'done' | 'error'>('ask');
  const [why, setWhy] = useState<FeelWhy[]>([]);

  const send = async (feel: 'right' | 'off', reasons: FeelWhy[] = []) => {
    setStep('sending');
    try {
      upsert(await api.sendFeel(songId, { difficulty, play: run, feel, ...(feel === 'off' ? { why: reasons } : {}) }));
      setStep('done');
    } catch {
      setStep('error');
    }
  };
  const toggle = (w: FeelWhy) => setWhy((list) => (list.includes(w) ? list.filter((x) => x !== w) : [...list, w]));

  if (step === 'done') return <p className="feel-ask muted small" aria-live="polite">Thanks: that goes into how the maps are made.</p>;
  if (step === 'error') return <p className="feel-ask muted small" aria-live="polite">Couldn't send that.</p>;
  return (
    <div className="feel-ask" role="group" aria-label="How did that map feel?">
      {step === 'why' ? (
        <>
          <p className="small">What felt off?</p>
          <div className="feel-row">
            {FEEL_WHY.map((w) => (
              <button key={w} type="button" className={`btn btn-sm feel-why${why.includes(w) ? ' is-on' : ''}`} aria-pressed={why.includes(w)} onClick={() => toggle(w)}>{FEEL_LABEL[w]}</button>
            ))}
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void send('off', why)}>Send</button>
          </div>
        </>
      ) : (
        <>
          <p className="small">How did that map feel?</p>
          <div className="feel-row">
            <button type="button" className="btn btn-sm" disabled={step === 'sending'} onClick={() => void send('right')}>Felt right</button>
            <button type="button" className="btn btn-sm" disabled={step === 'sending'} onClick={() => setStep('why')}>Felt off</button>
          </div>
        </>
      )}
    </div>
  );
}
