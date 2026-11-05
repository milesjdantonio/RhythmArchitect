import { useState } from 'react';
import { DIFFICULTIES, type BestScore, type Difficulty } from '../../api/types';
import { RiveAnim } from '../../rive/RiveAnim';

const LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const BLURB: Record<Difficulty, string> = { easy: 'Single taps · slower', medium: 'Holds · steady', hard: 'Chords · fast' };
const BARS: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };

interface Props {
  value: Difficulty;
  onChange: (d: Difficulty) => void;
  /** Optional per-difficulty detail: tile counts and best scores. */
  counts?: Record<Difficulty, number>;
  best?: Partial<Record<Difficulty, BestScore>>;
  compact?: boolean;
}

/** Radio group of three Rive badges (fallback: CSS signal bars). Arrow keys move the choice. */
export function DifficultyPicker({ value, onChange, counts, best, compact }: Props) {
  const [hover, setHover] = useState<Difficulty | null>(null);
  const onKey = (e: React.KeyboardEvent) => {
    const i = DIFFICULTIES.indexOf(value);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onChange(DIFFICULTIES[(i + 1) % 3]); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onChange(DIFFICULTIES[(i + 2) % 3]); }
  };
  return (
    <div className={`diff-picker ${compact ? 'is-compact' : ''}`} role="radiogroup" aria-label="Difficulty" onKeyDown={onKey}>
      {DIFFICULTIES.map((d) => {
        const selected = d === value;
        return (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={`diff-option diff-${d} ${selected ? 'is-selected' : ''}`}
            onClick={() => onChange(d)}
            onPointerEnter={() => setHover(d)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(d)}
            onBlur={() => setHover(null)}
          >
            <RiveAnim
              src="difficulty"
              artboard={LABEL[d]}
              stateMachine="Difficulty"
              inputs={{ selected, hover: hover === d }}
              className="diff-badge"
              fallback={<span className="diff-bars" data-lit={BARS[d]}><i /><i /><i /></span>}
            />
            <span className="diff-text">
              <span className="diff-name">{LABEL[d]}</span>
              <span className="diff-blurb">{counts ? `${counts[d]} Notes` : BLURB[d]}</span>
              {best?.[d] && <span className="diff-best mono">Best {best[d]!.grade} · {best[d]!.score.toLocaleString()}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
