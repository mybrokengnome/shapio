import { useTranslation } from 'react-i18next';
import { Card } from '../Card';
import { useOpenVersion } from '../hooks/useOpenVersion';
import type { PlaceState } from '../hooks/useStateAt';

type PlaceSectionProps = { state: PlaceState; seq: number; snapshotCreatedAt: string | undefined };

/** One place at the snapshot: its entries as a grid of cards (2-up on phones). */
export const PlaceSection = ({ state, seq, snapshotCreatedAt }: PlaceSectionProps) => {
  const { t } = useTranslation();
  const openVersion = useOpenVersion(state.place.modelKey, snapshotCreatedAt);
  const live = state.cards.filter((card) => card.mark !== 'removed').length;
  return (
    <section aria-label={state.place.label} className="space-y-3">
      <h3 className="flex items-baseline gap-2 text-base font-semibold">
        {state.place.label}
        <span className="text-meta font-normal text-muted-foreground">
          {t('snapshots.timeline.liveCount', { count: live })}
        </span>
      </h3>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {state.cards.map((card) => (
          // Marked cards are re-keyed per snapshot so their animation plays again.
          <Card
            key={card.mark === 'unchanged' ? card.id : `${card.id}:${seq}`}
            card={card}
            onOpen={(opened) => void openVersion(opened)}
          />
        ))}
      </ul>
    </section>
  );
};
