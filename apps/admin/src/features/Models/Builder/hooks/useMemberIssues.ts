import { parseDefinition, validateSchema, type ValidationIssue } from '@shapio/schema';
import { useDeferredValue, useMemo } from 'react';
import { useAllDefinitions } from '@/api/schema';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';

const NONE: ReadonlyMap<string, ValidationIssue> = new Map();

/**
 * For an interface's draft: each member's first problem with the draft's contract, by the member that
 * reports it (the type that declares `implements`), from the same validators the server runs over this
 * site's view. Empty for anything but an interface, and while the schema loads.
 */
export const useMemberIssues = (): { memberIssues: ReadonlyMap<string, ValidationIssue> } => {
  const draft = useDeferredValue(useDefinitionDraftStore((state) => state.draft));
  const base = useDefinitionDraftStore((state) => state.base);
  const { definitions } = useAllDefinitions();
  const memberIssues = useMemo(() => {
    if (!draft || draft.kind !== 'interface' || !definitions) {
      return NONE;
    }
    const parsed = parseDefinition(draft, base ? { previous: base } : {});
    if (!parsed.ok) {
      return NONE;
    }
    const schema = [
      ...definitions.map(({ definition }) => definition).filter((definition) => definition.id !== draft.id),
      parsed.definition,
    ];
    const byMember = new Map<string, ValidationIssue>();
    for (const found of validateSchema(schema)) {
      if (found.interfaceId === draft.id && found.definitionId && !byMember.has(found.definitionId)) {
        byMember.set(found.definitionId, found);
      }
    }
    return byMember;
  }, [draft, base, definitions]);
  return { memberIssues };
};
