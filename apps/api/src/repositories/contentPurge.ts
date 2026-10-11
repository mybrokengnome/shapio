import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/** Bound-parameter lists stay well below every dialect's limit. */
const ID_CHUNK = 500;

const chunksOf = <T>(items: readonly T[]): T[][] => {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += ID_CHUNK) {
    chunks.push(items.slice(start, start + ID_CHUNK));
  }
  return chunks;
};

/**
 * Removing a locale's content (the `purgeLocale` follow-up after a locale is deleted). Media references
 * belong to package G's table; they are per head, so a locale's go with its heads.
 */
export const removeMediaReferencesForLocale = (locale: string, trx: Transaction<DB>) =>
  trx.deleteFrom('media_references').where('locale', '=', locale).executeTakeFirst();

/**
 * The heads (as their entry IDs, one per head) of entries of non-localized models (`modelIds`) in `locale`
 * whose entry has none in `defaultLocale`. A non-localized entry keeps its heads in the locale it was created
 * in, so removing that locale moves it to the default instead of deleting it.
 */
export const findMovableHeads = async (
  locale: string,
  defaultLocale: string,
  modelIds: readonly string[],
  executor: Executor,
): Promise<string[]> => {
  if (modelIds.length === 0) {
    return [];
  }
  const rows = await executor
    .selectFrom('entry_heads as h')
    .select('h.entry_id')
    .where('h.locale', '=', locale)
    .where('h.model_id', 'in', [...modelIds])
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('entry_heads as d')
            .select('d.entry_id')
            .whereRef('d.entry_id', '=', 'h.entry_id')
            .where('d.locale', '=', defaultLocale),
        ),
      ),
    )
    .execute();
  return rows.map((row) => row.entry_id);
};

/**
 * Re-keys entries from one locale to another: their heads and everything keyed by head (relation edges,
 * media references, publication history, schedules, change set items, health findings). Revisions are
 * immutable history and keep the locale they were written in.
 */
export const moveEntriesToLocale = async (
  entryIds: readonly string[],
  from: string,
  to: string,
  trx: Transaction<DB>,
) => {
  for (const ids of chunksOf(entryIds)) {
    await trx
      .updateTable('relation_edges')
      .set({ locale: to })
      .where('source_entry_id', 'in', ids)
      .where('locale', '=', from)
      .execute();
    await trx
      .updateTable('media_references')
      .set({ locale: to })
      .where('entry_id', 'in', ids)
      .where('locale', '=', from)
      .execute();
    await trx
      .updateTable('publication_log')
      .set({ locale: to })
      .where('entry_id', 'in', ids)
      .where('locale', '=', from)
      .execute();
    await trx
      .updateTable('scheduled_publications')
      .set({ locale: to })
      .where('entry_id', 'in', ids)
      .where('locale', '=', from)
      .execute();
    await trx
      .updateTable('change_set_items')
      .set({ locale: to })
      .where('entry_id', 'in', ids)
      .where('locale', '=', from)
      .execute();
    await trx
      .updateTable('content_health_findings')
      .set({ locale: to })
      .where('entry_id', 'in', ids)
      .where('locale', '=', from)
      .execute();
    await trx
      .updateTable('entry_heads')
      .set({ locale: to })
      .where('entry_id', 'in', ids)
      .where('locale', '=', from)
      .execute();
  }
};

/** Live entries whose only heads are in `locale`. */
const entriesOnlyIn = (locale: string, executor: Executor) =>
  executor
    .selectFrom('entries as e')
    .where('e.deleted_at', 'is', null)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('entry_heads as h')
          .select('h.entry_id')
          .whereRef('h.entry_id', '=', 'e.id')
          .where('h.locale', '=', locale),
      ),
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('entry_heads as o')
            .select('o.entry_id')
            .whereRef('o.entry_id', '=', 'e.id')
            .where('o.locale', '!=', locale),
        ),
      ),
    );

/** Live entries whose only heads are in `locale` (they go with it), and whether each is published. */
export const findEntriesOnlyIn = async (locale: string, executor: Executor) => {
  const rows = await entriesOnlyIn(locale, executor)
    .select(['e.id', 'e.site_id', 'e.model_id'])
    .select((eb) =>
      eb
        .exists(
          eb
            .selectFrom('publication_log as p')
            .select('p.entry_id')
            .whereRef('p.entry_id', '=', 'e.id')
            .where('p.to_seq', 'is', null),
        )
        .as('was_published'),
    )
    .execute();
  // SQLite answers EXISTS with 0/1.
  return rows.map((row) => ({ ...row, was_published: Boolean(row.was_published) }));
};

/** How many live entries have heads only in `locale`, leaving out entries of the given models. */
export const countEntriesOnlyIn = async (
  locale: string,
  exceptModelIds: readonly string[],
  executor: Executor,
): Promise<number> => {
  const row = await entriesOnlyIn(locale, executor)
    .select(({ fn }) => fn.countAll<string>().as('count'))
    .$if(exceptModelIds.length > 0, (query) => query.where('e.model_id', 'not in', [...exceptModelIds]))
    .executeTakeFirstOrThrow();
  return Number(row.count);
};

