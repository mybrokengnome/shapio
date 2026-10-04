import type { DefinitionCategory, DefinitionScope } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { hasErrorCode } from '@/api/errors';
import { useChangeScope } from '@/api/schema';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { useReloadDraft } from './useReloadDraft';

/**
 * Shares the definition with all sites, or keeps it on this site, against the version the draft is based
 * on. On success the draft (clean: the action is off while it has edits) starts over from the new version,
 * so the builder doesn't report its own change as a remote one. A version conflict goes to `onConflict`
 * (the builder's reload banner) and closes the confirmation; other failures reject for the confirmation to
 * show (`SCOPE_IN_USE` with the server's message and entry count).
 */
export const useScopeChange = (category: DefinitionCategory, id: string, onConflict: () => void) => {
  const { t } = useTranslation();
  const changeScope = useChangeScope();
  const reloadDraft = useReloadDraft(category, id);
  return async (scope: DefinitionScope) => {
    const version = useDefinitionDraftStore.getState().baseVersion;
    try {
      await changeScope.mutateAsync({ category, id, input: { scope, version } });
    } catch (error) {
      if (hasErrorCode(error, 'SCHEMA_VERSION_CONFLICT')) {
        onConflict();
        return;
      }
      throw error;
    }
    await reloadDraft('replace');
    toast.success(t(scope === 'network' ? 'models.scope.shared' : 'models.scope.kept'));
  };
};
