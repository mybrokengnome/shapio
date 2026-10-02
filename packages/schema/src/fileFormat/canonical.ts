import type { SchemaDefinition } from '../types/definitions.js';

/**
 * Canonical JSON: object keys sorted by code point at every level, arrays in their given order (field
 * order is meaningful: it is the form order), two-space indentation and a trailing newline. Two equal
 * definitions always serialize to the same bytes, so files diff cleanly in git and hashes are stable.
 */
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === 'object' && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) {
        sorted[key] = sortKeys(entry);
      }
    }
    return sorted;
  }
  return value;
};

export const canonicalJson = (value: unknown): string => `${JSON.stringify(sortKeys(value), null, 2)}\n`;

/**
 * The bytes Shapio hashes and writes for a definition. The definition must be normalized
 * (`normalizeDefinition`), so defaults are explicit and the same meaning has one spelling.
 */
export const serializeDefinition = (definition: SchemaDefinition): string => canonicalJson(definition);
