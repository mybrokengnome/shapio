import {
  BIGINTEGER_PATTERN,
  DATE_PATTERN,
  DECIMAL_PATTERN,
  isStableId,
  SLUG_PATTERN,
  TIME_PATTERN,
  UID_PATTERN,
  type FieldDefinition,
} from '@shapio/schema';
import type { IssueCode } from './issues.js';

/**
 * Value rules for scalar data types (ADR 0001 storage formats). Each returns the canonical stored value or
 * a problem. Canonical forms are what make text sorting and containment equality correct:
 * - datetime: UTC with milliseconds, `YYYY-MM-DDTHH:mm:ss.sssZ` (offsets are converted to UTC);
 * - time: `HH:mm:ss.sss`;
 * - decimal and biginteger: strings (numbers are accepted when they convert exactly).
 */
export type ScalarOutcome = { ok: true; value: unknown } | { ok: false; code: IssueCode; message: string };

const ok = (value: unknown): ScalarOutcome => ({ ok: true, value });
const problem = (code: IssueCode, message: string): ScalarOutcome => ({ ok: false, code, message });

const INPUT_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const DEFAULT_URL_PROTOCOLS = ['http', 'https', 'mailto', 'tel'];

const isRealDate = (text: string) => {
  if (!DATE_PATTERN.test(text)) {
    return false;
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(text);
};

export const canonicalDate = (value: unknown): string | undefined =>
  typeof value === 'string' && isRealDate(value) ? value : undefined;

export const canonicalDatetime = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = INPUT_DATETIME.exec(value);
  if (!match || !isRealDate(`${match[1]}-${match[2]}-${match[3]}`)) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

export const canonicalTime = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) {
    return undefined;
  }
  const [hours, minutes, rest = '00'] = value.split(':') as [string, string, string?];
  const [seconds = '00', millis = '000'] = rest.split('.');
  return `${hours}:${minutes}:${seconds}.${millis.padEnd(3, '0')}`;
};

/** Decimal strings compared exactly (BigInt on a common scale). */
export const compareDecimal = (a: string, b: string): number => {
  const scale = (text: string) => (text.split('.')[1] ?? '').length;
  const digits = Math.max(scale(a), scale(b));
  const toBig = (text: string) => {
    const negative = text.startsWith('-');
    const [whole = '0', fraction = ''] = text.replace('-', '').split('.');
    const big = BigInt(`${whole}${fraction.padEnd(digits, '0')}`);
    return negative ? -big : big;
  };
  const difference = toBig(a) - toBig(b);
  return difference === 0n ? 0 : difference > 0n ? 1 : -1;
};

export const canonicalDecimal = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const text = String(value);
    return DECIMAL_PATTERN.test(text) ? text : undefined;
  }
  return typeof value === 'string' && DECIMAL_PATTERN.test(value) ? value : undefined;
};

export const canonicalBigInteger = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  return typeof value === 'string' && BIGINTEGER_PATTERN.test(value) ? value : undefined;
};

const textLength = (text: string) => Array.from(text).length;

const checkLength = (text: string, settings: { minLength?: number; maxLength?: number }): ScalarOutcome => {
  const length = textLength(text);
  if (settings.minLength !== undefined && length < settings.minLength) {
    return problem('TOO_SHORT', `must be at least ${settings.minLength} characters`);
  }
  if (settings.maxLength !== undefined && length > settings.maxLength) {
    return problem('TOO_LONG', `must be at most ${settings.maxLength} characters`);
  }
  return ok(text);
};

const checkRange = <T>(
  value: T,
  bounds: { min?: T | undefined; max?: T | undefined },
  compare: (a: T, b: T) => number,
): ScalarOutcome => {
  if (bounds.min !== undefined && compare(value, bounds.min) < 0) {
    return problem('TOO_SMALL', `must be at least ${String(bounds.min)}`);
  }
  if (bounds.max !== undefined && compare(value, bounds.max) > 0) {
    return problem('TOO_LARGE', `must be at most ${String(bounds.max)}`);
  }
  return ok(value);
};

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const compareNumber = (a: number, b: number) => a - b;
const compareBig = (a: string, b: string) => {
  const difference = BigInt(a) - BigInt(b);
  return difference === 0n ? 0 : difference > 0n ? 1 : -1;
};

const patternCache = new Map<string, RegExp | null>();
const compilePattern = (source: string): RegExp | null => {
  if (!patternCache.has(source)) {
    try {
      patternCache.set(source, new RegExp(source, 'u'));
    } catch {
      patternCache.set(source, null);
    }
  }
  return patternCache.get(source) ?? null;
};

const decimalDigits = (text: string) => {
  const [whole = '', fraction = ''] = text.replace('-', '').split('.');
  return { precision: whole.replace(/^0+(?=\d)/, '').length + fraction.length, scale: fraction.length };
};

