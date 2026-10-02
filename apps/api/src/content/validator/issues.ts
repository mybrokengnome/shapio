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
  | 'MEDIA_MISSING';

/** One problem with a content value. `path` is a JSON pointer in API keys, e.g. `/sections/0/title`. */
export type ContentIssue = { path: string; code: IssueCode; message: string };

export const contentInvalid = (issues: readonly ContentIssue[]) =>
  new AppError(422, 'CONTENT_INVALID', 'The entry is invalid.', { issues });

/** JSON pointer escaping (RFC 6901). API keys never need it, but indexes and component keys are appended. */
export const pointer = (base: string, segment: string | number) =>
  `${base}/${String(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`;
