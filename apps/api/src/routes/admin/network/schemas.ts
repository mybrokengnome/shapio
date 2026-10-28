import { Type, type Static } from 'typebox';
import { UuidSchema } from '../../schemas/adminIdentity.js';
import { ApprovalWorkflowInputSchema, ApprovalWorkflowSchema } from '../../schemas/approvalWorkflow.js';
import { ErrorResponseSchema } from '../../schemas/error.js';
import { Nullable } from '../../schemas/publishing.js';

/** The instance's default approval workflow (plan approval-workflows) and the sites that follow it. */
const SiteRefSchema = Type.Object({ id: UuidSchema, name: Type.String() });

export const NetworkApprovalSchema = Type.Object({
  /** The version an update must name (0: never saved). */
  version: Type.Integer(),
  /** Null: approval is off by default. */
  workflow: Nullable(ApprovalWorkflowSchema),
  unknownRoleIds: Type.Array(Type.String()),
  sites: Type.Object({
    /** How many sites inherit the default. */
    inheriting: Type.Integer(),
    /** Sites with their own workflow. */
    custom: Type.Array(SiteRefSchema),
    /** Sites with approval off. */
    off: Type.Array(SiteRefSchema),
  }),
});

const errors = {
  400: ErrorResponseSchema,
  403: ErrorResponseSchema,
  409: ErrorResponseSchema,
};

export const getNetworkApprovalSchema = { response: { 200: NetworkApprovalSchema, ...errors } };

export const UpdateNetworkApprovalBodySchema = Type.Object(
  { expectedVersion: Type.Integer({ minimum: 0 }), workflow: Nullable(ApprovalWorkflowInputSchema) },
  { additionalProperties: false },
);
export type UpdateNetworkApprovalBody = Static<typeof UpdateNetworkApprovalBodySchema>;

export const updateNetworkApprovalSchema = {
  body: UpdateNetworkApprovalBodySchema,
  response: { 200: NetworkApprovalSchema, ...errors },
};
