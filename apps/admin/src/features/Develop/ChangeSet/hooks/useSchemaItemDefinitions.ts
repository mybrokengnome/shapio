import type { ReviewSchemaItem } from '@shapio/client';
import { useQuery } from '@tanstack/react-query';
import { useSchemaDraft } from '@/api/changeSets';
import { definitionQueryOptions, definitionRevisionQueryOptions } from '@/api/schema';

/**
 * The definition before (active now; for a shipped set, the revision its draft replaced) and after (the
 * set's draft) a schema item, for naming fields in its diff. Either is null while loading or when it doesn't
 * exist (a new or deleted definition). `shared`: the definition is shared with all sites (the active one's
 * scope, else what the draft of a new one asks for), so shipping it affects every site; false until known.
 */
export const useSchemaItemDefinitions = (changeSetId: string, item: ReviewSchemaItem) => {
  const draft = useSchemaDraft(changeSetId, item.definitionId);
  const active = useQuery({
    ...definitionQueryOptions(item.category, item.definitionId),
    enabled: item.operation !== 'create',
    retry: false,
  });
  const shipped = useQuery({
    ...definitionRevisionQueryOptions(item.category, item.definitionId, item.beforeRevisionId ?? ''),
    enabled: item.beforeRevisionId !== null,
    retry: false,
  });
  const before = item.beforeRevisionId === null ? active.data?.definition : shipped.data?.definition;
  return {
    before: before ?? null,
    after: draft.data?.definition ?? null,
    shared: active.data ? active.data.scope === 'network' : (draft.data?.shared ?? false),
  };
};
