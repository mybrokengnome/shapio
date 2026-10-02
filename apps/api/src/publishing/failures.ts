import { AppError } from '../helpers/appError.js';

/**
 * Whether a failed publication should stop for good (invalid content, missing entry, no permission) or be
 * retried (the model was activated meanwhile, database trouble).
 */
export const isPermanentPublicationError = (error: unknown): boolean =>
  error instanceof AppError && error.statusCode < 500 && error.code !== 'SCHEMA_CHANGED';

/** Thrown inside a publishing transaction when the schedule or release was already handled. */
export class AlreadyHandledError extends Error {
  constructor(readonly status: string) {
    super(`Already handled (${status})`);
    this.name = 'AlreadyHandledError';
  }
}

/** A failure as an admin should read it: the error, plus each content issue (`/title: Required (en)`). */
export const describePublicationError = (error: unknown): string => {
  const root =
    error instanceof Error && error.name === 'PublicationItemError' && error.cause ? error.cause : error;
  const issues =
    root instanceof AppError ? (root.details as { issues?: unknown } | undefined)?.issues : undefined;
  const base = root instanceof Error ? root.message : String(root);
  if (!Array.isArray(issues) || issues.length === 0) {
    return base;
  }
  const listed = issues
    .slice(0, 10)
    .map((issue: { path?: string; message?: string }) => `${issue.path ?? ''}: ${issue.message ?? ''}`.trim())
    .join('; ');
  return `${base} ${listed}`;
};
