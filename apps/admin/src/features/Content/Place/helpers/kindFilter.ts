import type { ContentFilter } from '@shapio/client';
import type { ResolvedModelDefinition } from '@shapio/schema';

/**
 * The Kind filter's options: every kind of the place's family, the type itself first (tree order, as
 * `usePlaceKinds` gives them); none for a type without kinds.
 */
export const kindFilterChoices = (
  kinds: readonly ResolvedModelDefinition[],
): readonly ResolvedModelDefinition[] => (kinds.length > 1 ? kinds : []);

/**
 * The list filter for a picked kind (`filters[__model]`, which narrows a family read to exactly the kinds
 * named). The place's type alone is `$eq`; a kind with kinds of its own means it and every kind under it
 * (`$in`), so "Physical" lists Apparel too. Undefined for a kind not in the family.
 */
export const kindFilterOf = (
  kinds: readonly ResolvedModelDefinition[],
  kindKey: string | undefined,
): ContentFilter | undefined => {
  const kind = kinds.find((candidate) => candidate.apiKey === kindKey);
  if (!kind) {
    return undefined;
  }
  // The place's type is the list's own kind: picking it means its own entries only.
  const below = kind === kinds[0] ? [] : kinds.filter((candidate) => candidate.ancestorIds.includes(kind.id));
  return below.length === 0
    ? { __model: { $eq: kind.apiKey } }
    : { __model: { $in: [kind.apiKey, ...below.map((candidate) => candidate.apiKey)] } };
};

/**
 * Both filters, when both are set: the list's filter tree with the kind's `__model` key beside its top-level
 * keys (the API reads `__model` at the top level only, never inside `$and`).
 */
export const withKindFilter = (
  filter: ContentFilter | undefined,
  kindFilter: ContentFilter | undefined,
): ContentFilter | undefined =>
  filter && kindFilter ? { ...filter, ...kindFilter } : (filter ?? kindFilter);
