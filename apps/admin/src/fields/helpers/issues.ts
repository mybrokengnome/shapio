import type { ContentIssue } from '@shapio/client';
import type { FieldDefinition } from '@shapio/schema';
import { i18next } from '@/app/i18n';

/**
 * Validation issues (the server's 422 CONTENT_INVALID `details.issues`, and the admin's own client-side
 * checks) keyed by JSON pointer in API keys, e.g. `/sections/0/title`, the same paths the form uses.
 */
export type IssueMap = ReadonlyMap<string, readonly ContentIssue[]>;

/** RFC 6901 pointer segment. API keys never need escaping, but component keys and indexes are appended. */
export const pointerOf = (base: string, segment: string | number) =>
  `${base}/${String(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`;

export const issuesByPath = (issues: readonly ContentIssue[]): IssueMap => {
  const map = new Map<string, ContentIssue[]>();
  for (const issue of issues) {
    map.set(issue.path, [...(map.get(issue.path) ?? []), issue]);
  }
  return map;
};

/** How many issues sit at or below a path (shown on collapsed items and section links). */
export const countIssuesUnder = (issues: IssueMap, path: string): number => {
  let count = 0;
  for (const [key, list] of issues) {
    if (key === path || key.startsWith(`${path}/`)) {
      count += list.length;
    }
  }
  return count;
};

const FORMAT_KEYS = {
  email: 'content.issues.format.email',
  url: 'content.issues.format.url',
  slug: 'content.issues.format.slug',
  uid: 'content.issues.format.uid',
  date: 'content.issues.format.date',
  datetime: 'content.issues.format.datetime',
  time: 'content.issues.format.time',
  decimal: 'content.issues.format.decimal',
  biginteger: 'content.issues.format.biginteger',
  code: 'content.issues.format.code',
} as const;

type CountKey =
  | 'content.issues.tooShort'
  | 'content.issues.tooLong'
  | 'content.issues.tooSmall'
  | 'content.issues.tooLarge'
  | 'content.issues.tooFew'
  | 'content.issues.tooMany';

const hasFormatKey = (type: string): type is keyof typeof FORMAT_KEYS => Object.hasOwn(FORMAT_KEYS, type);

const setting = (field: FieldDefinition | undefined, key: string): string | number | undefined => {
  const value = (field?.settings as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'number' || typeof value === 'string' ? value : undefined;
};

/** A translated message for an issue. Without the numbers a message needs, the server's text is used. */
export const describeIssue = (
  issue: Pick<ContentIssue, 'code' | 'message'>,
  field?: FieldDefinition,
): string => {
  const t = i18next.t.bind(i18next);
  const withCount = (key: CountKey, settingKey: string) => {
    const count = setting(field, settingKey);
    return count === undefined ? issue.message : t(key, { count: Number(count), value: String(count) });
  };
  switch (issue.code) {
    case 'REQUIRED':
      return t('content.issues.required');
    case 'INVALID_TYPE':
      return t('content.issues.invalidType');
    case 'INVALID_FORMAT':
      return field && hasFormatKey(field.type)
        ? t(FORMAT_KEYS[field.type])
        : t('content.issues.invalidFormat');
    case 'TOO_SHORT':
      return withCount('content.issues.tooShort', 'minLength');
    case 'TOO_LONG':
      return withCount('content.issues.tooLong', 'maxLength');
    case 'TOO_SMALL':
      return withCount('content.issues.tooSmall', 'min');
    case 'TOO_LARGE':
      return withCount('content.issues.tooLarge', 'max');
    case 'TOO_FEW':
      return withCount('content.issues.tooFew', 'min');
    case 'TOO_MANY':
      return withCount('content.issues.tooMany', 'max');
    case 'NOT_ALLOWED':
      return t('content.issues.notAllowed');
    case 'PATTERN_MISMATCH':
      return t('content.issues.patternMismatch');
    case 'DUPLICATE':
      return t('content.issues.duplicate');
    case 'UNKNOWN_FIELD':
      return t('content.issues.unknownField');
    case 'UNKNOWN_COMPONENT':
      return t('content.issues.unknownComponent');
    case 'INVALID_RICHTEXT':
      return t('content.issues.invalidRichText');
    case 'NOT_UNIQUE':
      return t('content.issues.notUnique');
    case 'RELATION_TARGET_MISSING':
      return t('content.issues.relationMissing');
    case 'MEDIA_MISSING':
      return t('content.issues.mediaMissing');
    case 'INVALID_JSON':
      return t('content.issues.invalidJson');
    default:
      return issue.message;
  }
};
