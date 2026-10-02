import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSnapshotChanges, useSnapshotLedger } from '@/api/snapshots';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Panel } from '@/components/Panel';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { PinPopover } from '../PinPopover';
import { RestoreButton } from '../RestoreButton';
import { Header } from './Header';
import { useTimelinePlaces } from './hooks/useTimelinePlaces';
import { Slider } from './Slider';
import { Stage } from './Stage';

/** While dragging, reads wait this long after the thumb stops (the thumb and header move at once). */
const DRAG_DEBOUNCE_MS = 150;

type TimelineProps = {
  /** The snapshot to start at (`?at=`). */
  at: number;
  /** Remembers the position in the URL, so it can be shared. */
  onAtChange: (seq: number) => void;
};

/**
 * The time scrubber: drag across every snapshot and see the content as it was then. The thumb and the
 * header follow at once; the cards follow once dragging pauses, marked against the snapshot before
 * (new, changed, removed). Restore to here and Pin a token here act on the position.
 */
export const Timeline = ({ at, onAtChange }: TimelineProps) => {
  const { t } = useTranslation();
  const ledger = useSnapshotLedger();
  const { places, error: placesError } = useTimelinePlaces();
  const [position, setPosition] = useState(at);
  const settled = useDebouncedValue(position, DRAG_DEBOUNCE_MS);
  const seqs = useMemo(
    () => (ledger.data ? ledger.data.items.map((row) => row.seq).sort((a, b) => a - b) : []),
    [ledger.data],
  );
  useEffect(() => {
    if (settled !== at) {
      onAtChange(settled);
    }
  }, [settled, at, onAtChange]);

  // Before the oldest snapshot in the ledger, compare with the number just before it (0: nothing live).
  const previousOf = (seq: number) => seqs[seqs.indexOf(seq) - 1] ?? (seq > 0 ? seq - 1 : undefined);
  const settledPrevious = previousOf(settled);
  // The same diff the stage marks its cards with (one request, cached per pair).
  const settledChanges = useSnapshotChanges(settledPrevious ?? 0, settled, settledPrevious !== undefined);

  if (ledger.isError || placesError) {
    return <ErrorState error={ledger.error ?? placesError} onRetry={() => void ledger.refetch()} />;
  }
  if (!ledger.data || !places) {
    return <LoadingState rows={4} />;
  }
  const row = ledger.data.items.find((item) => item.seq === position);
  const settledRow = ledger.data.items.find((item) => item.seq === settled);
  const current = ledger.data.current;
  return (
    <div className="space-y-6">
      <Panel aria-label={t('snapshots.timeline.label')}>
        <div className="space-y-4">
          <Header
            seq={position}
            row={row}
            previous={previousOf(position)}
            changedCount={position === settled ? settledChanges.data?.items.length : undefined}
          />
          <Slider seqs={seqs} value={position} onChange={setPosition} />
          <div className="flex flex-wrap gap-2">
            {position === current ? null : (
              <RestoreButton seq={position} size="default" label={t('snapshots.timeline.restoreHere')} />
            )}
            <PinPopover seq={position} variant="outline" label={t('snapshots.timeline.pinHere')} />
          </div>
        </div>
      </Panel>
      <Stage
        seq={settled}
        seqs={seqs}
        previous={settledPrevious}
        places={places}
        createdAt={settledRow?.createdAt}
      />
    </div>
  );
};
