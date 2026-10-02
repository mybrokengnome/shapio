import { ShapioApiError, type ContentIssue, type EntryReferrer } from '@shapio/client';
import { isRecord } from './values';

/** The issues of a 422 CONTENT_INVALID answer (empty for any other error). */
export const contentIssuesOf = (error: unknown): ContentIssue[] => {
  if (!(error instanceof ShapioApiError) || error.code !== 'CONTENT_INVALID' || !isRecord(error.details)) {
    return [];
  }
  const issues = error.details.issues;
  return Array.isArray(issues)
    ? issues.filter(
        (issue): issue is ContentIssue =>
          isRecord(issue) && typeof issue.path === 'string' && typeof issue.code === 'string',
      )
    : [];
};

/** The entries still pointing at one being deleted (409 ENTRY_REFERENCED). */
export const referrersOf = (error: unknown): EntryReferrer[] => {
  if (!(error instanceof ShapioApiError) || error.code !== 'ENTRY_REFERENCED' || !isRecord(error.details)) {
    return [];
  }
  const referrers = error.details.referrers;
  return Array.isArray(referrers) ? referrers.filter((item): item is EntryReferrer => isRecord(item)) : [];
};

/** A save that lost a race: the draft moved (another session) or the model changed while saving. */
export const isEditConflict = (error: unknown): error is ShapioApiError =>
  error instanceof ShapioApiError &&
  error.status === 409 &&
  (error.code === 'CONTENT_VERSION_CONFLICT' || error.code === 'SCHEMA_CHANGED');
