import type { ContentTargetMember } from '@shapio/client';
import type { ResolvedModelDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useMe } from '@/api/auth';
import { canOnModel } from '@/helpers/modelPermissions';
import { familyKindsOf, useResolvedDefinitions } from '@/hooks/useResolvedDefinitions';
import type { RelationTargetInfo } from '../../helpers/relationTargetLabel';

export type RelationTypes = {
  /**
   * The types a new entry can be created as, in the order offered: a model target and its kinds in tree order;
   * for an interface its member collections, for any entry every collection, that the person may create.
   */
  creatable: readonly ResolvedModelDefinition[];
  /**
   * The label of an entry's own type (`item.model`), when it is worth naming: a kind of a model target with
   * kinds, or any type of an interface or any-entry target.
   */
  typeLabelOf: (modelKey: string | undefined) => string | undefined;
  /** Whether a model's entries can be linked (the target's family or members): an entry never links itself. */
  covers: (modelId: string) => boolean;
};

const byLabel = (a: ResolvedModelDefinition, b: ResolvedModelDefinition) => a.label.localeCompare(b.label);

/**
 * The types a relation can link (plans polymorphic-types D13 and interfaces D11): a model target accepts its
 * kinds' entries; an interface its members' (kinds of members included); any entry every type's. Member
 * labels come from the content-targets response (`members`) first, then the readable registry.
 */
export const useRelationTypes = (
  target: RelationTargetInfo,
  members: readonly ContentTargetMember[] | undefined,
): RelationTypes => {
  const { resolved } = useResolvedDefinitions();
  const { data: me } = useMe();
  return useMemo(() => {
    const models = resolved?.byId ?? new Map<string, ResolvedModelDefinition>();
    const byKey = new Map([...models.values()].map((model) => [model.apiKey, model.label]));
    if (target.kind === 'model') {
      const kinds = resolved ? familyKindsOf(models, resolved.index, target.model.id) : [];
      const isFamily = kinds.length > 1;
      const ids = new Set([target.model.id, ...kinds.map((kind) => kind.id)]);
      return {
        creatable: kinds,
        typeLabelOf: (modelKey) => (isFamily && modelKey ? byKey.get(modelKey) : undefined),
        covers: (modelId) => ids.has(modelId),
      };
    }
    if (target.kind === 'unreadable') {
      return { creatable: [], typeLabelOf: () => undefined, covers: () => false };
    }
    const memberIds =
      target.kind === 'interface' ? new Set(resolved?.index.implementedBy(target.id) ?? []) : undefined;
    const covers = (modelId: string) => memberIds === undefined || memberIds.has(modelId);
    const labels = new Map(byKey);
    for (const member of members ?? []) {
      labels.set(member.apiKey, member.label);
    }
    return {
      creatable: [...models.values()]
        .filter(
          (model) => model.kind === 'collection' && covers(model.id) && canOnModel(me, model.id, 'create'),
        )
        .sort(byLabel),
      typeLabelOf: (modelKey) => (modelKey ? (labels.get(modelKey) ?? modelKey) : undefined),
      covers,
    };
  }, [resolved, me, target, members]);
};
