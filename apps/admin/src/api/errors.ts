import { ShapioApiError } from '@shapio/client';

export const isUnauthorized = (error: unknown) => error instanceof ShapioApiError && error.status === 401;

/**
 * A 403 whose body is not Shapio's error shape (`{ error: { code, message } }`): something in front of the
 * server, a firewall or a proxy, refused the request before Shapio saw it. The client names such errors
 * `HTTP_<status>`; Shapio's own 403s always carry a code of their own.
 */
export const isBlockedRequest = (error: unknown) =>
  error instanceof ShapioApiError && error.status === 403 && error.code === 'HTTP_403';

/** Whether a raw response body is Shapio's error shape, `{ error: { code, message } }`. */
export const isShapioErrorText = (text: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  const error: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'error') : null;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof Reflect.get(error, 'code') === 'string' &&
    typeof Reflect.get(error, 'message') === 'string'
  );
};

/** Shapio refused the request: the admin's roles don't grant it (a blocked request is not that). */
export const isForbidden = (error: unknown) =>
  error instanceof ShapioApiError && error.status === 403 && !isBlockedRequest(error);

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
