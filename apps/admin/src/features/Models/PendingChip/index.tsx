import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/api/queryKeys';
import { useSchemaChange } from '@/api/schema';
import { StatusChip } from '@/components/StatusChip';
import { FINAL_CHANGE_STATUSES } from '@/constants/schema';

type PendingChipProps = { changeId: string };

/** "Change in progress" while a planned change runs; refreshes the schema and disappears when it ends. */
export const PendingChip = ({ changeId }: PendingChipProps) => {
  const { t } = useTranslation();
  const change = useSchemaChange(changeId);
  const queryClient = useQueryClient();
  const status = change.data?.status;
  const finished = status !== undefined && FINAL_CHANGE_STATUSES.has(status);
  useEffect(() => {
    if (finished) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.schema.all });
    }
  }, [finished, queryClient]);
  if (finished || change.isError) {
    return null;
  }
  return <StatusChip tone="progress" size="sm" label={t('models.pendingChange')} />;
};
