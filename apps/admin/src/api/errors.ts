import { ShapioApiError } from '@shapio/client';

export const isUnauthorized = (error: unknown) => error instanceof ShapioApiError && error.status === 401;

export const isForbidden = (error: unknown) => error instanceof ShapioApiError && error.status === 403;

export const isNotFound = (error: unknown) => error instanceof ShapioApiError && error.status === 404;

export const isConflict = (error: unknown) => error instanceof ShapioApiError && error.status === 409;

export const hasErrorCode = (error: unknown, code: string) =>
  error instanceof ShapioApiError && error.code === code;

/** A schema validation issue; `siteKey` names the site whose view it was found in (every-site admins only). */
export type SchemaIssue = { path: string; code: string; message: string; siteKey?: string };

/** Validation issues (JSON-pointer paths) the schema routes return with 422 SCHEMA_INVALID. */
export const schemaIssuesOf = (error: unknown): SchemaIssue[] => {
  if (!hasErrorCode(error, 'SCHEMA_INVALID')) {
    return [];
  }
  const issues = (error as ShapioApiError & { details: { issues?: unknown } }).details?.issues;
  return Array.isArray(issues) ? (issues as SchemaIssue[]) : [];
};
