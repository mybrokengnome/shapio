import type { ChangeSetReview } from '@shapio/client';
import { Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useRemoveChangeSetItem } from '@/api/changeSets';
import { EmptyState } from '@/components/EmptyState';
import { EntryDiffCard } from '../EntryDiffCard';
import { SchemaDiffCard } from '../SchemaDiffCard';

type ChangesTabProps = { review: ChangeSetReview; editable: boolean };

/** A shipped schema item's outcome, from the set's items (the review has none). */
const outcomeOf = (review: ChangeSetReview, itemId: string) => {
  const item = review.changeSet.items.find((candidate) => candidate.id === itemId);
  return item?.kind === 'schema' ? item.outcome : null;
};

/**
 * Every item as a diff card: schema first (it decides what the entries may hold), then entries. A shipped
 * set shows what it shipped; one shipped as a release before change sets kept their diff shows none.
 */
export const ChangesTab = ({ review, editable }: ChangesTabProps) => {
  const { t } = useTranslation();
  const removeItem = useRemoveChangeSetItem();
  const setId = review.changeSet.id;
  const shipped = review.changeSet.status === 'shipped';
  const diff = !shipped ? 'live' : review.changeSet.shippedSnapshot === null ? 'none' : 'shipped';
  if (review.schema.length === 0 && review.entries.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title={t('changes.review.noItems')}
        description={t('changes.review.noItemsDescription')}
      />
    );
  }
  return (
    <div className="space-y-4">
      {diff === 'none' ? (
        <p className="text-meta text-muted-foreground">{t('changes.review.notRecorded')}</p>
      ) : null}
      {review.schema.map((item) => (
        <SchemaDiffCard
          key={item.itemId}
          changeSetId={setId}
          item={item}
          outcome={outcomeOf(review, item.itemId)}
        />
      ))}
      {review.entries.map((item) => (
        <EntryDiffCard
          key={item.itemId}
          item={item}
          diff={diff}
          onRemove={
            editable
              ? () =>
                  removeItem.mutateAsync(
                    { id: setId, itemId: item.itemId },
                    { onSuccess: () => toast.success(t('changes.review.itemRemoved')) },
                  )
              : undefined
          }
        />
      ))}
    </div>
  );
};
