import type { ValidationIssue } from '@shapio/schema';
import { useDeferredValue, useMemo } from 'react';
import { useAllDefinitions } from '@/api/schema';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { validateDraft } from '../../helpers/issues';

const NO_ISSUES: readonly ValidationIssue[] = [];

/** The draft's validation problems (the server's own validators, run in the browser while typing). */
export const useDraftIssues = () => {
  const draft = useDefinitionDraftStore((state) => state.draft);
  const base = useDefinitionDraftStore((state) => state.base);
  const { definitions } = useAllDefinitions();
  // Validation runs over the whole schema; let typing stay responsive while it catches up.
  const deferredDraft = useDeferredValue(draft);
  const issues = useMemo(
    () =>
      deferredDraft && base
        ? validateDraft(
            deferredDraft,
            base,
            (definitions ?? []).map(({ definition }) => definition),
          )
        : NO_ISSUES,
    [deferredDraft, base, definitions],
  );
  return { issues };
};
