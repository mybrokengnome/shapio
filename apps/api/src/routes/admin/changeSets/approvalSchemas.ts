import { Type, type Static } from 'typebox';
import { NullableDateTimeSchema } from '../../schemas/adminIdentity.js';
import { Nullable, NullableString } from '../../schemas/publishing.js';

/**
 * Approval on change sets (plan approval): the `approval` block of every set view, and the bodies of
 * `/api/admin/change-sets/:id/approval/...`. These schemas are the contract the admin builds against.
 */
export const APPROVAL_STATUSES = ['none', 'requested', 'approved', 'changes_requested'] as const;
export const ApprovalStatusSchema = Type.Enum(APPROVAL_STATUSES);

const ApprovalActorSchema = Type.Object({
  type: Type.Enum(['admin', 'token', 'system']),
  id: NullableString,
  name: NullableString,
});

export const ChangeSetApprovalSchema = Type.Object({
  status: ApprovalStatusSchema,
  /** The note of the last transition (a request, an approval, or what to change). */
  note: Type.String(),
  requestedBy: Nullable(ApprovalActorSchema),
  requestedAt: NullableDateTimeSchema,
  /** Who decided (approved, or requested changes), and when. */
  approvedBy: Nullable(ApprovalActorSchema),
  approvedAt: NullableDateTimeSchema,
  /** Approved, but the set changed since (an item, a draft or a schema draft): it must be approved again. */
  outdated: Type.Boolean(),
  /** Whether the approval was current when the set shipped; null until it ships. */
  approvedAtShip: Nullable(Type.Boolean()),
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
