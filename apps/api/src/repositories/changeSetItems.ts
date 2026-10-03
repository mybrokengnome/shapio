import type { ExpressionBuilder, Kysely, Selectable, Transaction } from 'kysely';
import { db } from '../db/index.js';
import { jsonObject } from '../db/sql/json.js';
import { rowLessThan } from '../db/sql/rows.js';
import { uuidParam } from '../db/sql/values.js';
import type { ChangeSetItems, DB, JsonObject } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type ChangeSetItemRow = Selectable<ChangeSetItems>;

/** Item states the open sets (not shipped, failed for good, or discarded) are in: an entry there is assigned. */
const ACTIVE_SET_STATUSES = ['open', 'scheduled', 'shipping', 'failed'] as const;

export const listForSet = (changeSetId: string, executor: Executor = db) =>
  executor
    .selectFrom('change_set_items')
    .selectAll()
    .where('change_set_id', '=', changeSetId)
    .orderBy('position')
    .orderBy('id')
    .execute();

const nextPosition = (changeSetId: string) => (eb: ExpressionBuilder<DB, 'change_set_items'>) =>
  eb
    .selectFrom('change_set_items')
    .select((sub) => sub.fn.coalesce(sub(sub.fn.max('position'), '+', sub.lit(1)), sub.lit(0)).as('next'))
    .where('change_set_id', '=', changeSetId);

/**
 * An item's site is a copy of its set's (sites plan §H). Composite foreign keys tie it to the set and to the
 * item's entry, so an item can never reference another site's entry: the insert fails instead.
 */
const setSiteOf = (changeSetId: string) => (eb: ExpressionBuilder<DB, 'change_set_items'>) =>
  eb.selectFrom('change_sets').select('site_id').where('id', '=', changeSetId);

/** Adds an entry item; undefined when the set already has this (entry, locale). */
export const insertEntryItem = (
  item: {
    changeSetId: string;
    entryId: string;
    modelId: string;
    locale: string;
    action: 'publish' | 'unpublish';
    sourceRevisionId?: string | null;
  },
  trx: Executor = db,
) =>
  trx
    .insertInto('change_set_items')
    .values({
      change_set_id: item.changeSetId,
      site_id: setSiteOf(item.changeSetId),
      kind: 'entry',
      position: nextPosition(item.changeSetId),
      entry_id: item.entryId,
      model_id: item.modelId,
      locale: item.locale,
      action: item.action,
      source_revision_id: item.sourceRevisionId ?? null,
    })
    .onConflict((oc) =>
      oc.columns(['change_set_id', 'entry_id', 'locale']).where('kind', '=', 'entry').doNothing(),
    )
    .returningAll()
    .executeTakeFirst();

/** Many restore items at once (positions in input order). */
export const insertEntryItems = async (
  changeSetId: string,
  items: ReadonlyArray<{
    entryId: string;
    modelId: string;
    locale: string;
    action: 'publish' | 'unpublish';
    sourceRevisionId: string | null;
  }>,
  trx: Executor = db,
) => {
  if (items.length === 0) {
    return;
  }
  await trx
    .insertInto('change_set_items')
    .values(
      items.map((item, position) => ({
        change_set_id: changeSetId,
        site_id: setSiteOf(changeSetId),
        kind: 'entry',
        position,
        entry_id: item.entryId,
        model_id: item.modelId,
        locale: item.locale,
        action: item.action,
        source_revision_id: item.sourceRevisionId,
      })),
    )
    .execute();
};

