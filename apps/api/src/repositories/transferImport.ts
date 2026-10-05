import type { Insertable, Kysely, Transaction } from 'kysely';
import type { ContentData } from '../db/contentData.js';
import { db } from '../db/index.js';
import { nextSequenceValue } from '../db/sql/values.js';
import type { DB, MediaAssets } from '../db/types.js';
import { appUserSiteOf } from './appUsers.js';
import { entryCreatedAtOf, entrySiteOf } from './entries.js';

type Executor = Kysely<DB> | Transaction<DB>;

/**
 * Writes and lookups behind `POST /api/admin/transfer/import` (package L). Imports preserve IDs and
 * timestamps, so these inserts take them explicitly where the regular repositories let the database
 * choose. Everything else (relation edges, media references, the unique registry, the publication log)
 * goes through the same primitives as every content write.
 */

/** Target-side state of entries named in a bundle (live or soft-deleted). */
export const findEntries = (ids: readonly string[], executor: Executor = db) =>
  ids.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('entries')
        .select(['id', 'model_id', 'deleted_at'])
        .where('id', 'in', ids)
        .execute();

export type TargetEntryRow = Awaited<ReturnType<typeof findEntries>>[number];

const HEAD_COLUMNS = [
  'entry_id',
  'locale',
  'state',
  'revision_id',
  'data',
  'autosaved_at',
  'version',
] as const;

export const findHeads = (entryIds: readonly string[], executor: Executor = db) =>
  entryIds.length === 0
    ? Promise.resolve([])
    : executor.selectFrom('entry_heads').select(HEAD_COLUMNS).where('entry_id', 'in', entryIds).execute();

export type TargetHeadRow = Awaited<ReturnType<typeof findHeads>>[number];

/** The entry's heads, locked for the rest of the transaction. */
export const lockHeads = (entryId: string, trx: Transaction<DB>) =>
  trx
    .selectFrom('entry_heads')
    .select(HEAD_COLUMNS)
    .where('entry_id', '=', entryId)
    .orderBy('locale')
    .orderBy('state')
    .forUpdate()
    .execute();

export const lockEntry = (id: string, trx: Transaction<DB>) =>
  trx
    .selectFrom('entries')
    .select(['id', 'model_id', 'deleted_at'])
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();

/** Entry rows with their original IDs and timestamps; existing rows are left alone. */
export const insertEntries = async (
  siteId: string,
  rows: ReadonlyArray<{
    id: string;
    modelId: string;
    ownerAppUserId: string | null;
    createdAt: string;
    updatedAt: string;
  }>,
  trx: Executor = db,
) => {
  if (rows.length === 0) {
    return;
  }
  await trx
    .insertInto('entries')
    .values(
      rows.map((row) => ({
        id: row.id,
        site_id: siteId,
        model_id: row.modelId,
        owner_app_user_id: row.ownerAppUserId,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      })),
    )
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
};

export const setEntryUpdatedAt = (id: string, updatedAt: string, trx: Executor = db) =>
  trx.updateTable('entries').set({ updated_at: updatedAt }).where('id', '=', id).execute();

/** Revisions are immutable and keep their IDs, so an existing revision is the same revision: skipped. */
export const insertRevision = (
  revision: {
    id: string;
    entryId: string;
    locale: string;
    schemaRevisionId: string;
    data: ContentData;
    reason: string;
    parentRevisionId: string | null;
    createdAt: string;
  },
  trx: Executor = db,
) =>
  trx
    .insertInto('content_revisions')
    .values({
      id: revision.id,
      entry_id: revision.entryId,
      locale: revision.locale,
      schema_revision_id: revision.schemaRevisionId,
      data: revision.data,
      reason: revision.reason,
      author_type: 'system',
      author_id: 'transfer',
      parent_revision_id: revision.parentRevisionId,
      created_at: revision.createdAt,
    })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();

