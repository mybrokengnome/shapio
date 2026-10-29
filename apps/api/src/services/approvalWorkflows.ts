import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import { Value } from 'typebox/value';
import { APPROVAL_WORKFLOW_SETTING } from '../constants/approval.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import type { Principal } from '../permissions/types.js';
import * as adminRolesRepository from '../repositories/adminRoles.js';
import * as sitesRepository from '../repositories/sites.js';
import * as systemSettingsRepository from '../repositories/systemSettings.js';
import {
  APPROVAL_MODES,
  ApprovalWorkflowSchema,
  type ApprovalMode,
  type ApprovalStage,
  type ApprovalWorkflow,
  type ApprovalWorkflowInput,
} from '../routes/schemas/approvalWorkflow.js';

/**
 * Approval workflows (plan approval-workflows): where they live, which one applies to a site, and who may sign
 * off at a stage. The instance default is a `system_settings` row (JSON `{ version, workflow }`, written with a
 * compare-and-swap on the exact text read); a site inherits it, switches approval off, or keeps its own.
 * Stored workflows are checked against the schema when read: an invalid one fails closed (an error, never
 * "no approval").
 */
type Executor = Kysely<DB> | Transaction<DB>;

export type { ApprovalMode, ApprovalStage, ApprovalWorkflow };

const corrupt = (where: string) =>
  new AppError(500, 'APPROVAL_WORKFLOW_CORRUPT', `The stored approval workflow of ${where} is not valid`, {
    where,
  });

/** A stored workflow (JSON column, or parsed setting): null stays null, anything invalid is an error. */
export const parseStoredWorkflow = (value: unknown, where: string): ApprovalWorkflow | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === 'string' ? safeJson(value, where) : value;
  if (!Value.Check(ApprovalWorkflowSchema, parsed)) {
    throw corrupt(where);
  }
  return parsed;
};

const safeJson = (text: string, where: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw corrupt(where);
  }
};

const invalid = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(400, code, message, details);

/** A workflow as sent, made whole: new stages get an ID, names are trimmed, IDs must be unique. */
export const normalizeWorkflow = (input: ApprovalWorkflowInput): ApprovalWorkflow => {
  const stages = input.stages.map((stage) => ({
    id: stage.id ?? randomUUID(),
    name: stage.name.trim(),
    roleIds: [...stage.roleIds],
    required: stage.required,
  }));
  const ids = stages.map((stage) => stage.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate !== undefined) {
    throw invalid('APPROVAL_WORKFLOW_INVALID', 'Two stages have the same ID', { stageId: duplicate });
  }
  return { stages, selfApproval: input.selfApproval ?? false };
};

export const roleIdsOfWorkflow = (workflow: ApprovalWorkflow | null): string[] =>
  workflow ? [...new Set(workflow.stages.flatMap((stage) => stage.roleIds))] : [];

/**
 * Locks the roles a workflow names and refuses any that is not an admin role (unknown, deleted, or a delivery
 * role). Locking serializes the write with a role deletion, which refuses roles a workflow names.
 */
export const assertAdminRoles = async (workflow: ApprovalWorkflow | null, trx: Transaction<DB>) => {
  const roleIds = roleIdsOfWorkflow(workflow);
  const found = await adminRolesRepository.lockByIds(roleIds, trx);
  const admin = new Set(found.filter((role) => role.kind === 'admin').map((role) => role.id));
  const unknown = roleIds.filter((id) => !admin.has(id));
  if (unknown.length > 0) {
    throw invalid('APPROVAL_UNKNOWN_ROLE', 'A stage names a role that is not an admin role', {
      roleIds: unknown,
    });
  }
};

/** Role IDs the workflows name that are no longer admin roles (the settings pages flag them). */
export const findUnknownRoleIds = async (
  workflows: ReadonlyArray<ApprovalWorkflow | null>,
  executor: Executor,
): Promise<string[]> => {
  const roleIds = [...new Set(workflows.flatMap(roleIdsOfWorkflow))];
  const admin = new Set(
    (await adminRolesRepository.findByIds(roleIds, executor))
      .filter((role) => role.kind === 'admin')
      .map((role) => role.id),
  );
  return roleIds.filter((id) => !admin.has(id)).sort();
};

// The instance default ------------------------------------------------------------------------------

