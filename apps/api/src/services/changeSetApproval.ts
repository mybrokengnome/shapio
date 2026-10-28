import type { Kysely, Transaction } from 'kysely';
import { CHANGE_SET_EVENTS } from '../constants/publishing.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import { writeOutboxEvent } from '../jobs/outbox.js';
import * as changeSetApprovalsRepository from '../repositories/changeSetApprovals.js';
import * as changeSetsRepository from '../repositories/changeSets.js';
import type { ChangeSetRow } from '../repositories/changeSets.js';
import {
  effectiveWorkflow,
  ineligibleReason,
  nextReviewStep,
  signerOf,
  type ApprovalStage,
  type ApprovalWorkflow,
} from './approvalWorkflows.js';
import { approversAt, currentStageOf, loadKnownRoles } from './changeSetApprovalViews.js';
import { isApprovalCurrent, isReviewOutdated, loadFingerprint } from './changeSetFingerprint.js';
import { auditChangeSet, getChangeSet, type ChangeSetServiceContext } from './changeSets.js';
import { changeSetNotFound, type ChangeSetView } from './changeSetViews.js';

/**
 * Approval workflows on change sets (plan approval-workflows, ADR 0014). Asking for approval freezes the
 * site's effective workflow on the set and starts a new round at its first stage. Each eligible approver's
 * sign-off is a row; a stage completes when it has its required number of distinct approvers, and after the
 * last stage the set is approved, pinned to the fingerprint every sign-off of the round was given for. A
 * change after the first sign-off makes the review outdated: nobody can sign until it is asked for again.
 *
 * Approval writes never bump the set's version: approving is not an edit, so an editor's open page stays
 * current. Routes check `changes.manage` / `changes.approve`; eligibility (roles, self-approval, already
 * signed) is checked here under the set's row lock. Every step is audited (the set's timeline).
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
    'The change set changed after it was signed off. Ask for approval again.',
  );

const notConfigured = () =>
  new AppError(
    409,
    'CHANGE_SET_APPROVAL_NOT_CONFIGURED',
    'This site has no approval workflow, so its change sets cannot be sent for approval',
  );

const notInReview = (status: string) =>
  new AppError(409, 'CHANGE_SET_APPROVAL_NOT_REQUESTED', 'This change set is not waiting for approval', {
    approvalStatus: status,
  });

const NOT_ELIGIBLE_MESSAGES: Readonly<Record<string, string>> = {
  rolesDeleted: 'Every role this stage names was deleted, so nobody can sign it. Clear and ask again.',
  role: 'Your roles may not sign off at this stage',
  self: 'You cannot sign off on a change set you created or sent for approval',
  signed: 'You already signed off at this stage',
};

const notEligible = (reason: string) =>
  new AppError(403, 'CHANGE_SET_APPROVAL_NOT_ELIGIBLE', NOT_ELIGIBLE_MESSAGES[reason] ?? 'Not eligible', {
    reason,
  });

/** Set statuses each step accepts (a set being scheduled or shipped, shipped, or discarded accepts none). */
const ALLOWED: Readonly<Record<'request' | 'sign' | 'clear', ReadonlySet<string>>> = {
  request: new Set(['open', 'failed']),
  sign: new Set(['open', 'failed']),
  clear: new Set(['open', 'failed', 'shipped']),
};

type ApprovalChanges = Parameters<typeof changeSetsRepository.updateApproval>[1];

const actorRef = (context: ChangeSetServiceContext) => {
  const signer = signerOf(context.actor);
  return signer.adminUserId
    ? { type: 'admin', id: signer.adminUserId }
    : signer.apiTokenId
      ? { type: 'token', id: signer.apiTokenId }
      : { type: 'system', id: null };
};

const stageRef = (stage: ApprovalStage, index: number) => ({ index, id: stage.id, name: stage.name });

/** One locked step: the row is locked on the context's site and its status checked. */
const lockFor = async (
  trx: Transaction<DB>,
  context: ChangeSetServiceContext,
  id: string,
  allowed: ReadonlySet<string>,
  verb: string,
) => {
  const row = await changeSetsRepository.lockOnSite(context.site.id, id, trx);
  if (!row) {
    throw changeSetNotFound(id);
  }
  if (!allowed.has(row.status)) {
    throw approvalStateError(row.status, verb);
  }
  return row;
};

