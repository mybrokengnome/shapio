import { Type } from 'typebox';
import { ErrorResponseSchema } from '../../schemas/error.js';

export const EnsureOutcomeSchema = Type.Object({
  /** `created` when this call created it (a new schema version), `existing` when it was already there. */
  status: Type.Enum(['existing', 'created']),
  definitionId: Type.String(),
  version: Type.Integer(),
  schemaVersion: Type.Integer(),
});

export const ensureSeoComponentSchema = {
  response: {
    200: EnsureOutcomeSchema,
    201: EnsureOutcomeSchema,
    403: ErrorResponseSchema,
    409: ErrorResponseSchema,
    422: ErrorResponseSchema,
  },
};
