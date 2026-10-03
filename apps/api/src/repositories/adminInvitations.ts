import type { Insertable, Kysely, Selectable, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { AdminInvitations, DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type AdminInvitationRow = Selectable<AdminInvitations>;
export type NewAdminInvitation = Insertable<AdminInvitations>;

const PUBLIC_COLUMNS = ['id', 'email', 'role_assignments', 'invited_by', 'expires_at', 'created_at'] as const;

export const insert = (invitation: NewAdminInvitation, trx: Executor = db) =>
  trx.insertInto('admin_invitations').values(invitation).returning(PUBLIC_COLUMNS).executeTakeFirstOrThrow();

export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('admin_invitations').selectAll().where('id', '=', id).executeTakeFirst();

export const listPending = (now: Date, trx: Executor = db) =>
  trx
    .selectFrom('admin_invitations')
    .select(PUBLIC_COLUMNS)
    .where('accepted_at', 'is', null)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', now)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();

/** Locks the invitation for this token hash so it can be accepted at most once. */
export const lockByTokenHash = (tokenHash: string, trx: Transaction<DB>) =>
  trx
    .selectFrom('admin_invitations')
    .selectAll()
    .where('token_hash', '=', tokenHash)
    .forUpdate()
    .executeTakeFirst();

export const findByTokenHash = (tokenHash: string, trx: Executor = db) =>
  trx.selectFrom('admin_invitations').selectAll().where('token_hash', '=', tokenHash).executeTakeFirst();

export const setTokenHash = (id: string, tokenHash: string, now: Date, trx: Executor = db) =>
  trx
    .updateTable('admin_invitations')
    .set({ token_hash: tokenHash, updated_at: now })
    .where('id', '=', id)
    .execute();

/** Issues the first token only: false when one was already issued (a copied link got there first). */
export const setFirstTokenHash = async (
  id: string,
  tokenHash: string,
  now: Date,
  trx: Executor = db,
): Promise<boolean> => {
  const result = await trx
    .updateTable('admin_invitations')
    .set({ token_hash: tokenHash, updated_at: now })
    .where('id', '=', id)
    .where('token_hash', 'is', null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
};

export const markAccepted = (id: string, now: Date, trx: Executor = db) =>
  trx
    .updateTable('admin_invitations')
    .set({ accepted_at: now, updated_at: now })
    .where('id', '=', id)
    .execute();

export const revoke = async (id: string, now: Date, trx: Executor = db): Promise<boolean> => {
  const result = await trx
    .updateTable('admin_invitations')
    .set({ revoked_at: now, updated_at: now })
    .where('id', '=', id)
    .where('accepted_at', 'is', null)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
};

/** Revokes earlier pending invitations to the same address (re-inviting replaces them). */
export const revokePendingForEmail = (email: string, now: Date, trx: Executor = db) =>
  trx
    .updateTable('admin_invitations')
    .set({ revoked_at: now, updated_at: now })
    .where('email', '=', email)
    .where('accepted_at', 'is', null)
    .where('revoked_at', 'is', null)
    .execute();
