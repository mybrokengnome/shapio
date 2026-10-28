import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/index.js';
import type { DB } from '../db/types.js';
import type { PermissionEvaluator, Principal } from '../permissions/types.js';
import * as adminRolesRepository from '../repositories/adminRoles.js';
import * as changeSetApprovalsRepository from '../repositories/changeSetApprovals.js';
import type { ChangeSetApprovalRow } from '../repositories/changeSetApprovals.js';
import * as changeSetsRepository from '../repositories/changeSets.js';
import type { ApprovalStatus, ChangeSetRow } from '../repositories/changeSets.js';
import {
  ineligibleReason,
  parseStoredWorkflow,
  roleIdsOfWorkflow,
  type ApprovalStage,
  type ApprovalWorkflow,
  type IneligibleReason,
  type SignerRef,
} from './approvalWorkflows.js';
import { actorOfIds, type ChangeSetActorView } from './changeSetActors.js';
import { findOutdated } from './changeSetFingerprint.js';

/**
 * The `approval` block of change set views (plan approval-workflows): where the review stands, whether the
 * caller may sign off now and why not, and on a single set the frozen workflow and every sign-off.
 */
type Executor = Kysely<DB> | Transaction<DB>;

export type ApprovalStageView = { index: number; id: string; name: string; required: number; signed: number };

export type ChangeSetApprovalSummaryView = {
  status: ApprovalStatus;
  /** The request's note, or what to change after changes were requested. */
  note: string;
  round: number;
  requestedBy: ChangeSetActorView | null;
  requestedAt: Date | null;
  outdated: boolean;
  approvedAtShip: boolean | null;
  /** The caller may approve now. */
  eligible: boolean;
  /** Why not, while the set is in review (null when eligible or not in review). */
  eligibleReason: IneligibleReason | null;
  /** The current stage while the set is in review. */
  stage: ApprovalStageView | null;
};

export type ApprovalSignoffView = {
  round: number;
  stageIndex: number;
  stageId: string;
  stageName: string | null;
  decision: 'approve' | 'request_changes';
  by: ChangeSetActorView;
  at: Date;
  note: string;
  /** It counts: given in the review's current round, and the set has not changed since. */
  current: boolean;
};

export type ApprovalWorkflowView = {
  stages: Array<ApprovalStage & { roleNames: string[] }>;
  selfApproval: boolean;
};

export type ChangeSetApprovalView = ChangeSetApprovalSummaryView & {
  workflow: ApprovalWorkflowView | null;
  signoffs: ApprovalSignoffView[];
  /** The last sign-off of the final stage, once approved. */
  approvedBy: ChangeSetActorView | null;
  approvedAt: Date | null;
};

export type ApprovalViewContext = { db: Database; actor: Principal; permissions: PermissionEvaluator };

const signerOfRow = (row: Pick<ChangeSetApprovalRow, 'admin_user_id' | 'api_token_id'>): SignerRef => ({
  adminUserId: row.admin_user_id,
  apiTokenId: row.api_token_id,
});

const frozenWorkflowOf = (row: ChangeSetRow): ApprovalWorkflow | null =>
  parseStoredWorkflow(row.approval_workflow, `change set ${row.id}`);

/** The stage a set in review is at (null when it is not in review). */
export const currentStageOf = (
  row: ChangeSetRow,
): { workflow: ApprovalWorkflow; stage: ApprovalStage } | null => {
  if (row.approval_status !== 'requested') {
    return null;
  }
  const workflow = frozenWorkflowOf(row);
  const stage = workflow?.stages[row.approval_stage];
  return workflow && stage ? { workflow, stage } : null;
};

/** Distinct approvers of one round and stage. */
export const approversAt = (
  signoffs: readonly ChangeSetApprovalRow[],
  changeSetId: string,
  round: number,
  stageIndex: number,
): SignerRef[] => {
  const seen = new Set<string>();
  return signoffs
    .filter(
      (row) =>
        row.change_set_id === changeSetId &&
        row.round === round &&
        row.stage_index === stageIndex &&
        row.decision === 'approve',
    )
    .map(signerOfRow)
    .filter((signer) => {
      const key = `${signer.adminUserId ?? ''}:${signer.apiTokenId ?? ''}`;
      return seen.has(key) ? false : (seen.add(key), true);
    });
};

/** The admin roles that still exist among `roleIds`, with their names. */
export const loadKnownRoles = async (roleIds: readonly string[], database: Executor) =>
  new Map(
    (await adminRolesRepository.findByIds([...new Set(roleIds)], database))
      .filter((role) => role.kind === 'admin')
      .map((role) => [role.id, role.name]),
  );

/** Whether the caller holds both actions approving needs on the request's site (the routes check them too). */
const mayApprove = async (context: ApprovalViewContext) =>
  (await context.permissions.canPerform(context.actor, 'changes.manage')) &&
  (await context.permissions.canPerform(context.actor, 'changes.approve'));

type SummaryInputs = {
  outdated: ReadonlySet<string>;
  signoffs: readonly ChangeSetApprovalRow[];
  knownRoles: ReadonlyMap<string, string>;
  names: ReadonlyMap<string, string>;
  canApprove: boolean;
  actor: Principal;
};

