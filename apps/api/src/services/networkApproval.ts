import { APPROVAL_WORKFLOW_SETTING } from '../constants/approval.js';
import type { Database } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import * as sitesRepository from '../repositories/sites.js';
import type { ApprovalWorkflowInput } from '../routes/schemas/approvalWorkflow.js';
import type { ActorContext } from './actorContext.js';
import {
  assertAdminRoles,
  findUnknownRoleIds,
  normalizeWorkflow,
  readInstanceDefault,
  toSiteSetting,
  writeInstanceDefault,
  type ApprovalWorkflow,
  type InstanceMode,
} from './approvalWorkflows.js';
import { recordAudit } from './audit.js';

/**
 * The instance's default approval workflow (plan approval-workflows): every site with mode `inherit` follows
 * it; null means approval is off by default. A network setting: the route needs `sites.manage`.
 */
export type NetworkApprovalContext = ActorContext & { db: Database };

type SiteRef = { id: string; name: string };

export type NetworkApprovalView = {
  version: number;
  /** `custom`: inheriting sites follow the workflow; `off`: they ship without approval. */
  mode: InstanceMode;
  /** The stored workflow, kept while the default is off (so switching back restores it). */
  workflow: ApprovalWorkflow | null;
  unknownRoleIds: string[];
  /** How many sites inherit the default, and which have their own workflow or approval off. */
  sites: { inheriting: number; custom: SiteRef[]; off: SiteRef[] };
};

const loadView = async (executor: Database): Promise<NetworkApprovalView> => {
  const instance = await readInstanceDefault(executor);
  const sites = (await sitesRepository.listApprovalSettings(executor)).map(toSiteSetting);
  const refs = (mode: string) =>
    sites.filter((site) => site.mode === mode).map((site) => ({ id: site.id, name: site.name }));
  return {
    version: instance.version,
    mode: instance.mode,
    workflow: instance.workflow,
    unknownRoleIds: await findUnknownRoleIds([instance.workflow], executor),
    sites: {
      inheriting: sites.filter((site) => site.mode === 'inherit').length,
      custom: refs('custom'),
      off: refs('off'),
    },
  };
};

export const getNetworkApproval = (context: NetworkApprovalContext): Promise<NetworkApprovalView> =>
  loadView(context.db);

/**
 * Optimistic: VERSION_CONFLICT when the default changed since `expectedVersion` (0: never saved) was read.
 * Without a `workflow` the stored one is kept; `custom` needs one. Turning the default on re-checks its roles
 * (a role may have been deleted while it was off).
 */
export const updateNetworkApproval = async (
  context: NetworkApprovalContext,
  input: { expectedVersion: number; mode: InstanceMode; workflow?: ApprovalWorkflowInput | undefined },
): Promise<NetworkApprovalView> =>
  context.db.transaction().execute(async (trx) => {
    const current = await readInstanceDefault(trx);
    const workflow = input.workflow ? normalizeWorkflow(input.workflow) : current.workflow;
    if (input.mode === 'custom' && workflow === null) {
      throw new AppError(400, 'APPROVAL_WORKFLOW_REQUIRED', 'A default approval workflow needs stages');
    }
    if (input.workflow || input.mode === 'custom') {
      await assertAdminRoles(workflow, trx);
    }
    const conflict = () =>
      new AppError(409, 'VERSION_CONFLICT', 'The default approval workflow changed since you loaded it', {
        expectedVersion: input.expectedVersion,
        actualVersion: current.version,
      });
    if (current.version !== input.expectedVersion) {
      throw conflict();
    }
    if ((await writeInstanceDefault(current, { mode: input.mode, workflow }, trx)) === null) {
      throw conflict();
    }
    await recordAudit(trx, {
      ...context,
      action: 'network.approval_update',
      target: { type: 'system_setting', id: APPROVAL_WORKFLOW_SETTING },
      metadata: { mode: input.mode, stages: workflow?.stages.length ?? 0 },
    });
    return loadView(trx);
  });
