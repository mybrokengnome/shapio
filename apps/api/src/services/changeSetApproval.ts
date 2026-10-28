import type { Kysely, Transaction } from 'kysely';
import { CHANGE_SET_EVENTS } from '../constants/publishing.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import { writeOutboxEvent } from '../jobs/outbox.js';
import { adminIdOf, tokenIdOf } from '../publishing/principals.js';
import * as changeSetsRepository from '../repositories/changeSets.js';
import type { ChangeSetRow } from '../repositories/changeSets.js';
import * as sitesRepository from '../repositories/sites.js';
import { isApprovalCurrent, loadFingerprint } from './changeSetFingerprint.js';
import { auditChangeSet, getChangeSet, type ChangeSetServiceContext } from './changeSets.js';
import { changeSetNotFound, type ChangeSetView } from './changeSetViews.js';

/**
 * Approval on change sets (plan approval). A set is sent for approval, approved, or sent back with a note;
 * a site that requires approval refuses to ship or schedule a set that is not approved or whose approval is
 * outdated (the fingerprint it was given for no longer matches, see changeSetFingerprint.ts).
 *
 * Approval writes never bump the set's version: approving is not an edit, so an editor's open page stays
 * current. Anyone with `changes.approve` may approve, the author included (v1). Routes check the actions;
 * every transition is audited (the set's timeline) and emits a webhook event.
 */
type Executor = Kysely<DB> | Transaction<DB>;

export const approvalStateError = (status: string, action: string) =>
  new AppError(409, 'CHANGE_SET_STATE', `A ${status} change set cannot be ${action}`, { status });

export const changeSetNotApproved = () =>
  new AppError(
    409,
    'CHANGE_SET_NOT_APPROVED',
    'This site requires an approved change set before it ships or is scheduled. Ask for approval first.',
  );

export const changeSetApprovalStale = () =>
  new AppError(
    409,
    'CHANGE_SET_APPROVAL_STALE',
    'The change set changed after it was approved. Ask for approval again.',
  );

/** Set statuses each transition accepts (a set being scheduled or shipped, or discarded, accepts none). */
const ALLOWED: Readonly<Record<'request' | 'approve' | 'requestChanges' | 'clear', ReadonlySet<string>>> = {
  request: new Set(['open', 'failed']),
  approve: new Set(['open', 'failed', 'shipped']),
  requestChanges: new Set(['open', 'failed']),
  clear: new Set(['open', 'failed', 'shipped']),
};

const VERB: Readonly<Record<keyof typeof ALLOWED, string>> = {
  request: 'sent for approval',
  approve: 'approved',
  requestChanges: 'sent back',
  clear: 'cleared of its approval',
};

type Transition = {
  kind: keyof typeof ALLOWED;
  audit: string;
  event: string;
  /** The approval columns to write, given the locked row (and its fingerprint when approving). */
  changes: (row: ChangeSetRow, now: Date, fingerprint: string | null) => ApprovalChanges;
};

type ApprovalChanges = Parameters<typeof changeSetsRepository.updateApproval>[1];

const NO_DECISION = {
  approved_by: null,
  approved_by_token: null,
  approved_at: null,
  approved_fingerprint: null,
} as const;

const transitionsFor = (context: ChangeSetServiceContext, note: string): Record<string, Transition> => {
  const admin = adminIdOf(context.actor);
  const token = tokenIdOf(context.actor);
  return {
    request: {
      kind: 'request',
      audit: 'change_set.approval_request',
      event: CHANGE_SET_EVENTS.approvalRequested,
      changes: (_row, now) => ({
        approval_status: 'requested',
        approval_note: note,
        approval_requested_by: admin,
        approval_requested_by_token: token,
        approval_requested_at: now,
        ...NO_DECISION,
      }),
    },
    approve: {
      kind: 'approve',
      audit: 'change_set.approve',
      event: CHANGE_SET_EVENTS.approved,
      changes: (_row, now, fingerprint) => ({
        approval_status: 'approved',
        approval_note: note,
        approved_by: admin,
        approved_by_token: token,
        approved_at: now,
        approved_fingerprint: fingerprint,
      }),
    },
    requestChanges: {
      kind: 'requestChanges',
      audit: 'change_set.approval_request_changes',
      event: CHANGE_SET_EVENTS.changesRequested,
      // `approved_by`/`approved_at` record who decided, also when the decision is "request changes".
      changes: (_row, now) => ({
        approval_status: 'changes_requested',
        approval_note: note,
        approved_by: admin,
        approved_by_token: token,
        approved_at: now,
        approved_fingerprint: null,
      }),
    },
    clear: {
      kind: 'clear',
      audit: 'change_set.approval_clear',
      event: '',
      changes: () => ({
        approval_status: 'none',
        approval_note: '',
        approval_requested_by: null,
        approval_requested_by_token: null,
        approval_requested_at: null,
        ...NO_DECISION,
      }),
    },
  };
};

const runTransition = async (
  context: ChangeSetServiceContext,
  id: string,
  name: keyof typeof ALLOWED,
  note: string,
): Promise<ChangeSetView> => {
  const transition = transitionsFor(context, note)[name] as Transition;
  await context.db.transaction().execute(async (trx) => {
    const row = await changeSetsRepository.lockOnSite(context.site.id, id, trx);
    if (!row) {
      throw changeSetNotFound(id);
    }
    if (!ALLOWED[transition.kind].has(row.status)) {
      throw approvalStateError(row.status, VERB[transition.kind]);
    }
    const fingerprint = transition.kind === 'approve' ? await loadFingerprint(row, trx) : null;
    await changeSetsRepository.updateApproval(id, transition.changes(row, new Date(), fingerprint), trx);
    await auditChangeSet(trx, context, id, transition.audit, { title: row.title, ...(note ? { note } : {}) });
    if (transition.event) {
      await writeOutboxEvent(trx, {
        type: transition.event,
        aggregateType: 'change_set',
        aggregateId: id,
        siteId: context.site.id,
        payload: { changeSetId: id, title: row.title, status: row.status, note },
      });
    }
  });
  return getChangeSet(context, id);
};

export const requestApproval = (context: ChangeSetServiceContext, id: string, input: { note?: string }) =>
  runTransition(context, id, 'request', input.note ?? '');

export const approveChangeSet = (context: ChangeSetServiceContext, id: string, input: { note?: string }) =>
  runTransition(context, id, 'approve', input.note ?? '');

export const requestChanges = (context: ChangeSetServiceContext, id: string, input: { note: string }) =>
  runTransition(context, id, 'requestChanges', input.note);

export const clearApproval = (context: ChangeSetServiceContext, id: string) =>
  runTransition(context, id, 'clear', '');

/**
 * The gate (plan approval): when the set's site requires approval, a set ships or is scheduled only while
 * approved with a matching fingerprint. Checked by `planShip`, so interactive, scheduled and job-run ships
 * (and scheduling, which plans the ship) all check it.
 */
export const assertShipApproved = async (row: ChangeSetRow, executor: Executor): Promise<void> => {
  const site = await sitesRepository.findApprovalSetting(row.site_id, executor);
  if (!site?.require_approval) {
    return;
  }
  if (row.approval_status !== 'approved') {
    throw changeSetNotApproved();
  }
  if (!(await isApprovalCurrent(row, executor))) {
    throw changeSetApprovalStale();
  }
};

/** Whether the set's site requires approval. */
export const siteRequiresApproval = async (siteId: string, executor: Executor): Promise<boolean> =>
  (await sitesRepository.findApprovalSetting(siteId, executor))?.require_approval ?? false;
