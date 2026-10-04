import type { DefinitionScope } from '@shapio/client';
import { useSchemaScopeAccess } from '@/hooks/useSchemaScopeAccess';

/**
 * A definition shared with all sites is read-only for an admin without `schema.create` on every site (the
 * server refuses the change with 403 either way).
 */
export const useSharedReadOnly = (scope: DefinitionScope) => {
  const { canShare } = useSchemaScopeAccess();
  return scope === 'network' && !canShare;
};
