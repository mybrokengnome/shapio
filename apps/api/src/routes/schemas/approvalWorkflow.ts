import { Type, type Static } from 'typebox';
import { UuidSchema } from './adminIdentity.js';

/**
 * An approval workflow (plan approval-workflows): an ordered list of stages, each naming the roles that may
 * sign off (none: anyone with `changes.approve` on the site) and how many sign-offs it needs, and whether the
 * set's creator or requester may sign off. One schema for the instance default, a site's custom workflow and
 * the copy frozen on a change set; services check stored copies against it too.
 */
export const APPROVAL_WORKFLOW_LIMITS = {
  stages: 10,
  required: 20,
  stageName: 100,
  rolesPerStage: 50,
} as const;

const StageIdSchema = Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' });

const stageFields = {
  name: Type.String({ minLength: 1, maxLength: APPROVAL_WORKFLOW_LIMITS.stageName, pattern: '\\S' }),
  /** Admin role IDs; empty: anyone who may approve on the site. */
  roleIds: Type.Array(UuidSchema, { maxItems: APPROVAL_WORKFLOW_LIMITS.rolesPerStage, uniqueItems: true }),
  required: Type.Integer({ minimum: 1, maximum: APPROVAL_WORKFLOW_LIMITS.required }),
};

export const ApprovalStageSchema = Type.Object(
  { id: StageIdSchema, ...stageFields },
  { additionalProperties: false },
);
export type ApprovalStage = Static<typeof ApprovalStageSchema>;

export const ApprovalWorkflowSchema = Type.Object(
  {
    stages: Type.Array(ApprovalStageSchema, { minItems: 1, maxItems: APPROVAL_WORKFLOW_LIMITS.stages }),
    /** Whether the set's creator or this round's requester may sign off. */
    selfApproval: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ApprovalWorkflow = Static<typeof ApprovalWorkflowSchema>;

/** A workflow as a client sends it: a new stage has no ID yet (the server assigns one). */
export const ApprovalWorkflowInputSchema = Type.Object(
  {
    stages: Type.Array(
      Type.Object({ id: Type.Optional(StageIdSchema), ...stageFields }, { additionalProperties: false }),
      { minItems: 1, maxItems: APPROVAL_WORKFLOW_LIMITS.stages },
    ),
    selfApproval: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type ApprovalWorkflowInput = Static<typeof ApprovalWorkflowInputSchema>;

export const APPROVAL_MODES = ['inherit', 'off', 'custom'] as const;
export const ApprovalModeSchema = Type.Enum(APPROVAL_MODES);
export type ApprovalMode = (typeof APPROVAL_MODES)[number];
