import type { ChangeSetReview } from '@shapio/client';
import { Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useRemoveChangeSetItem } from '@/api/changeSets';
import { EmptyState } from '@/components/EmptyState';
import { EntryDiffCard } from '../EntryDiffCard';
import { SchemaDiffCard } from '../SchemaDiffCard';

type ChangesTabProps = { review: ChangeSetReview; editable: boolean };

/** Every item as a diff card: schema first (it decides what the entries may hold), then entries. */
export const ChangesTab = ({ review, editable }: ChangesTabProps) => {
  const { t } = useTranslation();
  const removeItem = useRemoveChangeSetItem();
  const setId = review.changeSet.id;
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
      {review.schema.map((item) => (
        <SchemaDiffCard key={item.itemId} changeSetId={setId} item={item} />
      ))}
      {review.entries.map((item) => (
        <EntryDiffCard
          key={item.itemId}
          item={item}
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