const summaryOf = (row: ChangeSetRow, inputs: SummaryInputs): ChangeSetApprovalSummaryView => {
  const current = currentStageOf(row);
  const outdated = inputs.outdated.has(row.id);
  const signers = current ? approversAt(inputs.signoffs, row.id, row.approval_round, row.approval_stage) : [];
  const reason = current
    ? inputs.canApprove
      ? ineligibleReason({
          principal: inputs.actor,
          stage: current.stage,
          selfApproval: current.workflow.selfApproval,
          knownRoleIds: new Set(inputs.knownRoles.keys()),
          creator: { adminUserId: row.created_by, apiTokenId: row.created_by_token },
          requester: { adminUserId: row.approval_requested_by, apiTokenId: row.approval_requested_by_token },
          signers,
          outdated,
          decision: 'approve',
        })
      : 'role'
    : null;
  return {
    status: row.approval_status as ApprovalStatus,
    note: row.approval_note,
    round: row.approval_round,
    requestedBy:
      row.approval_requested_at === null
        ? null
        : actorOfIds(row.approval_requested_by, row.approval_requested_by_token, inputs.names),
    requestedAt: row.approval_requested_at,
    outdated,
    approvedAtShip: row.approved_at_ship,
    eligible: current !== null && reason === null,
    eligibleReason: reason,
    stage: current
      ? {
          index: row.approval_stage,
          id: current.stage.id,
          name: current.stage.name,
          required: current.stage.required,
          signed: signers.length,
        }
      : null,
  };
};

/**
 * The approval summary of each set of a page, in a fixed number of queries: fingerprints of pinned sets, the
 * current round's sign-offs of sets in review, and the roles their current stages name.
 */
export const loadApprovalSummaries = async (
  context: ApprovalViewContext,
  rows: readonly ChangeSetRow[],
  names: ReadonlyMap<string, string>,
): Promise<Map<string, ChangeSetApprovalSummaryView>> => {
  const inReview = rows.filter((row) => row.approval_status === 'requested');
  const outdated = await findOutdated(rows, context.db);
  const signoffs = await changeSetApprovalsRepository.listCurrentRound(
    inReview.map((row) => row.id),
    context.db,
  );
  const knownRoles = await loadKnownRoles(
    inReview.flatMap((row) => currentStageOf(row)?.stage.roleIds ?? []),
    context.db,
  );
  const canApprove = inReview.length > 0 && (await mayApprove(context));
  const inputs = { outdated, signoffs, knownRoles, names, canApprove, actor: context.actor };
  return new Map(rows.map((row) => [row.id, summaryOf(row, inputs)]));
};

/** The full approval block of one set: its summary, the frozen workflow and every sign-off. */
export const loadApprovalView = async (
  context: ApprovalViewContext,
  row: ChangeSetRow,
  names: ReadonlyMap<string, string>,
): Promise<ChangeSetApprovalView> => {
  const workflow = frozenWorkflowOf(row);
  const signoffs = await changeSetApprovalsRepository.listForSet(row.id, context.db);
  const signerNames = await changeSetsRepository.findActorNames(
    {
      adminIds: [...new Set(signoffs.flatMap((s) => (s.admin_user_id ? [s.admin_user_id] : [])))],
      tokenIds: [...new Set(signoffs.flatMap((s) => (s.api_token_id ? [s.api_token_id] : [])))],
    },
    context.db,
  );
  const knownRoles = await loadKnownRoles(roleIdsOfWorkflow(workflow), context.db);
  const outdated = await findOutdated([row], context.db);
  const canApprove = row.approval_status === 'requested' && (await mayApprove(context));
  const summary = summaryOf(row, {
    outdated,
    signoffs: signoffs.filter((signoff) => signoff.round === row.approval_round),
    knownRoles,
    names,
    canApprove,
    actor: context.actor,
  });
  // A sign-off counts while its round is the set's review (in review or approved) and the set is unchanged.
  const counts =
    (row.approval_status === 'requested' || row.approval_status === 'approved') && !outdated.has(row.id);
  const stageName = (id: string) => workflow?.stages.find((stage) => stage.id === id)?.name ?? null;
  const signoffViews = signoffs.map((signoff): ApprovalSignoffView => ({
    round: signoff.round,
    stageIndex: signoff.stage_index,
    stageId: signoff.stage_id,
    stageName: stageName(signoff.stage_id),
    decision: signoff.decision as ApprovalSignoffView['decision'],
    by: actorOfIds(signoff.admin_user_id, signoff.api_token_id, signerNames),
    at: signoff.created_at,
    note: signoff.note,
    current: counts && signoff.round === row.approval_round,
  }));
  const lastStage = workflow ? workflow.stages.length - 1 : -1;
  const approval =
    row.approval_status === 'approved'
      ? signoffViews.findLast(
          (signoff) =>
            signoff.round === row.approval_round &&
            signoff.stageIndex === lastStage &&
            signoff.decision === 'approve',
        )
      : undefined;
  return {
    ...summary,
    workflow: workflow
      ? {
          selfApproval: workflow.selfApproval,
          stages: workflow.stages.map((stage) => ({
            ...stage,
            roleNames: stage.roleIds.flatMap((id) => {
              const name = knownRoles.get(id);
              return name === undefined ? [] : [name];
            }),
          })),
        }
      : null,
    signoffs: signoffViews,
    approvedBy: approval?.by ?? null,
    approvedAt: approval?.at ?? null,
  };
};
