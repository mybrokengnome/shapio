import { canonicalJson, type FieldDefinition, type SchemaDefinition } from '@shapio/schema';

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Three-way merge of JSON values: whatever only one side changed wins; objects merge key by key; where
 * both sides changed the same scalar or list, `mine` wins (the plan review shows it).
 */
export const merge3 = (base: unknown, mine: unknown, theirs: unknown): unknown => {
  if (same(mine, base)) {
    return theirs;
  }
  if (same(theirs, base)) {
    return mine;
  }
  if (isPlainObject(base) && isPlainObject(mine) && isPlainObject(theirs)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)]);
    const merged: Record<string, unknown> = {};
    for (const key of keys) {
      const value = merge3(base[key], mine[key], theirs[key]);
      if (value !== undefined) {
        merged[key] = value;
      }
    }
    return merged;
  }
  return mine;
};

const ids = (fields: readonly FieldDefinition[], kept: ReadonlyMap<string, unknown>) =>
  fields.filter((field) => kept.has(field.id)).map((field) => field.id);

/** Merges field lists by stable ID: additions and removals from both sides, edits merged per property. */
const mergeFields = (
  base: readonly FieldDefinition[],
  mine: readonly FieldDefinition[],
  theirs: readonly FieldDefinition[],
): FieldDefinition[] => {
  const baseById = new Map(base.map((field) => [field.id, field]));
  const mineById = new Map(mine.map((field) => [field.id, field]));
  const theirsById = new Map(theirs.map((field) => [field.id, field]));
  const reorderedByMe = !same(ids(mine, baseById), ids(base, mineById));
  const [primary, secondary] = reorderedByMe ? [mine, theirs] : [theirs, mine];
  const order = [...new Set([...primary, ...secondary].map((field) => field.id))];
  return order.flatMap((id) => {
    const original = baseById.get(id);
    const ours = mineById.get(id);
    const other = theirsById.get(id);
    if (original && !ours) {
      return [];
    }
    if (original && !other) {
      // They removed it: gone, unless this session edited it.
      return ours && !same(ours, original) ? [ours] : [];
    }
    if (!original) {
      return [(ours ?? other) as FieldDefinition];
    }
    return [merge3(original, ours, other) as FieldDefinition];
  });
};

/**
 * Re-applies this session's edits (`draft` relative to `base`) on top of a newer active version, like
 * rebasing a branch, so keeping one's edits after a conflict never undoes another admin's changes to
 * properties this session did not touch.
 */
export const rebaseDraft = (
  base: SchemaDefinition,
  draft: SchemaDefinition,
  latest: SchemaDefinition,
): SchemaDefinition => {
  const { fields: baseFields, ...baseRest } = base;
  const { fields: draftFields, ...draftRest } = draft;
  const { fields: latestFields, ...latestRest } = latest;
  const merged = merge3(baseRest, draftRest, latestRest) as Omit<SchemaDefinition, 'fields'>;
  return { ...merged, fields: mergeFields(baseFields, draftFields, latestFields) } as SchemaDefinition;
};
