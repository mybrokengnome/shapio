import { shapioTags, type SnapshotChange } from '@shapio/client';

/**
 * What a set of Shapio changes means for Next's data cache: the arguments for `revalidateTag`, matching the
 * tags `@shapio/client` puts on every delivery read (`shapioTags`). Pure, so the mapping is unit-tested;
 * src/lib/revalidation.ts feeds it from the snapshot diff, which names each changed entry by its route key.
 */
export type ChangedEntryRef = Pick<SnapshotChange, 'routeKey' | 'id'>;

/** Every delivery read of the site carries this tag: the site's settings, and everything after a schema change. */
export const siteTags = (siteKey: string | undefined): string[] => [shapioTags.site(siteKey)];

/**
 * The tags to revalidate for the entries that changed between two snapshots: each entry's model and the entry
 * itself. A schema change (fields added, converted or removed) can change any read, so it revalidates the
 * site tag, which every read carries.
 */
export const changeTags = (
  changes: readonly ChangedEntryRef[],
  schemaChanged: boolean,
  siteKey: string | undefined,
): string[] => {
  if (schemaChanged) {
    return siteTags(siteKey);
  }
  const tags = new Set(
    changes.flatMap(({ routeKey, id }) => [shapioTags.model(routeKey), shapioTags.entry(routeKey, id)]),
  );
  return [...tags].sort();
};