const checkUrl = (value: string, protocols: readonly string[] | undefined): ScalarOutcome => {
  if (!URL.canParse(value)) {
    return problem('INVALID_FORMAT', 'must be an absolute URL');
  }
  const protocol = new URL(value).protocol.replace(/:$/, '');
  return (protocols ?? DEFAULT_URL_PROTOCOLS).includes(protocol)
    ? ok(value)
    : problem('INVALID_FORMAT', `must use one of: ${(protocols ?? DEFAULT_URL_PROTOCOLS).join(', ')}`);
};

const invalidType = (expected: string) => problem('INVALID_TYPE', `must be ${expected}`);

const checkString = (field: FieldDefinition, value: unknown): ScalarOutcome => {
  if (typeof value !== 'string') {
    return invalidType('a string');
  }
  switch (field.type) {
    case 'string': {
      const length = checkLength(value, field.settings);
      if (!length.ok || field.settings.pattern === undefined) {
        return length;
      }
      const pattern = compilePattern(field.settings.pattern);
      return pattern && !pattern.test(value)
        ? problem('PATTERN_MISMATCH', 'does not match the required pattern')
        : ok(value);
    }
    case 'text':
      return checkLength(value, field.settings);
    case 'slug':
      return SLUG_PATTERN.test(value)
        ? checkLength(value, field.settings)
        : problem('INVALID_FORMAT', 'must be lower-case words joined by hyphens');
    case 'uid':
      return UID_PATTERN.test(value)
        ? checkLength(value, field.settings)
        : problem('INVALID_FORMAT', 'may only contain letters, digits and _ . ~ -');
    case 'email':
      return EMAIL.test(value) && value.length <= MAX_EMAIL_LENGTH
        ? ok(value)
        : problem('INVALID_FORMAT', 'must be an email address');
    case 'url':
      return checkUrl(value, field.settings.protocols);
    default:
      return invalidType('a string');
  }
};

/** Checks and canonicalizes one present (non-missing) scalar value. */
export const checkScalar = (field: FieldDefinition, value: unknown): ScalarOutcome => {
  switch (field.type) {
    case 'string':
    case 'text':
    case 'slug':
    case 'uid':
    case 'email':
    case 'url':
      return checkString(field, value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? checkRange(value, field.settings, compareNumber)
        : invalidType('a number');
    case 'integer':
      return Number.isSafeInteger(value)
        ? checkRange(value as number, field.settings, compareNumber)
        : invalidType('an integer');
    case 'decimal': {
      const decimal = canonicalDecimal(value);
      if (decimal === undefined) {
        return invalidType('a decimal string, e.g. "12.50"');
      }
      const { precision, scale } = decimalDigits(decimal);
      if (field.settings.scale !== undefined && scale > field.settings.scale) {
        return problem('INVALID_FORMAT', `must have at most ${field.settings.scale} decimal places`);
      }
      if (field.settings.precision !== undefined && precision > field.settings.precision) {
        return problem('INVALID_FORMAT', `must have at most ${field.settings.precision} digits`);
      }
      return checkRange(decimal, field.settings, compareDecimal);
    }
    case 'biginteger': {
      const big = canonicalBigInteger(value);
      return big === undefined
        ? invalidType('an integer string, e.g. "9007199254740993"')
        : checkRange(big, field.settings, compareBig);
    }
    case 'boolean':
      return typeof value === 'boolean' ? ok(value) : invalidType('true or false');
    case 'date': {
      const date = canonicalDate(value);
      return date === undefined
        ? invalidType('a date, YYYY-MM-DD')
        : checkRange(date, field.settings, compareText);
    }
    case 'datetime': {
      const datetime = canonicalDatetime(value);
      return datetime === undefined
        ? invalidType('an ISO-8601 date-time with a time zone, e.g. 2026-10-01T09:30:00Z')
        : checkRange(
            datetime,
            {
              min: canonicalDatetime(field.settings.min),
              max: canonicalDatetime(field.settings.max),
            },
            compareText,
          );
    }
    case 'time': {
      const time = canonicalTime(value);
      return time === undefined
        ? invalidType('a time, HH:mm[:ss[.sss]]')
        : checkRange(
            time,
            { min: canonicalTime(field.settings.min), max: canonicalTime(field.settings.max) },
            compareText,
          );
    }
    case 'enum': {
      const allowed = new Set(field.settings.values.map((entry) => entry.value));
      if (!field.settings.multiple) {
        return typeof value === 'string' && allowed.has(value)
          ? ok(value)
          : problem('NOT_ALLOWED', 'must be one of the allowed values');
      }
      if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && allowed.has(item))) {
        return problem('NOT_ALLOWED', 'must be a list of the allowed values');
      }
      return new Set(value).size === value.length ? ok(value) : problem('DUPLICATE', 'lists a value twice');
    }
    default:
      return invalidType(field.type);
  }
};

/** A single reference (relation target entry or media asset): a stable ID. */
export const isReferenceId = (value: unknown): value is string => isStableId(value);
