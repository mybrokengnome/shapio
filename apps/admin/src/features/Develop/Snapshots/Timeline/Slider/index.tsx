import { useId, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/helpers/cn';
import { tickStep } from '../helpers/cards';

type SliderProps = {
  /** Snapshot numbers, oldest first. */
  seqs: readonly number[];
  value: number;
  onChange: (seq: number) => void;
};

const SHIFT_STEP = 10;

/**
 * The time scrubber: a range over every snapshot in the ledger, with ticks (every k-th when the ledger is
 * long) that jump on click. Arrows step one snapshot, Shift+arrows ten, Home/End go to either end.
 */
export const Slider = ({ seqs, value, onChange }: SliderProps) => {
  const { t } = useTranslation();
  const inputId = useId();
  const index = Math.max(seqs.indexOf(value), 0);
  const last = Math.max(seqs.length - 1, 1);
  const step = tickStep(seqs.length);
  const go = (next: number) => {
    const seq = seqs[Math.min(Math.max(next, 0), seqs.length - 1)];
    if (seq !== undefined && seq !== value) {
      onChange(seq);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!event.shiftKey) {
      return;
    }
    const delta = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      go(index + delta * SHIFT_STEP);
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={inputId} className="text-sm font-semibold">
          {t('snapshots.scrubber.label')}
        </label>
        <span className="text-meta text-muted-foreground tabular-nums">
          {t('snapshots.scrubber.range', { min: seqs[0] ?? value, max: seqs.at(-1) ?? value })}
        </span>
      </div>
      <input
        id={inputId}
        type="range"
        min={0}
        max={seqs.length - 1}
        step={1}
        value={index}
        aria-valuetext={t('snapshots.version', { seq: value })}
        onKeyDown={onKeyDown}
        onChange={(event) => go(Number(event.target.value))}
        className="h-2 w-full cursor-pointer accent-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      />
      {/* Mouse shortcuts only: the slider itself is the keyboard control. */}
      <div aria-hidden="true" className="relative mx-2 h-5">
        {seqs.map((seq, position) =>
          position % step === 0 || position === seqs.length - 1 ? (
            <button
              key={seq}
              type="button"
              tabIndex={-1}
              title={t('snapshots.version', { seq })}
              onClick={() => onChange(seq)}
              style={{ '--tick': `${(position / last) * 100}%` } as CSSProperties}
              className={cn(
                'absolute top-0 left-(--tick) h-3 w-px -translate-x-1/2 cursor-pointer bg-border hover:bg-foreground',
                seq === value && 'h-4 w-0.5 bg-primary',
              )}
            />
          ) : null,
        )}
      </div>
    </div>
  );
};
