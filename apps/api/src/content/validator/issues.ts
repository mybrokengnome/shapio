import { AppError } from '../../helpers/appError.js';

export type IssueCode =
  | 'REQUIRED'
  | 'INVALID_TYPE'
  | 'INVALID_FORMAT'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'TOO_SMALL'
  | 'TOO_LARGE'
  | 'TOO_FEW'
  | 'TOO_MANY'
  | 'NOT_ALLOWED'
  | 'PATTERN_MISMATCH'
  | 'DUPLICATE'
  | 'UNKNOWN_FIELD'
  | 'UNKNOWN_COMPONENT'
  | 'INVALID_RICHTEXT'
  | 'NOT_UNIQUE'
  | 'RELATION_TARGET_MISSING'
  | 'MEDIA_MISSING'
  | 'INVALID_TEXT'
  // Item IDs (plan item-ids): a written list's items and the stored items they continue.
  | 'UNKNOWN_ITEM_ID'
  | 'DUPLICATE_ITEM_ID'
  | 'ITEM_COMPONENT_CHANGED'
  | 'AMBIGUOUS_ITEMS';

/** One problem with a content value. `path` is a JSON pointer in API keys, e.g. `/sections/0/title`. */
export type ContentIssue = { path: string; code: IssueCode; message: string };

/**
 * The most issues one refusal lists: a body can name a problem per item, and a refusal must never be larger than
 * the body that caused it. Past it, the details say how many there were (`issueCount`) and that the list was cut.
 */
export const MAX_REPORTED_ISSUES = 100;

/** An issue list as a refusal reports it: at most `MAX_REPORTED_ISSUES`, with the count when cut. */
export const reportedIssues = (issues: readonly ContentIssue[]) =>
  issues.length > MAX_REPORTED_ISSUES
    ? { issues: issues.slice(0, MAX_REPORTED_ISSUES), issueCount: issues.length, truncated: true }
    : { issues };

export const contentInvalid = (issues: readonly ContentIssue[]) =>
  new AppError(422, 'CONTENT_INVALID', 'The entry is invalid.', reportedIssues(issues));

/** JSON pointer escaping (RFC 6901). API keys never need it, but indexes and component keys are appended. */
export const pointer = (base: string, segment: string | number) =>
  `${base}/${String(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`;
