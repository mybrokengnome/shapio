/**
 * Approval workflows (plan approval-workflows): the stages a change set goes through before it may ship, the
 * instance default every site inherits, and a site's own choice. Mirrors
 * apps/api/src/routes/schemas/approvalWorkflow.ts and the site and network route schemas.
 */
export type ApprovalStage = {
  /** Stable; assigned by the server when a stage is saved without one. */
  id: string;
  name: string;
  /** Admin role IDs; empty: anyone who may approve on the site. */
  roleIds: string[];
  /** Distinct sign-offs the stage needs (1 to 20). */
  required: number;
};

export type ApprovalWorkflow = {
  /** One to ten stages, in order. */
  stages: ApprovalStage[];
  /** Whether the set's creator or requester may sign off. */
  selfApproval: boolean;
};

/** A workflow as sent: new stages have no ID yet; `selfApproval` defaults to false. */
export type ApprovalWorkflowInput = {
  stages: Array<Omit<ApprovalStage, 'id'> & { id?: string }>;
  selfApproval?: boolean;
};

export const APPROVAL_MODES = ['inherit', 'off', 'custom'] as const;
/** A site inherits the instance default, switches approval off, or keeps its own workflow. */
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

/** `GET /api/admin/site/change-sets`: the request's site's approval settings. */
export type SiteChangeSets = {
  /** The site version an update must name. */
  version: number;
  mode: ApprovalMode;
  /** The site's own workflow, kept while another mode is chosen. */
  workflow: ApprovalWorkflow | null;
  /** The instance default this site would inherit. */
  inherited: ApprovalWorkflow | null;
  /** What applies now; null: change sets ship without approval. */
  effective: ApprovalWorkflow | null;
  /** Role IDs these workflows name that are no longer admin roles. */
  unknownRoleIds: string[];
};

/** `PUT /api/admin/site/change-sets` (`site.settings`): without `workflow` the stored one is kept. */
export type UpdateSiteChangeSetsInput = {
  expectedVersion: number;
  mode: ApprovalMode;
  workflow?: ApprovalWorkflowInput;
};

/** `GET /api/admin/network/approval` (`sites.manage`): the instance default and the sites that follow it. */
export type NetworkApproval = {
  /** The version an update must name (0: never saved). */
  version: number;
  /** Null: approval is off by default. */
  workflow: ApprovalWorkflow | null;
  unknownRoleIds: string[];
  sites: {
    inheriting: number;
    custom: Array<{ id: string; name: string }>;
    off: Array<{ id: string; name: string }>;
  };
};

export type UpdateNetworkApprovalInput = { expectedVersion: number; workflow: ApprovalWorkflowInput | null };
