import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type PresenceKey = { entryId: string; adminUserId: string; tabId: string };

/** Records a heartbeat: inserts the tab's row or refreshes it (keeping when it started). */
export const touch = (
  row: PresenceKey & { modelId: string; locale: string | null; now: Date },
  executor: Executor = db,
) =>
  executor
    .insertInto('editor_presence')
    .values({
      entry_id: row.entryId,
      model_id: row.modelId,
      admin_user_id: row.adminUserId,
      tab_id: row.tabId,
      locale: row.locale,
      started_at: row.now,
      last_seen_at: row.now,
    })
    .onConflict((conflict) =>
      conflict.columns(['entry_id', 'admin_user_id', 'tab_id']).doUpdateSet({
        model_id: row.modelId,
        locale: row.locale,
        last_seen_at: row.now,
      }),
    )
    .execute();

export const remove = (key: PresenceKey, executor: Executor = db) =>
  executor
    .deleteFrom('editor_presence')
    .where('entry_id', '=', key.entryId)
    .where('admin_user_id', '=', key.adminUserId)
    .where('tab_id', '=', key.tabId)
    .execute();

const activeQuery = (executor: Executor, since: Date) =>
  executor
    .selectFrom('editor_presence as p')
    .innerJoin('admin_users as u', 'u.id', 'p.admin_user_id')
    .innerJoin('entries as e', 'e.id', 'p.entry_id')
    .select([
      'p.entry_id',
      'p.admin_user_id',
      'p.tab_id',
      'p.locale',
      'p.started_at',
      'u.name',
      'e.owner_app_user_id',
      'e.created_by_admin_id',
    ])
    .where('p.last_seen_at', '>=', since)
    .where('e.deleted_at', 'is', null)
    .orderBy('p.started_at')
    .orderBy('p.entry_id')
    .orderBy('p.admin_user_id')
    .orderBy('p.tab_id');

/** Tabs that sent a heartbeat since `since` on one entry. */
export const listActiveForEntry = (entryId: string, since: Date, executor: Executor = db) =>
  activeQuery(executor, since).where('p.entry_id', '=', entryId).execute();

/** Tabs that sent a heartbeat since `since` on any entry of a model. */
export const listActiveForModel = (modelId: string, since: Date, executor: Executor = db) =>
  activeQuery(executor, since).where('p.model_id', '=', modelId).execute();

export type ActivePresenceRow = Awaited<ReturnType<typeof listActiveForEntry>>[number];