/** Entries of these models with heads in `locale` and in another locale too (they lose one locale). */
export const findEntriesAlsoElsewhere = async (
  locale: string,
  modelIds: readonly string[],
  executor: Executor,
) => {
  if (modelIds.length === 0) {
    return [];
  }
  return executor
    .selectFrom('entry_heads as h')
    .select(['h.entry_id', 'h.model_id'])
    .distinct()
    .where('h.locale', '=', locale)
    .where('h.model_id', 'in', [...modelIds])
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('entry_heads as o')
          .select('o.entry_id')
          .whereRef('o.entry_id', '=', 'h.entry_id')
          .where('o.locale', '!=', locale),
      ),
    )
    .execute();
};

/** Releases every unique-registry row of these entries (they are being deleted). */
export const removeUniqueValuesForEntries = async (entryIds: readonly string[], trx: Transaction<DB>) => {
  for (const ids of chunksOf(entryIds)) {
    await trx.deleteFrom('unique_values').where('entry_id', 'in', ids).execute();
  }
};

/**
 * Removes a deleted locale's revisions, except those of the given entries (moved to another locale: their
 * heads still point at them). Revisions' parents never cross locales.
 */
export const removeRevisionsForLocale = async (
  locale: string,
  keptEntryIds: readonly string[],
  trx: Transaction<DB>,
) => {
  const kept = new Set(keptEntryIds);
  if (kept.size === 0) {
    await trx.deleteFrom('content_revisions').where('locale', '=', locale).execute();
    return;
  }
  const entryIds = await trx
    .selectFrom('content_revisions')
    .select('entry_id')
    .distinct()
    .where('locale', '=', locale)
    .execute();
  const purged = entryIds.map((row) => row.entry_id).filter((id) => !kept.has(id));
  for (const ids of chunksOf(purged)) {
    await trx
      .deleteFrom('content_revisions')
      .where('locale', '=', locale)
      .where('entry_id', 'in', ids)
      .execute();
  }
};

/** The IDs of a site's soft-deleted entries, as a subquery. */
const deletedEntryIdsOfSite = (siteId: string, trx: Transaction<DB>) =>
  trx.selectFrom('entries').select('id').where('site_id', '=', siteId).where('deleted_at', 'is not', null);

/**
 * Hard-deletes a site's soft-deleted entries and everything that hangs off them, so the site row can go
 * (the site and entry foreign keys restrict). Order matters: publication log rows and heads reference
 * revisions, revisions reference entries. Unique values, media references, schedules, preview tokens,
 * change set items and health findings cascade from the entries; relation edges from the heads.
 */
export const purgeDeletedEntriesOfSite = async (siteId: string, trx: Transaction<DB>) => {
  await trx
    .deleteFrom('publication_log')
    .where('site_id', '=', siteId)
    .where('entry_id', 'in', deletedEntryIdsOfSite(siteId, trx))
    .execute();
  await trx
    .deleteFrom('entry_heads')
    .where('site_id', '=', siteId)
    .where('entry_id', 'in', deletedEntryIdsOfSite(siteId, trx))
    .execute();
  await trx
    .deleteFrom('relation_edges')
    .where('target_entry_id', 'in', deletedEntryIdsOfSite(siteId, trx))
    .execute();
  await trx
    .deleteFrom('content_revisions')
    .where('entry_id', 'in', deletedEntryIdsOfSite(siteId, trx))
    .execute();
  await trx.deleteFrom('entries').where('site_id', '=', siteId).where('deleted_at', 'is not', null).execute();
};

/** The IDs of the soft-deleted entries of some models (on any site), as a subquery. */
const deletedEntryIdsOfModels = (modelIds: readonly string[], trx: Transaction<DB>) =>
  trx
    .selectFrom('entries')
    .select('id')
    .where('model_id', 'in', modelIds)
    .where('deleted_at', 'is not', null);

/**
 * Hard-deletes the soft-deleted entries of some models wherever they are, like `purgeDeletedEntriesOfSite`
 * (same order, same cascades). Used before purging a deleted site's definitions: an entry deleted on
 * another site while the definition was still shared keeps referencing it (plan site-schema).
 */
export const purgeDeletedEntriesOfModels = async (modelIds: readonly string[], trx: Transaction<DB>) => {
  if (modelIds.length === 0) {
    return;
  }
  await trx
    .deleteFrom('publication_log')
    .where('entry_id', 'in', deletedEntryIdsOfModels(modelIds, trx))
    .execute();
  await trx
    .deleteFrom('entry_heads')
    .where('entry_id', 'in', deletedEntryIdsOfModels(modelIds, trx))
    .execute();
  await trx
    .deleteFrom('relation_edges')
    .where('target_entry_id', 'in', deletedEntryIdsOfModels(modelIds, trx))
    .execute();
  await trx
    .deleteFrom('content_revisions')
    .where('entry_id', 'in', deletedEntryIdsOfModels(modelIds, trx))
    .execute();
  await trx
    .deleteFrom('entries')
    .where('model_id', 'in', modelIds)
    .where('deleted_at', 'is not', null)
    .execute();
};