export const insertSchemaItem = (changeSetId: string, schemaDraftId: string, trx: Executor = db) =>
  trx
    .insertInto('change_set_items')
    .values({
      change_set_id: changeSetId,
      site_id: setSiteOf(changeSetId),
      kind: 'schema',
      position: nextPosition(changeSetId),
      schema_draft_id: schemaDraftId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

export const deleteItem = (changeSetId: string, itemId: string, trx: Executor = db) =>
  trx
    .deleteFrom('change_set_items')
    .where('change_set_id', '=', changeSetId)
    .where('id', '=', itemId)
    .returningAll()
    .executeTakeFirst();

export const setStatusAll = (changeSetId: string, status: 'pending' | 'done', trx: Executor = db) =>
  trx
    .updateTable('change_set_items')
    .set({ status, error: null })
    .where('change_set_id', '=', changeSetId)
    .execute();

export const markFailed = (changeSetId: string, itemId: string, error: string, trx: Executor = db) =>
  trx
    .updateTable('change_set_items')
    .set({ status: 'failed', error })
    .where('change_set_id', '=', changeSetId)
    .where('id', '=', itemId)
    .execute();

export const saveShipState = (itemId: string, state: unknown, trx: Executor = db) =>
  trx
    .updateTable('change_set_items')
    .set({ ship_state: JSON.stringify(state) })
    .where('id', '=', itemId)
    .executeTakeFirst();

export const clearShipState = (changeSetId: string, trx: Executor = db) =>
  trx
    .updateTable('change_set_items')
    .set({ ship_state: null })
    .where('change_set_id', '=', changeSetId)
    .execute();

export type UnassignedRow = {
  entry_id: string;
  model_id: string;
  locale: string;
  status: 'draft' | 'modified';
  updated_at: Date;
};

/**
 * Drafts not yet in an active change set: never published (`draft`) or differing from the live revision
 * (`modified`), newest first (keyset on updated_at, entry, locale).
 */
export const listUnassigned = (
  filter: {
    siteId: string;
    after?: { updatedAt: Date; entryId: string; locale: string };
    limit: number;
  },
  executor: Executor = db,
): Promise<UnassignedRow[]> => {
  let query = executor
    .selectFrom('entry_heads as d')
    .innerJoin('entries as e', 'e.id', 'd.entry_id')
    .leftJoin('entry_heads as p', (join) =>
      join
        .onRef('p.entry_id', '=', 'd.entry_id')
        .onRef('p.locale', '=', 'd.locale')
        .on('p.state', '=', 'published'),
    )
    .select([
      'd.entry_id',
      'd.model_id',
      'd.locale',
      'd.updated_at',
      (eb) =>
        eb
          .case()
          .when('p.entry_id', 'is', null)
          .then(eb.val('draft'))
          .else(eb.val('modified'))
          .end()
          .$castTo<'draft' | 'modified'>()
          .as('status'),
    ])
    .where('d.site_id', '=', filter.siteId)
    .where('d.state', '=', 'draft')
    .where('e.deleted_at', 'is', null)
    .where((eb) =>
      eb.or([
        eb('p.entry_id', 'is', null),
        eb('p.revision_id', '<>', eb.ref('d.revision_id')),
        eb('d.autosaved_at', 'is not', null),
      ]),
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('change_set_items as i')
            .innerJoin('change_sets as s', 's.id', 'i.change_set_id')
            .select((sub) => sub.lit(1).as('one'))
            .whereRef('i.entry_id', '=', 'd.entry_id')
            .whereRef('i.locale', '=', 'd.locale')
            .where('s.status', 'in', ACTIVE_SET_STATUSES),
        ),
      ),
    )
    .orderBy('d.updated_at', 'desc')
    .orderBy('d.entry_id', 'desc')
    .orderBy('d.locale', 'desc')
    .limit(filter.limit);
  if (filter.after) {
    const { updatedAt, entryId, locale } = filter.after;
    query = query.where((eb) =>
      rowLessThan(
        ['d.updated_at', 'd.entry_id', 'd.locale'],
        [eb.val(updatedAt), uuidParam(entryId), eb.val(locale)],
      ),
    );
  }
  return query.execute();
};

/** Every head of these entries (titles, review diffs, draft versions). */
export const findHeadsForEntries = (entryIds: readonly string[], executor: Executor = db) =>
  entryIds.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('entry_heads')
        .select(['entry_id', 'model_id', 'locale', 'state', 'revision_id', 'data', 'version', 'autosaved_at'])
        .where('entry_id', 'in', entryIds)
        .execute();

export type EntryHeadRow = Awaited<ReturnType<typeof findHeadsForEntries>>[number];

/**
 * Entries (distinct, every locale and state) of these models per site, with the site's key: the review of a
 * schema change lists what it affects on each site (option a: one schema, one snapshot per affected site).
 */
export const countEntriesBySite = (modelIds: readonly string[], executor: Executor = db) =>
  modelIds.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('entry_heads as h')
        .innerJoin('sites as s', 's.id', 'h.site_id')
        .innerJoin('entries as e', 'e.id', 'h.entry_id')
        .select((eb) => ['s.id', 's.key', eb.fn.count<string>('h.entry_id').distinct().as('entries')])
        .where('h.model_id', 'in', modelIds)
        .where('e.deleted_at', 'is', null)
        .groupBy(['s.id', 's.key'])
        .orderBy('s.key')
        .execute();

/** The entries among these that are not deleted. */
export const findLiveEntryIds = async (
  entryIds: readonly string[],
  executor: Executor = db,
): Promise<string[]> =>
  entryIds.length === 0
    ? []
    : (
        await executor
          .selectFrom('entries')
          .select('id')
          .where('id', 'in', [...new Set(entryIds)])
          .where('deleted_at', 'is', null)
          .execute()
      ).map((row) => row.id);

/**
 * Records the draft version each entry item that publishes its draft has now (when it is added or the set
 * is scheduled), so a scheduled ship can tell which drafts changed after review.
 */
export const recordReviewedDraftVersions = (changeSetId: string, trx: Executor = db, itemId?: string) =>
  trx
    .updateTable('change_set_items as i')
    .from('entry_heads as h')
    .set((eb) => ({ ship_state: jsonObject<JsonObject>({ reviewedDraftVersion: eb.ref('h.version') }) }))
    .whereRef('h.entry_id', '=', 'i.entry_id')
    .whereRef('h.locale', '=', 'i.locale')
    .where('h.state', '=', 'draft')
    .where('i.change_set_id', '=', changeSetId)
    .where('i.kind', '=', 'entry')
    .where('i.action', '=', 'publish')
    .where('i.source_revision_id', 'is', null)
    .$if(itemId !== undefined, (qb) => qb.where('i.id', '=', itemId ?? ''))
    .execute();
