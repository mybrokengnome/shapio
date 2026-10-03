import type { Kysely, Transaction } from 'kysely';
import type { HeadState } from '../content/model.js';
import type { ContentData } from '../db/contentData.js';
import { db } from '../db/index.js';
import { nextSequenceValue } from '../db/sql/values.js';
import type { DB } from '../db/types.js';
import { entrySiteOf } from './entries.js';

type Executor = Kysely<DB> | Transaction<DB>;

const COLUMNS = [
  'entry_id',
  'site_id',
  'model_id',
  'locale',
  'state',
  'revision_id',
  'data',
  'autosaved_at',
  'version',
  'change_seq',
  'created_at',
  'updated_at',
] as const;

const NEXT_CHANGE_SEQ = nextSequenceValue('entry_heads_change_seq');

/** Every head of an entry, locked for the rest of the transaction. */
export const lockForEntry = (entryId: string, trx: Transaction<DB>) =>
  trx
    .selectFrom('entry_heads')
    .select(COLUMNS)
    .where('entry_id', '=', entryId)
    .orderBy('locale')
    .orderBy('state')
    .forUpdate()
    .execute();

export type HeadRecord = Awaited<ReturnType<typeof lockForEntry>>[number];

export const findForEntry = (entryId: string, executor: Executor = db) =>
  executor.selectFrom('entry_heads').select(COLUMNS).where('entry_id', '=', entryId).execute();

export type HeadWrite = {
  entryId: string;
  modelId: string;
  locale: string;
  state: HeadState;
  revisionId: string;
  data: ContentData;
  autosavedAt: Date | null;
  now: Date;
};

export const insert = (head: HeadWrite, trx: Executor = db) =>
  trx
    .insertInto('entry_heads')
    .values({
      entry_id: head.entryId,
      // A copy of the entry's site (the composite foreign key keeps them equal).
      site_id: entrySiteOf(trx, head.entryId),
      model_id: head.modelId,
      locale: head.locale,
      state: head.state,
      revision_id: head.revisionId,
      data: head.data,
      autosaved_at: head.autosavedAt,
      created_at: head.now,
      updated_at: head.now,
    })
    .returning(COLUMNS)
    .executeTakeFirstOrThrow();

/** Moves a head: new data and revision, version + 1, a fresh change sequence number. */
export const update = (head: HeadWrite, trx: Executor = db) =>
  trx
    .updateTable('entry_heads')
    .set((eb) => ({
      revision_id: head.revisionId,
      data: head.data,
      autosaved_at: head.autosavedAt,
      version: eb('version', '+', eb.lit(1)),
      change_seq: NEXT_CHANGE_SEQ,
      updated_at: head.now,
    }))
    .where('entry_id', '=', head.entryId)
    .where('locale', '=', head.locale)
    .where('state', '=', head.state)
    .returning(COLUMNS)
    .executeTakeFirstOrThrow();

/**
 * Rewrites stored data in place for a schema migration step, only if the head has not moved since it was
 * read (`change_seq` compare-and-set). Keeps the version and sequence number: an editor's open form is not
 * stale, and the planner's final delta re-check does not revisit heads it already converted.
 */
export const rewriteData = async (
  key: { entryId: string; locale: string; state: string; changeSeq: string },
  data: ContentData,
  trx: Executor = db,
  revisionId?: string,
): Promise<boolean> => {
  const result = await trx
    .updateTable('entry_heads')
    .set({ data, ...(revisionId ? { revision_id: revisionId } : {}) })
    .where('entry_id', '=', key.entryId)
    .where('locale', '=', key.locale)
    .where('state', '=', key.state)
    .where('change_seq', '=', key.changeSeq)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
};

export const remove = (entryId: string, locale: string, state: HeadState, trx: Executor = db) =>
  trx
    .deleteFrom('entry_heads')
    .where('entry_id', '=', entryId)
    .where('locale', '=', locale)
    .where('state', '=', state)
    .executeTakeFirst();

export const removeForEntry = (entryId: string, trx: Executor = db) =>
  trx.deleteFrom('entry_heads').where('entry_id', '=', entryId).executeTakeFirst();

export const removeForLocale = (locale: string, trx: Executor = db) =>
  trx.deleteFrom('entry_heads').where('locale', '=', locale).executeTakeFirst();

