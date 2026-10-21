import { foldApiKey, isModelDefinition, type SchemaDefinition } from '@shapio/schema';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSaveContractFixToChangeSet } from '@/api/changeSets';
import { useDefinitions } from '@/api/schema';
import { settle } from '@/helpers/settle';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { copyContractField, type MissingContractIssue } from '../../helpers/interfaces';

/** A member that lacks contract fields: fixable here (in this site's view), or on its own site first. */
export type LackingMember =
  | { kind: 'here'; id: string; label: string; fieldApiKeys: string[] }
  | { kind: 'elsewhere'; siteKey?: string; fieldApiKeys: string[] };

/**
 * The members an interface's draft leaves without a contract field (plan interfaces decision 4) and the fix:
 * one change set with each member here getting a copy of the missing fields (fresh IDs) and the interface's
 * draft, which then opens. A member on another site is listed, never offered (decision 14: a change set
 * belongs to one site).
 */
export const useContractFix = (issues: readonly MissingContractIssue[]) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: models } = useDefinitions('model');
  const save = useSaveContractFixToChangeSet();
  const members = useMemo<LackingMember[]>(() => {
    const byMember = new Map<string, LackingMember>();
    for (const found of issues) {
      const item = models?.find(({ definition }) => definition.id === found.definitionId);
      const key = item ? item.definition.id : `elsewhere:${found.siteKey ?? ''}:${found.definitionId ?? ''}`;
      const entry =
        byMember.get(key) ??
        (item
          ? { kind: 'here' as const, id: item.definition.id, label: item.definition.label, fieldApiKeys: [] }
          : { kind: 'elsewhere' as const, siteKey: found.siteKey, fieldApiKeys: [] });
      if (!entry.fieldApiKeys.includes(found.fieldApiKey)) {
        entry.fieldApiKeys.push(found.fieldApiKey);
      }
      byMember.set(key, entry);
    }
    return [...byMember.values()];
  }, [issues, models]);
  const fixable = members.filter((member) => member.kind === 'here');

  const addToMembers = async () => {
    const { draft, baseVersion } = useDefinitionDraftStore.getState();
    if (!draft || !models) {
      return;
    }
    const proposals = fixable.flatMap((member) => {
      const item = models.find(({ definition }) => definition.id === member.id);
      if (!item) {
        return [];
      }
      const { definition } = item;
      const localized = isModelDefinition(definition) && definition.localized;
      const taken = new Set(definition.fields.map((field) => foldApiKey(field.apiKey)));
      const added = draft.fields
        .filter((field) => member.fieldApiKeys.includes(field.apiKey) && !taken.has(foldApiKey(field.apiKey)))
        .map((field) => copyContractField(field, localized));
      const proposed: SchemaDefinition = { ...definition, fields: [...definition.fields, ...added] };
      return [{ definition: proposed, baseVersion: item.version }];
    });
    const saved = await settle(
      save.mutateAsync({
        title: t('interfaces.fix.setTitle', { name: draft.label }),
        contract: { definition: draft, baseVersion },
        members: proposals,
      }),
    );
    if (saved.ok) {
      await navigate({
        to: '/changes/$changeSetId',
        params: { changeSetId: saved.value },
        ignoreBlocker: true,
      });
    }
  };

  return {
    members,
    fixableCount: fixable.length,
    /** The missing fields' API IDs, each once. */
    fieldApiKeys: [...new Set(issues.map((found) => found.fieldApiKey))],
    addToMembers,
    saving: save.isPending,
    error: save.error,
  };
};