/** The instance default is on (`custom`, its workflow applies to inheriting sites) or `off` (kept, unused). */
export const INSTANCE_MODES = ['off', 'custom'] as const;
export type InstanceMode = (typeof INSTANCE_MODES)[number];

export type InstanceDefault = {
  version: number;
  mode: InstanceMode;
  /** The stored workflow, kept while the default is off. */
  workflow: ApprovalWorkflow | null;
  /** The exact stored text (the compare-and-swap's expected value); undefined when never saved. */
  stored: string | undefined;
};

export const readInstanceDefault = async (executor: Executor): Promise<InstanceDefault> => {
  const stored = await systemSettingsRepository.findValue(APPROVAL_WORKFLOW_SETTING, executor);
  if (stored === undefined) {
    return { version: 0, mode: 'off', workflow: null, stored };
  }
  const record = safeJson(stored, 'the instance') as {
    version?: unknown;
    mode?: unknown;
    workflow?: unknown;
  } | null;
  if (
    !record ||
    typeof record !== 'object' ||
    typeof record.version !== 'number' ||
    !(INSTANCE_MODES as readonly unknown[]).includes(record.mode)
  ) {
    throw corrupt('the instance');
  }
  const workflow = parseStoredWorkflow(record.workflow, 'the instance');
  if (record.mode === 'custom' && workflow === null) {
    throw corrupt('the instance');
  }
  return { version: record.version, mode: record.mode as InstanceMode, workflow, stored };
};

/** The workflow inheriting sites follow: the stored one while the default is on, else none. */
export const instanceEffective = (instance: Pick<InstanceDefault, 'mode' | 'workflow'>) =>
  instance.mode === 'custom' ? instance.workflow : null;

/** The instance default's effective workflow (what `inherit` means right now). */
export const readInstanceWorkflow = async (executor: Executor): Promise<ApprovalWorkflow | null> =>
  instanceEffective(await readInstanceDefault(executor));

/**
 * Writes the instance default when it is still at `expectedVersion` (0: never saved). False when another
 * write got there first; the caller reports a version conflict.
 */
export const writeInstanceDefault = async (
  current: InstanceDefault,
  next: { mode: InstanceMode; workflow: ApprovalWorkflow | null },
  trx: Transaction<DB>,
): Promise<number | null> => {
  const version = current.version + 1;
  const value = JSON.stringify({ version, mode: next.mode, workflow: next.workflow });
  const written =
    current.stored === undefined
      ? await systemSettingsRepository.insertIfAbsent(APPROVAL_WORKFLOW_SETTING, value, trx)
      : await systemSettingsRepository.replaceValueIfEquals(
          APPROVAL_WORKFLOW_SETTING,
          current.stored,
          value,
          trx,
        );
  return written ? version : null;
};

// A site's workflow ---------------------------------------------------------------------------------

export type SiteApprovalSetting = {
  id: string;
  name: string;
  version: number;
  mode: ApprovalMode;
  workflow: ApprovalWorkflow | null;
};

type SiteApprovalRow = NonNullable<Awaited<ReturnType<typeof sitesRepository.findApprovalSetting>>>;

export const toSiteSetting = (row: SiteApprovalRow): SiteApprovalSetting => {
  if (!(APPROVAL_MODES as readonly string[]).includes(row.approval_mode)) {
    throw corrupt(`site ${row.id}`);
  }
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    mode: row.approval_mode as ApprovalMode,
    workflow: parseStoredWorkflow(row.approval_workflow, `site ${row.id}`),
  };
};

/** The workflow a site's mode selects, given the instance default. */
export const effectiveOf = (
  site: Pick<SiteApprovalSetting, 'mode' | 'workflow'>,
  instance: ApprovalWorkflow | null,
): ApprovalWorkflow | null => {
  switch (site.mode) {
    case 'custom':
      return site.workflow;
    case 'off':
      return null;
    case 'inherit':
      return instance;
  }
};

/** The site's effective workflow: its own (`custom`), the instance default (`inherit`), or none (`off`). */
export const effectiveWorkflow = async (
  siteId: string,
  executor: Executor,
): Promise<ApprovalWorkflow | null> => {
  const row = await sitesRepository.findApprovalSetting(siteId, executor);
  if (!row) {
    return null;
  }
  const site = toSiteSetting(row);
  if (site.mode !== 'inherit') {
    return effectiveOf(site, null);
  }
  return readInstanceWorkflow(executor);
};

