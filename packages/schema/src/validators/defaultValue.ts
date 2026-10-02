import type { FieldDefinition } from '../types/definitions.js';
import {
  BIGINTEGER_PATTERN,
  DATE_PATTERN,
  DATETIME_PATTERN,
  DECIMAL_PATTERN,
  SLUG_PATTERN,
  TIME_PATTERN,
  UID_PATTERN,
} from '../types/valueFormats.js';

/**
 * Checks that a field's `defaultValue` has the right JSON shape for its type. Full content rules
 * (lengths, ranges) are applied by the content validator when the default is used.
 * Returns a message, or null when the default is acceptable.
 */
export const checkDefaultValue = (field: FieldDefinition): string | null => {
  const value = field.defaultValue;
  if (value === undefined) {
    return null;
  }
  const isString = typeof value === 'string';
  const matches = (pattern: RegExp) => isString && pattern.test(value);
  switch (field.type) {
    case 'string':
    case 'text':
    case 'email':
    case 'url':
      return isString ? null : 'must be a string';
    case 'slug':
      return matches(SLUG_PATTERN) ? null : 'must be a lower-case slug';
    case 'uid':
      return matches(UID_PATTERN) ? null : 'must contain only URL-safe characters';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'must be a number';
    case 'integer':
      return Number.isSafeInteger(value) ? null : 'must be an integer';
    case 'decimal':
      return matches(DECIMAL_PATTERN) ? null : 'must be a decimal string, e.g. "12.50"';
    case 'biginteger':
      return matches(BIGINTEGER_PATTERN) ? null : 'must be an integer string, e.g. "9007199254740993"';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'date':
      return matches(DATE_PATTERN) ? null : 'must be a date, YYYY-MM-DD';
    case 'datetime':
      return matches(DATETIME_PATTERN) ? null : 'must be a UTC date-time, YYYY-MM-DDTHH:mm:ssZ';
    case 'time':
      return matches(TIME_PATTERN) ? null : 'must be a time, HH:mm[:ss]';
    case 'enum': {
      const allowed = new Set(field.settings.values.map((entry) => entry.value));
      if (field.settings.multiple) {
        return Array.isArray(value) && value.every((item) => typeof item === 'string' && allowed.has(item))
          ? null
          : 'must be a list of the enum values';
      }
      return isString && allowed.has(value) ? null : 'must be one of the enum values';
    }
    case 'json':
      return null;
    default:
      return `${field.type} fields cannot have a default value`;
  }
};