export const countForModels = async (
  modelIds: readonly string[],
  executor: Executor = db,
): Promise<number> => {
  if (modelIds.length === 0) {
    return 0;
  }
  const row = await executor
    .selectFrom('entry_heads')
    .select(({ fn }) => fn.countAll<string>().as('count'))
    .where('model_id', 'in', modelIds)
    .executeTakeFirstOrThrow();
  return Number(row.count);
};

export const countForLocale = async (locale: string, executor: Executor = db): Promise<number> => {
  const row = await executor
    .selectFrom('entry_heads')
    .select(({ fn }) => fn.countAll<string>().as('count'))
    .where('locale', '=', locale)
    .executeTakeFirstOrThrow();
  return Number(row.count);
};

/** The highest change sequence number among a model's heads ("0" when it has none). */
export const maxChangeSeq = async (modelIds: readonly string[], executor: Executor = db): Promise<string> => {
  const row = await executor
    .selectFrom('entry_heads')
    .select(({ fn }) => fn.max('change_seq').as('max'))
    .where('model_id', 'in', modelIds)
    .executeTakeFirst();
  return row?.max ?? '0';
};

export type EntryBatchFilter = {
  modelIds: readonly string[];
  /** Keyset cursor: continue after this entry. */
  afterEntryId: string | null;
  /** Only entries with at least one head changed after this sequence number (exclusive). */
  changedAfterSeq?: string;
  /** Number of entries per batch. */
  limit: number;
};

/**
 * Every head of the next batch of entries, in key order, for resumable scans over large models. Schema
 * changes work per entry: a conversion can move values across an entry's locales and states.
 */
export const scanEntryBatch = (filter: EntryBatchFilter, executor: Executor = db) => {
  let entries = executor
    .selectFrom('entry_heads')
    .select('entry_id')
    .distinct()
    .where('model_id', 'in', filter.modelIds)
    .orderBy('entry_id')
    .limit(filter.limit);
  if (filter.afterEntryId !== null) {
    entries = entries.where('entry_id', '>', filter.afterEntryId);
  }
  if (filter.changedAfterSeq !== undefined) {
    entries = entries.where('change_seq', '>', filter.changedAfterSeq);
  }
  return executor
    .selectFrom('entry_heads')
    .select([
      'entry_id',
      'site_id',
      'model_id',
      'locale',
      'state',
      'revision_id',
      'data',
      'autosaved_at',
      'change_seq',
    ])
    .where('model_id', 'in', filter.modelIds)
    .where('entry_id', 'in', entries)
    .orderBy('entry_id')
    .orderBy('locale')
    .orderBy('state')
    .execute();
};

export type ScannedHead = Awaited<ReturnType<typeof scanEntryBatch>>[number];

/** Published heads' revisions of these entries (admin list status: draft / published / modified). */
export const findPublishedRevisions = (entryIds: readonly string[], executor: Executor = db) =>
  entryIds.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('entry_heads')
        .select(['entry_id', 'locale', 'revision_id'])
        .where('entry_id', 'in', entryIds)
        .where('state', '=', 'published')
        .execute();

/** Locales in which each of the entries has a published head (relation targets). */
export const findPublishedLocales = (entryIds: readonly string[], executor: Executor = db) =>
  entryIds.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('entry_heads')
        .select(['entry_id', 'locale'])
        .where('entry_id', 'in', entryIds)
        .where('state', '=', 'published')
        .execute();

/** Draft data of several entries, every locale (titles for lists of findings). */
export const findDraftsForEntries = (entryIds: readonly string[], executor: Executor = db) =>
  entryIds.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('entry_heads')
        .select(['entry_id', 'locale', 'data'])
        .where('entry_id', 'in', entryIds)
        .where('state', '=', 'draft')
        .execute();

/** Every head of several entries without their data: what per-locale statuses need (content lists). */
export const findStatesForEntries = (entryIds: readonly string[], executor: Executor = db) =>
  entryIds.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('entry_heads')
        .select(['entry_id', 'locale', 'state', 'revision_id', 'autosaved_at'])
        .where('entry_id', 'in', entryIds)
        .orderBy('entry_id')
        .orderBy('locale')
        .execute();