const emit = (
  trx: Transaction<DB>,
  context: ChangeSetServiceContext,
  row: ChangeSetRow,
  type: string,
  payload: Record<string, unknown>,
) =>
  writeOutboxEvent(trx, {
    type,
    aggregateType: 'change_set',
    aggregateId: row.id,
    siteId: context.site.id,
    payload: {
      changeSetId: row.id,
      title: row.title,
      status: row.status,
      actor: actorRef(context),
      ...payload,
    },
  });

const write = (trx: Transaction<DB>, id: string, changes: ApprovalChanges) =>
  changeSetsRepository.updateApproval(id, changes, trx);

/** Freezes the site's effective workflow and starts a new round at its first stage. */
export const requestApproval = async (
  context: ChangeSetServiceContext,
  id: string,
  input: { note?: string },
): Promise<ChangeSetView> => {
  const note = input.note ?? '';
  await context.db.transaction().execute(async (trx) => {
    const row = await lockFor(trx, context, id, ALLOWED.request, 'sent for approval');
    const workflow = await effectiveWorkflow(context.site.id, trx);
    const first = workflow?.stages[0];
    if (!workflow || !first) {
      throw notConfigured();
    }
    const signer = signerOf(context.actor);
    const round = row.approval_round + 1;
    await write(trx, id, {
      approval_status: 'requested',
      approval_note: note,
      approval_requested_by: signer.adminUserId,
      approval_requested_by_token: signer.apiTokenId,
      approval_requested_at: new Date(),
      approval_workflow: JSON.stringify(workflow),
      approval_round: round,
      approval_stage: 0,
      approval_fingerprint: null,
    });
    await auditChangeSet(trx, context, id, 'change_set.approval_request', {
      title: row.title,
      round,
      ...(note ? { note } : {}),
    });
    await emit(trx, context, row, CHANGE_SET_EVENTS.approvalRequested, {
      note,
      round,
      stage: stageRef(first, 0),
    });
  });
  return getChangeSet(context, id);
};

type ReviewState = {
  row: ChangeSetRow;
  workflow: ApprovalWorkflow;
  stage: ApprovalStage;
  fingerprint: string;
  outdated: boolean;
  signers: ReturnType<typeof approversAt>;
};

/** The locked set in review, its current stage, who approved there, and whether the review is outdated. */
const loadReview = async (
  trx: Transaction<DB>,
  context: ChangeSetServiceContext,
  id: string,
  verb: string,
  decision: 'approve' | 'request_changes',
): Promise<ReviewState> => {
  const row = await lockFor(trx, context, id, ALLOWED.sign, verb);
  const current = currentStageOf(row);
  if (!current) {
    throw notInReview(row.approval_status);
  }
  const fingerprint = await loadFingerprint(row, trx);
  const outdated = isReviewOutdated(row, fingerprint);
  const signoffs = await changeSetApprovalsRepository.listCurrentRound([id], trx);
  const signers = approversAt(signoffs, id, row.approval_round, row.approval_stage);
  const knownRoles = await loadKnownRoles(current.stage.roleIds, trx);
  const reason = ineligibleReason({
    principal: context.actor,
    stage: current.stage,
    selfApproval: current.workflow.selfApproval,
    knownRoleIds: new Set(knownRoles.keys()),
    creator: { adminUserId: row.created_by, apiTokenId: row.created_by_token },
    requester: { adminUserId: row.approval_requested_by, apiTokenId: row.approval_requested_by_token },
    signers,
    outdated,
    decision,
  });
  if (reason === 'outdated') {
    throw changeSetApprovalStale();
  }
  if (reason !== null) {
    throw notEligible(reason);
  }
  return { row, ...current, fingerprint, outdated, signers };
};

const insertSignoff = (
  trx: Transaction<DB>,
  context: ChangeSetServiceContext,
  review: ReviewState,
  decision: 'approve' | 'request_changes',
  note: string,
) => {
  const signer = signerOf(context.actor);
  return changeSetApprovalsRepository.insert(
    {
      change_set_id: review.row.id,
      site_id: context.site.id,
      round: review.row.approval_round,
      stage_index: review.row.approval_stage,
      stage_id: review.stage.id,
      decision,
      note,
      admin_user_id: signer.adminUserId,
      api_token_id: signer.apiTokenId,
      fingerprint: review.fingerprint,
    },
    trx,
  );
};

/**
 * Signs off at the current stage. When the stage has its required approvers it completes and the review moves
 * to the next stage; after the last one the set is approved.
 */
