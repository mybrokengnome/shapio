import type { Insertable, Kysely, Selectable, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB, PreviewTokens } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type PreviewTokenRow = Selectable<PreviewTokens>;

const PUBLIC_COLUMNS = [
  'id',
  'site_id',
  'token_prefix',
  'model_id',
  'entry_id',
  'locale',
  'connection_id',
  'delivery_role_id',
  'created_by',
  'expires_at',
  'revoked_at',
  'last_used_at',
  'created_at',
] as const;

export type PreviewTokenSummary = Pick<PreviewTokenRow, (typeof PUBLIC_COLUMNS)[number]>;

export const insert = (row: Insertable<PreviewTokens>, trx: Executor = db) =>
  trx.insertInto('preview_tokens').values(row).returning(PUBLIC_COLUMNS).executeTakeFirstOrThrow();

export const findLiveByHash = (hash: string, now: Date, trx: Executor = db) =>
  trx
    .selectFrom('preview_tokens')
    .select(PUBLIC_COLUMNS)
    .where('token_hash', '=', hash)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', now)
    .executeTakeFirst();

export const list = (filter: { entryId?: string }, trx: Executor = db) =>
  trx
    .selectFrom('preview_tokens')
    .select(PUBLIC_COLUMNS)
    .$if(filter.entryId !== undefined, (qb) => qb.where('entry_id', '=', filter.entryId ?? ''))
    .orderBy('created_at', 'desc')
    .limit(200)
    .execute();

export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('preview_tokens').select(PUBLIC_COLUMNS).where('id', '=', id).executeTakeFirst();

export const revoke = (id: string, now: Date, trx: Executor = db) =>
  trx
    .updateTable('preview_tokens')
    .set({ revoked_at: now })
    .where('id', '=', id)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();

/** Writes `last_used_at` at most once per interval (reads are hot; the column is informational). */
export const touchLastUsed = (id: string, now: Date, olderThan: Date, trx: Executor = db) =>
  trx
    .updateTable('preview_tokens')
    .set({ last_used_at: now })
    .where('id', '=', id)
    .where((eb) => eb.or([eb('last_used_at', 'is', null), eb('last_used_at', '<', olderThan)]))
    .execute();
