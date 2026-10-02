import type { ValidationIssue } from '@shapio/schema';
import { AppError } from '../helpers/appError.js';

/** Errors the schema services throw; the central error handler renders them. */

export const schemaVersionConflict = (expectedVersion: number | null, currentVersion: number | null) =>
  new AppError(
    409,
    'SCHEMA_VERSION_CONFLICT',
    'The definition changed since you loaded it. Reload, reapply your edit and try again.',
    { expectedVersion, currentVersion },
  );

export const schemaChangeInProgress = (changeId: string) =>
  new AppError(409, 'SCHEMA_CHANGE_IN_PROGRESS', 'Another change to this definition is still running.', {
    changeId,
  });

export const schemaInvalid = (issues: readonly ValidationIssue[]) =>
  new AppError(422, 'SCHEMA_INVALID', 'The definition is invalid.', { issues });

export const schemaChangeUnsupported = (changes: readonly unknown[]) =>
  new AppError(422, 'SCHEMA_CHANGE_UNSUPPORTED', 'Shapio cannot convert existing values for this change.', {
    changes,
  });

export const acknowledgementRequired = (plan: unknown) =>
  new AppError(
    409,
    'SCHEMA_CHANGE_NOT_ACKNOWLEDGED',
    'This change breaks the API contract or destroys data. Review the plan and resend with acknowledgeBreaking (and acknowledgeDestructive) set.',
    { plan },
  );

export const schemaReadOnly = (reason: string | null) =>
  new AppError(
    423,
    'SCHEMA_READ_ONLY',
    'Schema changes from the admin UI are locked on this instance; use `shapio schema apply`.',
    { reason },
  );

export const definitionNotFound = (id: string) =>
  new AppError(404, 'NOT_FOUND', `No definition with ID ${id}`, { id });

export const apiKeyTaken = (apiKey: string) =>
  new AppError(409, 'API_KEY_TAKEN', `Another definition already uses the API ID "${apiKey}".`, { apiKey });

export const prerequisiteFailed = (details: unknown) =>
  new AppError(
    422,
    'SCHEMA_PREREQUISITE_FAILED',
    'Existing content does not satisfy the new definition.',
    details,
  );
