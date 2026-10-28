import type { Database } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import * as sitesRepository from '../repositories/sites.js';
import type { ApprovalWorkflowInput } from '../routes/schemas/approvalWorkflow.js';
import type { SiteActorContext } from './actorContext.js';
import {
  assertAdminRoles,
  effectiveOf,
  findUnknownRoleIds,
  normalizeWorkflow,
  readInstanceDefault,
  toSiteSetting,
  type ApprovalMode,
  type ApprovalWorkflow,
} from './approvalWorkflows.js';
import { recordAudit } from './audit.js';

/**
 * A site's change set settings (plan approval-workflows): its approval mode (inherit the instance default,
 * off, or its own workflow), the custom workflow, and what applies. Any admin of the site reads it (the
 * change set screen explains a disabled Ship); changing it needs `site.settings` (the route checks it).
 */
export type SiteChangeSetsContext = SiteActorContext & { db: Database };

export type SiteChangeSetsView = {
  version: number;
  mode: ApprovalMode;
  /** The site's own workflow (kept while another mode is chosen, so switching back restores it). */
  workflow: ApprovalWorkflow | null;
  /** The instance default this site would inherit. */
  inherited: ApprovalWorkflow | null;
  /** What applies now: null means change sets ship without approval. */
  effective: ApprovalWorkflow | null;
  /** Role IDs these workflows name that are no longer admin roles. */
  unknownRoleIds: string[];
};

const siteNotFound = () => new AppError(404, 'SITE_NOT_FOUND', 'Site not found');

const loadView = async (siteId: string, executor: Database): Promise<SiteChangeSetsView> => {
  const row = await sitesRepository.findApprovalSetting(siteId, executor);
  if (!row) {
    throw siteNotFound();
  }
  const site = toSiteSetting(row);
  const inherited = (await readInstanceDefault(executor)).workflow;
  return {
    version: site.version,
    mode: site.mode,
    workflow: site.workflow,
    inherited,
    effective: effectiveOf(site, inherited),
    unknownRoleIds: await findUnknownRoleIds([site.workflow, inherited], executor),
  };
};

export const getSiteChangeSets = (context: SiteChangeSetsContext): Promise<SiteChangeSetsView> =>
  loadView(context.site.id, context.db);

/**
 * Optimistic: fails with VERSION_CONFLICT when the site changed since `expectedVersion` was read. Without a
 * `workflow` the stored one is kept; `custom` needs one.
 */
export const updateSiteChangeSets = async (
  context: SiteChangeSetsContext,
  input: { expectedVersion: number; mode: ApprovalMode; workflow?: ApprovalWorkflowInput | undefined },
): Promise<SiteChangeSetsView> =>
  context.db.transaction().execute(async (trx) => {
    const current = await sitesRepository.findApprovalSetting(context.site.id, trx);
    if (!current) {
      throw siteNotFound();
    }
    const workflow = input.workflow ? normalizeWorkflow(input.workflow) : toSiteSetting(current).workflow;
    if (input.mode === 'custom' && workflow === null) {
      throw new AppError(400, 'APPROVAL_WORKFLOW_REQUIRED', 'A site with its own approval needs a workflow');
    }
    if (input.workflow) {
      await assertAdminRoles(workflow, trx);
    }
    const updated = await sitesRepository.updateApprovalIfVersion(
      context.site.id,
      input.expectedVersion,
      { mode: input.mode, workflow },
      trx,
    );
    if (!updated) {
      throw new AppError(409, 'VERSION_CONFLICT', 'The site changed since you loaded it', {
        expectedVersion: input.expectedVersion,
        actualVersion: current.version,
      });
    }
    await recordAudit(trx, {
      ...context,
      action: 'site.change_sets_update',
      target: { type: 'site', id: context.site.id },
      metadata: { mode: input.mode, stages: workflow?.stages.length ?? 0 },
    });
    return loadView(context.site.id, trx);
  });
