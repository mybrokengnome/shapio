import type { Insertable, Kysely, Selectable, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { ChangeSetApprovals, DB } from '../db/types.js';

/**
 * Sign-offs on change sets (plan approval-workflows): one row per approve or request-changes, with the round
 * and stage it was given in and the fingerprint of what the set held. The rows are the record of who signed
 * what; the set's own columns say where its review stands.
 */
type Executor = Kysely<DB> | Transaction<DB>;

export type ChangeSetApprovalRow = Selectable<ChangeSetApprovals>;
export type ApprovalDecision = 'approve' | 'request_changes';

export const insert = (row: Insertable<ChangeSetApprovals>, trx: Executor = db) =>
  trx.insertInto('change_set_approvals').values(row).returningAll().executeTakeFirstOrThrow();

/** Every sign-off of one set, oldest first (the view's history). */
export const listForSet = (changeSetId: string, executor: Executor = db) =>
  executor
    .selectFrom('change_set_approvals')
    .selectAll()
    .where('change_set_id', '=', changeSetId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();

/** The sign-offs of each set's current round, oldest first, for a page of sets. */
export const listCurrentRound = (changeSetIds: readonly string[], executor: Executor = db) =>
  changeSetIds.length === 0
    ? Promise.resolve([] as ChangeSetApprovalRow[])
    : executor
        .selectFrom('change_set_approvals')
        .innerJoin('change_sets', (join) =>
          join
            .onRef('change_sets.id', '=', 'change_set_approvals.change_set_id')
            .onRef('change_sets.approval_round', '=', 'change_set_approvals.round'),
        )
        .selectAll('change_set_approvals')
        .where('change_set_approvals.change_set_id', 'in', changeSetIds)
        .orderBy('change_set_approvals.created_at')
        .orderBy('change_set_approvals.id')
        .execute();