export type ImportedHead = {
  entryId: string;
  modelId: string;
  locale: string;
  state: 'draft' | 'published';
  revisionId: string;
  data: ContentData;
  autosavedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** A new head exactly as exported (version and timestamps included). */
export const insertHead = (head: ImportedHead, trx: Executor = db) =>
  trx
    .insertInto('entry_heads')
    .values({
      entry_id: head.entryId,
      site_id: entrySiteOf(trx, head.entryId),
      entry_created_at: entryCreatedAtOf(trx, head.entryId),
      model_id: head.modelId,
      locale: head.locale,
      state: head.state,
      revision_id: head.revisionId,
      data: head.data,
      autosaved_at: head.autosavedAt,
      version: head.version,
      created_at: head.createdAt,
      updated_at: head.updatedAt,
    })
    .execute();

/** Moves an existing head to the imported state: a regular head move (version + 1, new change sequence). */
export const moveHead = (head: ImportedHead, trx: Executor = db) =>
  trx
    .updateTable('entry_heads')
    .set((eb) => ({
      revision_id: head.revisionId,
      data: head.data,
      autosaved_at: head.autosavedAt,
      version: eb('version', '+', eb.lit(1)),
      change_seq: nextSequenceValue('entry_heads_change_seq'),
      updated_at: head.updatedAt,
    }))
    .where('entry_id', '=', head.entryId)
    .where('locale', '=', head.locale)
    .where('state', '=', head.state)
    .execute();

/** Live entries of these models after `afterId` (keyset), for `--prune`. */
/** Live entries of some models on one site (another site's entries are never an import's to prune). */
export const listLiveEntryIds = async (
  siteId: string,
  modelIds: readonly string[],
  afterId: string | null,
  limit: number,
  executor: Executor = db,
) =>
  modelIds.length === 0
    ? []
    : executor
        .selectFrom('entries')
        .select(['id', 'model_id'])
        .where('site_id', '=', siteId)
        .where('model_id', 'in', modelIds)
        .where('deleted_at', 'is', null)
        .$if(afterId !== null, (qb) => qb.where('id', '>', afterId as string))
        .orderBy('id')
        .limit(limit)
        .execute();

export const findAssets = (ids: readonly string[], executor: Executor = db) =>
  ids.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('media_assets')
        .select(['id', 'storage_key', 'checksum_sha256', 'deleted_at'])
        .where('id', 'in', ids)
        .execute();

export type TargetAssetRow = Awaited<ReturnType<typeof findAssets>>[number];

export const insertAsset = (asset: Insertable<MediaAssets>, trx: Executor = db) =>
  trx
    .insertInto('media_assets')
    .values(asset)
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();

/** Live assets after `afterId` (keyset), for `--prune`. */
/** Live media assets of one site. */
export const listLiveAssetIds = (
  siteId: string,
  afterId: string | null,
  limit: number,
  executor: Executor = db,
) =>
  executor
    .selectFrom('media_assets')
    .select('id')
    .where('site_id', '=', siteId)
    .where('deleted_at', 'is', null)
    .$if(afterId !== null, (qb) => qb.where('id', '>', afterId as string))
    .orderBy('id')
    .limit(limit)
    .execute();

export const findFolderIds = async (ids: readonly string[], executor: Executor = db) =>
  ids.length === 0
    ? new Set<string>()
    : new Set(
        (await executor.selectFrom('media_folders').select('id').where('id', 'in', ids).execute()).map(
          (row) => row.id,
        ),
      );

export const insertFolder = (
  siteId: string,
  folder: { id: string; parentId: string | null; name: string; createdAt: string; updatedAt: string },
  trx: Executor = db,
) =>
  trx
    .insertInto('media_folders')
    .values({
      id: folder.id,
      site_id: siteId,
      parent_id: folder.parentId,
      name: folder.name,
      created_at: folder.createdAt,
      updated_at: folder.updatedAt,
    })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();

/** App users by ID, and the IDs already holding these emails (case-insensitive, live accounts). */
export const findAppUsers = async (
  ids: readonly string[],
  emails: readonly string[],
  executor: Executor = db,
) => {
  if (ids.length === 0) {
    return { ids: new Set<string>(), emails: new Map<string, string>() };
  }
  const byId = await executor.selectFrom('app_users').select('id').where('id', 'in', ids).execute();
  const byEmail =
    emails.length === 0
      ? []
      : await executor
          .selectFrom('app_users')
          .select((eb) => ['id', eb.fn<string>('lower', ['email']).as('email')])
          .where((eb) =>
            eb(
              eb.fn<string>('lower', ['email']),
              'in',
              emails.map((email) => email.toLowerCase()),
            ),
          )
          .where('deleted_at', 'is', null)
          .execute();
  return {
    ids: new Set(byId.map((row) => row.id)),
    emails: new Map(byEmail.map((row) => [row.email, row.id])),
  };
};

export const insertAppUser = (
  siteId: string,
  user: {
    id: string;
    email: string;
    name: string;
    passwordHash: string | null;
    confirmedAt: string | null;
    blockedAt: string | null;
    passwordChangedAt: string | null;
    createdAt: string;
    updatedAt: string;
  },
  trx: Executor = db,
) =>
  trx
    .insertInto('app_users')
    .values({
      id: user.id,
      site_id: siteId,
      email: user.email,
      name: user.name,
      password_hash: user.passwordHash,
      confirmed_at: user.confirmedAt,
      blocked_at: user.blockedAt,
      password_changed_at: user.passwordChangedAt,
      created_at: user.createdAt,
      updated_at: user.updatedAt,
    })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();

export const insertOAuthAccount = (
  account: { appUserId: string; provider: string; providerUserId: string; email: string | null },
  trx: Executor = db,
) =>
  trx
    .insertInto('app_oauth_accounts')
    .values({
      app_user_id: account.appUserId,
      // A copy of the account's site (app users are per site).
      site_id: appUserSiteOf(trx, account.appUserId),
      provider: account.provider,
      provider_user_id: account.providerUserId,
      email: account.email,
    })
    .onConflict((oc) => oc.doNothing())
    .execute();

/** Statuses of planned schema changes the import waits for. */
export const findSchemaChangeStatuses = (ids: readonly string[], executor: Executor = db) =>
  ids.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('schema_change_jobs')
        .select(['id', 'status', 'error'])
        .where('id', 'in', ids)
        .execute();

export const hasLiveEntries = async (executor: Executor = db): Promise<boolean> =>
  (await executor
    .selectFrom('entries')
    .select('id')
    .where('deleted_at', 'is', null)
    .limit(1)
    .executeTakeFirst()) !== undefined;
