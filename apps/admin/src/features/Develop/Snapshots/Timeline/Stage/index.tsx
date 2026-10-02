import { Clock } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { useStateAt } from '../hooks/useStateAt';
import type { PlaceWithLocales } from '../hooks/useTimelinePlaces';
import { PlaceSection } from '../PlaceSection';

type StageProps = {
  seq: number;
  /** Every snapshot, oldest first: the stage prefetches the ones beside `seq`. */
  seqs: readonly number[];
  previous: number | undefined;
  places: PlaceWithLocales[];
  createdAt: string | undefined;
};

/** The content system at one snapshot: a section of cards per place that had entries then. */
export const Stage = ({ seq, seqs, previous, places, createdAt }: StageProps) => {
  const { t } = useTranslation();
  const index = seqs.indexOf(seq);
  const before = seqs[index - 1];
  const after = seqs[index + 1];
  const neighbours = useMemo(
    () => [before, after].filter((neighbour): neighbour is number => neighbour !== undefined),
    [before, after],
  );
  const state = useStateAt(seq, previous, neighbours, places);
  if (state.error) {
    return <ErrorState error={state.error} onRetry={() => void state.refetch()} />;
  }
  if (state.isPending && state.states.length === 0) {
    return <LoadingState rows={4} />;
  }
  if (state.states.length === 0) {
    return <EmptyState icon={Clock} title={t('snapshots.timeline.nothingLive', { seq })} />;
  }
  return (
    <div aria-busy={state.isPending || undefined} className="space-y-8">
      {state.states.map((placeState) => (
        <PlaceSection
          key={placeState.place.modelId}
          state={placeState}
          seq={seq}
          snapshotCreatedAt={createdAt}
        />
      ))}
    </div>
  );
};