/**
 * Where a role is named by a workflow in use: the instance default while it is on, and the sites with their own
 * workflow (role deletion). A dormant workflow does not block deletion; switching it back on re-checks roles.
 */
export const workflowsNamingRole = async (roleId: string, executor: Executor) => {
  const instance = await readInstanceWorkflow(executor);
  const sites = (await sitesRepository.listApprovalSettings(executor))
    .map(toSiteSetting)
    .filter((site) => site.mode === 'custom' && roleIdsOfWorkflow(site.workflow).includes(roleId));
  return {
    instanceDefault: roleIdsOfWorkflow(instance).includes(roleId),
    sites: sites.map((site) => ({ id: site.id, name: site.name })),
  };
};

// Eligibility ---------------------------------------------------------------------------------------

/** An actor as sign-off rows record it: an admin user or an admin API token. */
export type SignerRef = { adminUserId: string | null; apiTokenId: string | null };

export const signerOf = (principal: Principal): SignerRef => ({
  adminUserId: principal.kind === 'admin' ? principal.adminUserId : null,
  apiTokenId: principal.kind === 'token' && principal.scope === 'admin' ? principal.tokenId : null,
});

export const sameSigner = (a: SignerRef, b: SignerRef) =>
  (a.adminUserId !== null && a.adminUserId === b.adminUserId) ||
  (a.apiTokenId !== null && a.apiTokenId === b.apiTokenId);

/** The roles a principal holds on the request's site (admins: site and every-site roles; tokens: their one). */
const rolesOnSite = (principal: Principal): readonly string[] => {
  switch (principal.kind) {
    case 'admin':
      return principal.roleIds;
    case 'token':
      return principal.scope === 'admin' ? [principal.roleId] : [];
    default:
      return [];
  }
};

/**
 * Why a principal may not sign off now: `rolesDeleted` (every role the stage names is gone: nobody can sign,
 * fail closed), `role`, `self`, `signed` (approve only), or `outdated` (approve only; the set changed since
 * the round's sign-offs). Null: eligible.
 */
export type IneligibleReason = 'rolesDeleted' | 'role' | 'self' | 'signed' | 'outdated';

export type EligibilityInput = {
  principal: Principal;
  stage: ApprovalStage;
  selfApproval: boolean;
  /** The admin roles that still exist (to tell a deleted role from one the principal lacks). */
  knownRoleIds: ReadonlySet<string>;
  /** The set's creator and this round's requester. */
  creator: SignerRef;
  requester: SignerRef;
  /** Who approved at this round and stage so far. */
  signers: readonly SignerRef[];
  outdated: boolean;
  decision: 'approve' | 'request_changes';
};

export const ineligibleReason = (input: EligibilityInput): IneligibleReason | null => {
  const named = input.stage.roleIds.filter((id) => input.knownRoleIds.has(id));
  if (input.stage.roleIds.length > 0 && named.length === 0) {
    return 'rolesDeleted';
  }
  const held = new Set(rolesOnSite(input.principal));
  if (named.length > 0 && !named.some((id) => held.has(id))) {
    return 'role';
  }
  const me = signerOf(input.principal);
  if (!input.selfApproval && (sameSigner(me, input.creator) || sameSigner(me, input.requester))) {
    return 'self';
  }
  if (input.decision === 'request_changes') {
    return null;
  }
  if (input.signers.some((signer) => sameSigner(me, signer))) {
    return 'signed';
  }
  return input.outdated ? 'outdated' : null;
};

/** What a new sign-off does to the review: nothing yet, the next stage, or approval (the last stage). */
export type ReviewStep =
  { kind: 'waiting' } | { kind: 'nextStage'; stageIndex: number } | { kind: 'approved' };

export const nextReviewStep = (input: {
  stageIndex: number;
  stageCount: number;
  /** Distinct approvers at the stage, the new one included. */
  signed: number;
  required: number;
}): ReviewStep => {
  if (input.signed < input.required) {
    return { kind: 'waiting' };
  }
  return input.stageIndex >= input.stageCount - 1
    ? { kind: 'approved' }
    : { kind: 'nextStage', stageIndex: input.stageIndex + 1 };
};
