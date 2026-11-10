import type { ValidationIssue } from '@shapio/schema';
import type { ContentIssue } from '../content/validator/issues.js';
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

/** What a change needs acknowledged: each one is a request parameter of the same name. */
export type AcknowledgementNeeds = { breaking: boolean; destructive: boolean };

const acknowledgementMessage = ({ breaking, destructive }: AcknowledgementNeeds) => {
  if (breaking && destructive) {
    return 'This change breaks the API contract and destroys data. Review the plan and resend with acknowledgeBreaking and acknowledgeDestructive set.';
  }
  return breaking
    ? 'This change breaks the API contract. Review the plan and resend with acknowledgeBreaking set.'
    : 'This change destroys data. Review the plan and resend with acknowledgeDestructive set.';
};

/** The message names only the parameters the change needs, so it never asks for one a route does not take. */
export const acknowledgementRequired = (plan: unknown, needs: AcknowledgementNeeds) =>
  new AppError(409, 'SCHEMA_CHANGE_NOT_ACKNOWLEDGED', acknowledgementMessage(needs), { plan });

export const schemaReadOnly = (reason: string | null) =>
  new AppError(
    423,
    'SCHEMA_READ_ONLY',
    'Schema changes from the admin UI are locked on this instance; use `shapio schema apply`.',
    { reason },
  );

/** Deleting a type others extend (plan polymorphic-types): its kinds would lose their parent. */
export const definitionHasChildren = (apiKey: string, children: readonly { id: string; apiKey: string }[]) =>
  new AppError(
    409,
    'HAS_CHILDREN',
    `"${apiKey}" has kinds that extend it (${children.map((child) => child.apiKey).join(', ')}). Delete them or move them under another type first.`,
    { children },
  );

/**
 * Localization and drafts must be the same across a family (plan polymorphic-types D3), so a parent's flag
 * cannot change alone: the parent and its kinds change together, in one change set.
 */
export const familyFlagChange = (
  apiKey: string,
  flags: readonly string[],
  children: readonly { id: string; apiKey: string }[],
) =>
  new AppError(
    409,
    'FAMILY_FLAG_CHANGE',
    `"${apiKey}" has kinds that extend it (${children.map((child) => child.apiKey).join(', ')}), and a type and its kinds share ${flags.map((flag) => `"${flag}"`).join(' and ')}. Change "${apiKey}" and its kinds together in one change set.`,
    { flags, children },
  );

/** A scope change of a type that extends another: the family moves together, from its root. */
export const scopeOfChildType = (apiKey: string, rootApiKey: string) =>
  new AppError(
    409,
    'SCOPE_OF_CHILD_TYPE',
    `"${apiKey}" extends "${rootApiKey}" and is available where it is. Change the scope of "${rootApiKey}" instead; its kinds move with it.`,
    { rootApiKey },
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

/** Schema lenses (plan schema-lenses): a client names the schema version it was built against. */
export const schemaVersionInvalid = (value: string) =>
  new AppError(
    400,
    'SCHEMA_VERSION_INVALID',
    'The schema version must look like "<schemaId>:<version>", as `shapio types generate` writes it.',
    { value },
  );

export const schemaVersionAhead = (requested: number, current: number) =>
  new AppError(
    400,
    'SCHEMA_VERSION_AHEAD',
    `Schema version ${requested} is newer than this instance's current version ${current}.`,
    { requested, current },
  );

export const schemaVersionForeign = () =>
  new AppError(
    400,
    'SCHEMA_VERSION_FOREIGN',
    'The schema version was issued by another Shapio instance. Generate your types against this instance.',
  );

export const schemaVersionUnavailable = (modelKey: string, oldestVersion: number) =>
  new AppError(
    409,
    'SCHEMA_VERSION_UNAVAILABLE',
    `This instance has no record of "${modelKey}" at that schema version. The oldest version it can serve for it is ${oldestVersion}.`,
    { modelKey, oldestVersion },
  );

export const lensQueryUnsupported = (apiKey: string) =>
  new AppError(
    400,
    'LENS_QUERY_UNSUPPORTED',
    `"${apiKey}" changed or was removed since your schema version, so it cannot be filtered or sorted on. Update your client to the current schema version.`,
    { apiKey },
  );

export const lensUncovered = (modelKey: string) =>
  new AppError(
    409,
    'LENS_UNCOVERED',
    `"${modelKey}" changed in a way an older schema version cannot show (it switched between a collection and a single entry). Update your client to the current schema version.`,
    { modelKey },
  );

/**
 * Every field of a write through a schema lens that cannot be written in the client's shape, with JSON pointers
 * in the client's API IDs and how each changed since its version.
 */
export const lensWriteIssues = (issues: readonly ContentIssue[]) =>
  new AppError(
    422,
    'LENS_WRITE_UNSUPPORTED',
    "Some fields changed since this client's schema version and cannot be written through it. Update the client to the current schema version to change them.",
    { issues },
  );
