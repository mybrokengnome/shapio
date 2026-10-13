import type { ModelDefinition, ResolvedModelDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { familyKindsOf, useResolvedDefinitions } from '@/hooks/useResolvedDefinitions';

export type RelationKinds = {
  /** The target type and the kinds that extend it, in tree order (just the target without kinds). */
  kinds: readonly ResolvedModelDefinition[];
  /** The target has kinds: results and links name each entry's kind. */
  isFamily: boolean;
  /** The label of an entry's own kind (`item.model`), when the target has kinds. */
  kindLabelOf: (modelKey: string | undefined) => string | undefined;
  /** Whether a model is the target or one of its kinds (its entries can be linked). */
  covers: (modelId: string) => boolean;
};

/**
 * The kinds a relation can link to (plan polymorphic-types D13): a relation to a type accepts its kinds'
 * entries, which its list returns too.
 */
export const useRelationKinds = (target: ModelDefinition | undefined): RelationKinds => {
  const { resolved } = useResolvedDefinitions();
  return useMemo(() => {
    const kinds = resolved && target ? familyKindsOf(resolved.byId, resolved.index, target.id) : [];
    const isFamily = kinds.length > 1;
    const byKey = new Map(kinds.map((kind) => [kind.apiKey, kind]));
    const ids = new Set([...(target ? [target.id] : []), ...kinds.map((kind) => kind.id)]);
    return {
      kinds,
      isFamily,
      kindLabelOf: (modelKey) => (isFamily && modelKey ? byKey.get(modelKey)?.label : undefined),
      covers: (modelId) => ids.has(modelId),
    };
  }, [resolved, target]);
};