export const approveChangeSet = async (
  context: ChangeSetServiceContext,
  id: string,
  input: { note?: string },
): Promise<ChangeSetView> => {
  const note = input.note ?? '';
  await context.db.transaction().execute(async (trx) => {
    const review = await loadReview(trx, context, id, 'approved', 'approve');
    const { row, workflow, stage } = review;
    const index = row.approval_stage;
    await insertSignoff(trx, context, review, 'approve', note);
    const signed = review.signers.length + 1;
    const base = { title: row.title, round: row.approval_round, stage: stage.name, stageIndex: index };
    await auditChangeSet(trx, context, id, 'change_set.approval_sign', {
      ...base,
      signed,
      required: stage.required,
      ...(note ? { note } : {}),
    });
    const step = nextReviewStep({
      stageIndex: index,
      stageCount: workflow.stages.length,
      signed,
      required: stage.required,
    });
    await write(trx, id, {
      approval_fingerprint: review.fingerprint,
      ...(step.kind === 'approved' ? { approval_status: 'approved' } : {}),
      ...(step.kind === 'nextStage' ? { approval_stage: step.stageIndex } : {}),
    });
    if (step.kind === 'waiting') {
      return;
    }
    const eventBase = { round: row.approval_round, stage: stageRef(stage, index), note };
    await auditChangeSet(trx, context, id, 'change_set.approval_stage_complete', base);
    await emit(trx, context, row, CHANGE_SET_EVENTS.approvalStageCompleted, eventBase);
    if (step.kind === 'approved') {
      await auditChangeSet(trx, context, id, 'change_set.approve', {
        title: row.title,
        round: row.approval_round,
      });
      await emit(trx, context, row, CHANGE_SET_EVENTS.approved, eventBase);
    }
  });
  return getChangeSet(context, id);
};

/** Sends the set back with what to change: the round ends at whatever stage it was. */
export const requestChanges = async (
  context: ChangeSetServiceContext,
  id: string,
  input: { note: string },
): Promise<ChangeSetView> => {
  await context.db.transaction().execute(async (trx) => {
    const review = await loadReview(trx, context, id, 'sent back', 'request_changes');
    const { row, stage } = review;
    await insertSignoff(trx, context, review, 'request_changes', input.note);
    await write(trx, id, { approval_status: 'changes_requested', approval_note: input.note });
    await auditChangeSet(trx, context, id, 'change_set.approval_request_changes', {
      title: row.title,
      round: row.approval_round,
      stage: stage.name,
      stageIndex: row.approval_stage,
      note: input.note,
    });
    await emit(trx, context, row, CHANGE_SET_EVENTS.changesRequested, {
      note: input.note,
      round: row.approval_round,
      stage: stageRef(stage, row.approval_stage),
    });
  });
  return getChangeSet(context, id);
};

/** Back to no approval; the sign-offs stay as history and the next request starts a new round. */
export const clearApproval = async (context: ChangeSetServiceContext, id: string): Promise<ChangeSetView> => {
  await context.db.transaction().execute(async (trx) => {
    const row = await lockFor(trx, context, id, ALLOWED.clear, 'cleared of its approval');
    await write(trx, id, {
      approval_status: 'none',
      approval_note: '',
      approval_requested_by: null,
      approval_requested_by_token: null,
      approval_requested_at: null,
      approval_fingerprint: null,
    });
    await auditChangeSet(trx, context, id, 'change_set.approval_clear', { title: row.title });
  });
  return getChangeSet(context, id);
};

/**
 * The gate: when the set's site has an effective workflow, a set ships or is scheduled only while approved
 * with a matching fingerprint. Checked by `planShip`, so interactive, scheduled and job-run ships (and
 * scheduling, which plans the ship) all check it. A site that turned approval off no longer requires it,
 * even for sets still in review under their frozen workflow.
 */
export const assertShipApproved = async (row: ChangeSetRow, executor: Executor): Promise<void> => {
  if (!(await siteRequiresApproval(row.site_id, executor))) {
    return;
  }
  if (row.approval_status !== 'approved') {
    throw changeSetNotApproved();
  }
  if (!(await isApprovalCurrent(row, executor))) {
    throw changeSetApprovalStale();
  }
};

/** Whether the set's site requires approval (it has an effective workflow). */
export const siteRequiresApproval = async (siteId: string, executor: Executor): Promise<boolean> =>
  (await effectiveWorkflow(siteId, executor)) !== null;
