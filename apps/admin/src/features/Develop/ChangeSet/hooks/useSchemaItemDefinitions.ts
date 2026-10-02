import type { ReviewSchemaItem } from '@shapio/client';
import { useQuery } from '@tanstack/react-query';
import { useSchemaDraft } from '@/api/changeSets';
import { definitionQueryOptions } from '@/api/schema';

/**
 * The definition before (active now) and after (the set's draft) a schema item, for naming fields in its
 * diff. Either is null while loading or when it doesn't exist (a new or deleted definition).
 */
export const useSchemaItemDefinitions = (changeSetId: string, item: ReviewSchemaItem) => {
  const draft = useSchemaDraft(changeSetId, item.definitionId);
  const active = useQuery({
    ...definitionQueryOptions(item.category, item.definitionId),
    enabled: item.operation !== 'create',
    retry: false,
  });
  return {
    before: active.data?.definition ?? null,
    after: draft.data?.definition ?? null,
  };
};
