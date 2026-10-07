import type { ContentIssue } from '@shapio/client';
import {
  BIGINTEGER_PATTERN,
  DATE_PATTERN,
  DATETIME_PATTERN,
  DECIMAL_PATTERN,
  SLUG_PATTERN,
  TIME_PATTERN,
  UID_PATTERN,
  type FieldDefinition,
} from '@shapio/schema';
import { isEmptyValue, toList } from './values';

/**
 * Checks the admin runs while someone types, so obvious mistakes show before saving. The server is the
 * enforcement layer (CONTRIBUTING.md rule 5) and runs the full validator on every save; these only mirror the
 * cheap, local rules (format, length, range, counts). `required` is left to the server, which skips it on
 * autosave by design.
 */
type ClientIssue = Pick<ContentIssue, 'code' | 'message'>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_PATTERN = /^(https?:\/\/[^\s]+|mailto:[^\s]+|tel:[^\s]+)$/i;

const PATTERNS: Partial<Record<FieldDefinition['type'], RegExp>> = {
  email: EMAIL_PATTERN,
  url: URL_PATTERN,
  slug: SLUG_PATTERN,
  uid: UID_PATTERN,
  date: DATE_PATTERN,
  datetime: DATETIME_PATTERN,
  time: TIME_PATTERN,
  decimal: DECIMAL_PATTERN,
  biginteger: BIGINTEGER_PATTERN,
};

const issue = (code: string): ClientIssue => ({ code, message: code });

const checkLength = (text: string, settings: { minLength?: number; maxLength?: number }): ClientIssue[] => [
  ...(settings.minLength !== undefined && text.length < settings.minLength ? [issue('TOO_SHORT')] : []),
  ...(settings.maxLength !== undefined && text.length > settings.maxLength ? [issue('TOO_LONG')] : []),
];

const checkRange = (value: number, settings: { min?: number | string; max?: number | string }) => [
  ...(settings.min !== undefined && value < Number(settings.min) ? [issue('TOO_SMALL')] : []),
  ...(settings.max !== undefined && value > Number(settings.max) ? [issue('TOO_LARGE')] : []),
];

const checkCount = (count: number, settings: { min?: number; max?: number }) => [
  ...(settings.min !== undefined && count > 0 && count < settings.min ? [issue('TOO_FEW')] : []),
  ...(settings.max !== undefined && count > settings.max ? [issue('TOO_MANY')] : []),
];

const parsesAsJson = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

/** Code is never changed or trimmed; with `validate` on (JSON only) it must parse. */
const checkCode = (text: string, settings: { language: string; validate?: boolean | undefined }) =>
  settings.validate === true && settings.language === 'json' && !parsesAsJson(text)
    ? [issue('INVALID_FORMAT')]
    : [];

const checkText = (field: FieldDefinition, text: string): ClientIssue[] => {
  const pattern = PATTERNS[field.type];
  if (pattern && !pattern.test(text)) {
    return [issue('INVALID_FORMAT')];
  }
  switch (field.type) {
    case 'string':
    case 'text':
    case 'slug':
    case 'uid':
      return checkLength(text, field.settings);
    case 'code':
      return [...checkCode(text, field.settings), ...checkLength(text, field.settings)];
    case 'decimal':
    case 'biginteger':
      return checkRange(Number(text), field.settings);
    case 'enum':
      return field.settings.values.some((option) => option.value === text) ? [] : [issue('NOT_ALLOWED')];
    default:
      return [];
  }
};

export const clientIssuesOf = (field: FieldDefinition, value: unknown): ClientIssue[] => {
  if (isEmptyValue(value)) {
    return [];
  }
  switch (field.type) {
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return [issue('INVALID_TYPE')];
      }
      return field.type === 'integer' && !Number.isInteger(value)
        ? [issue('INVALID_TYPE')]
        : checkRange(value, field.settings);
    case 'media':
    case 'relation':
    case 'component':
    case 'dynamiczone':
      return checkCount(toList(value).length, field.settings);
    default:
      return typeof value === 'string' ? checkText(field, value) : [];
  }
};
