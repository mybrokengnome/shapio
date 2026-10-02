import type { Kysely, Transaction } from 'kysely';
import type { ContentData } from '../db/contentData.js';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type RevisionReason =
  'create' | 'save' | 'publish' | 'restore' | 'duplicate' | 'localize' | 'conversion';

export type NewRevision = {
  entryId: string;
  locale: string;
  schemaRevisionId: string;
  data: ContentData;
  reason: RevisionReason;
  authorType: string;
  authorId: string | null;
  parentRevisionId: string | null;
};

const SUMMARY_COLUMNS = [
  'id',
  'entry_id',
  'locale',
  'schema_revision_id',
  'reason',
  'author_type',
  'author_id',
  'parent_revision_id',
  'created_at',
] as const;

export const insert = (revision: NewRevision, trx: Executor = db) =>
  trx
    .insertInto('content_revisions')
    .values({
      entry_id: revision.entryId,
      locale: revision.locale,
      schema_revision_id: revision.schemaRevisionId,
      // pg serializes objects as JSON (content data is always an object, never an array).
      data: revision.data,
      reason: revision.reason,
      author_type: revision.authorType,
      author_id: revision.authorId,
      parent_revision_id: revision.parentRevisionId,
    })
    .returning(SUMMARY_COLUMNS)
    .executeTakeFirstOrThrow();

export const findById = (id: string, executor: Executor = db) =>
  executor
    .selectFrom('content_revisions')
    .select([...SUMMARY_COLUMNS, 'data'])
    .where('id', '=', id)
    .executeTakeFirst();

/** Stored data of several revisions at once (titles and covers for the snapshot diff). */
export const findDataByIds = (ids: readonly string[], executor: Executor = db) =>
  ids.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('content_revisions')
        .select(['id', 'data'])
        .where('id', 'in', [...ids])
        .execute();

export const listForEntry = (
  entryId: string,
  locale: string | null,
  limit: number,
  executor: Executor = db,
) => {
  let query = executor
    .selectFrom('content_revisions')
    .select(SUMMARY_COLUMNS)
    .where('entry_id', '=', entryId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit);
  if (locale) {
    query = query.where('locale', '=', locale);
  }
  return query.execute();
};

export type RevisionSummaryRow = Awaited<ReturnType<typeof listForEntry>>[number];

/** Removes a deleted locale's history (purge follow-up). Revisions' parents never cross locales. */
export const deleteForLocale = (locale: string, trx: Executor = db) =>
  trx.deleteFrom('content_revisions').where('locale', '=', locale).executeTakeFirst();
