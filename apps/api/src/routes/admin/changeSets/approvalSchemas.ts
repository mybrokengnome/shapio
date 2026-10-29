import { Type, type Static } from 'typebox';
import { DateTimeSchema, NullableDateTimeSchema } from '../../schemas/adminIdentity.js';
import { ApprovalStageSchema } from '../../schemas/approvalWorkflow.js';
import { Nullable, NullableString } from '../../schemas/publishing.js';

/**
 * Approval workflows on change sets (plan approval-workflows): the `approval` block of set views, and the
 * bodies of `/api/admin/change-sets/:id/approval/...`. These schemas are the contract the admin builds against.
 */
export const APPROVAL_STATUSES = ['none', 'requested', 'approved', 'changes_requested'] as const;
export const ApprovalStatusSchema = Type.Enum(APPROVAL_STATUSES);

/** Why the caller may not approve now (`signed` and `outdated` still allow requesting changes). */
export const INELIGIBLE_REASONS = ['rolesDeleted', 'role', 'self', 'signed', 'outdated'] as const;

const ApprovalActorSchema = Type.Object({
  type: Type.Enum(['admin', 'token', 'system']),
  id: NullableString,
  name: NullableString,
});

const ApprovalStageStateSchema = Type.Object({
  index: Type.Integer(),
  id: Type.String(),
  name: Type.String(),
  required: Type.Integer(),
  /** Distinct approvers so far in this round. */
  signed: Type.Integer(),
});

const summaryFields = {
  status: ApprovalStatusSchema,
  /** The request's note, or what to change once changes were requested. */
  note: Type.String(),
  /** The review round (each request starts a new one); 0 before the first request. */
  round: Type.Integer(),
  requestedBy: Nullable(ApprovalActorSchema),
  requestedAt: NullableDateTimeSchema,
  /**
   * The set changed after this round's first sign-off (in review) or after it was approved: nobody can sign
   * and it cannot ship until approval is asked for again.
   */
  outdated: Type.Boolean(),
  /** Whether the approval was current when the set shipped; null until it ships. */
  approvedAtShip: Nullable(Type.Boolean()),
  /** The caller may approve at the current stage now. */
  eligible: Type.Boolean(),
  /** Why not, while the set is in review; null when eligible or not in review. */
  eligibleReason: Nullable(Type.Enum(INELIGIBLE_REASONS)),
  /** The current stage while the set is in review. */
  stage: Nullable(ApprovalStageStateSchema),
};

/** The approval summary on list rows. */
export const ChangeSetApprovalSummarySchema = Type.Object(summaryFields);

const SignoffSchema = Type.Object({
  round: Type.Integer(),
  stageIndex: Type.Integer(),
  stageId: Type.String(),
  /** The stage's name in the frozen workflow (null when an older round's workflow had other stages). */
  stageName: NullableString,
  decision: Type.Enum(['approve', 'request_changes']),
  by: ApprovalActorSchema,
  at: DateTimeSchema,
  note: Type.String(),
  /** It counts: given in the current round, and the set has not changed since. */
  current: Type.Boolean(),
});

/** The approval block of one set: the summary, the frozen workflow and every sign-off. */
export const ChangeSetApprovalSchema = Type.Object({
  ...summaryFields,
  /** The workflow frozen when review started (null before the first request). */
  workflow: Nullable(
    Type.Object({
      stages: Type.Array(
        Type.Object({
          ...ApprovalStageSchema.properties,
          /** Names of the roles that still exist. */
          roleNames: Type.Array(Type.String()),
        }),
      ),
      selfApproval: Type.Boolean(),
    }),
  ),
  signoffs: Type.Array(SignoffSchema),
  /** The last sign-off of the final stage, once approved. */
  approvedBy: Nullable(ApprovalActorSchema),
  approvedAt: NullableDateTimeSchema,
});

const NoteSchema = Type.String({ maxLength: 2000 });

export const ApprovalNoteBodySchema = Type.Object(
  { note: Type.Optional(NoteSchema) },
  { additionalProperties: false },
);
export type ApprovalNoteBody = Static<typeof ApprovalNoteBodySchema>;

export const RequestChangesBodySchema = Type.Object(
  { note: Type.String({ minLength: 1, maxLength: 2000 }) },
  { additionalProperties: false },
);
export type RequestChangesBody = Static<typeof RequestChangesBodySchema>;
