import type { Insertable, Kysely, Selectable, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB, MediaUploadGrants } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type MediaUploadGrantRow = Selectable<MediaUploadGrants>;
export type GrantStatus = 'pending' | 'consumed' | 'rejected' | 'expired';

export const insert = (grant: Insertable<MediaUploadGrants>, trx: Executor = db) =>
  trx.insertInto('media_upload_grants').values(grant).returningAll().executeTakeFirstOrThrow();

export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('media_upload_grants').selectAll().where('id', '=', id).executeTakeFirst();

export const lockById = (id: string, trx: Transaction<DB>) =>
  trx.selectFrom('media_upload_grants').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();

export const setStatus = (id: string, status: Exclude<GrantStatus, 'pending'>, trx: Executor = db) =>
  trx
    .updateTable('media_upload_grants')
    .set({ status, consumed_at: new Date() })
    .where('id', '=', id)
    .execute();
