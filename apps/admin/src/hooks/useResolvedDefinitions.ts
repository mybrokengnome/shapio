import type { DefinitionListItem } from '@shapio/client';
import { createDefinitionIndex, type DefinitionIndex, type ResolvedModelDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useDefinitions } from '@/api/schema';

/**
 * The model registry with inheritance resolved (plan polymorphic-types D1). The admin list holds stored
 * definitions (own fields plus `extends`); content screens want effective fields, so they read `byId`.
 */
export type ResolvedDefinitions = {
  /** Collections and single types by stable ID, with their effective fields (inherited first). */
  byId: ReadonlyMap<string, ResolvedModelDefinition>;
  /** Ancestors, children, descendants and families over the registry, and its interfaces' members. */
  index: DefinitionIndex;
  /** The registry's items as the API sent them (stored definitions; models only, no interfaces). */
  definitions: readonly DefinitionListItem[];
};

/**
 * Resolves every model of a registry once; components and interfaces are not models and are left out of
 * `byId`. The interfaces (when given) join the index, so `implementedBy` and `interfacesOf` work.
 */
export const resolveDefinitions = (
  definitions: readonly DefinitionListItem[],
  interfaces: readonly DefinitionListItem[] = [],
): ResolvedDefinitions => {
  const index = createDefinitionIndex([...definitions, ...interfaces].map(({ definition }) => definition));
  const byId = new Map<string, ResolvedModelDefinition>();
  for (const { definition } of definitions) {
    const resolved = index.resolve(definition.id);
    if (resolved) {
      byId.set(definition.id, resolved);
    }
  }
  return { byId, index, definitions };
};

/** The live registry, resolved; `resolved` is undefined while it loads (or when it failed: see `error`). */
export const useResolvedDefinitions = (): {
  resolved: ResolvedDefinitions | undefined;
  error: unknown;
} => {
  const { data, error } = useDefinitions('model');
  const interfaces = useDefinitions('interface');
  // Interfaces only add lookups: content screens still work (without them) when they fail to load.
  const interfacesSettled = interfaces.data !== undefined || interfaces.error !== null;
  const resolved = useMemo(
    () => (data && interfacesSettled ? resolveDefinitions(data, interfaces.data) : undefined),
    [data, interfacesSettled, interfaces.data],
  );
  return { resolved, error };
};

/**
 * A type and its kinds in tree order: the type itself, then each child (by label) followed by that child's
 * own kinds. Unknown IDs give an empty list. `models` and `index` come from `ResolvedDefinitions` (or the
 * content screens' `ContentSchema`, which carries the same two).
 */
export const familyKindsOf = (
  models: ReadonlyMap<string, ResolvedModelDefinition>,
  index: DefinitionIndex,
  id: string,
): ResolvedModelDefinition[] => {
  const model = models.get(id);
  if (!model) {
    return [];
  }
  const children = index
    .childrenOf(id)
    .flatMap((childId) => {
      const child = models.get(childId);
      return child ? [child] : [];
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return [model, ...children.flatMap((child) => familyKindsOf(models, index, child.id))];
};
