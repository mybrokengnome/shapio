import { z } from 'zod';

/**
 * The token form's schema version (plan schema-lenses): empty means no pin (always the current schema); a
 * whole number pins the token. The server checks the upper bound (the current schema version).
 */
export const pinnedSchemaVersionField = () =>
  z
    .string()
    .trim()
    .regex(/^(?:[1-9]\d{0,9})?$/, 'validation.schemaVersion');

/** The value sent to the API: null for no pin. */
export const toPinnedSchemaVersion = (value: string): number | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : Number(trimmed);
};

/** The form value of a token's pin: empty for none. */
export const fromPinnedSchemaVersion = (version: number | null): string =>
  version === null ? '' : String(version);

/**
 * What the token list says about a token's schema version: its pin, unless the client sends a version of its
 * own (which wins); null when it is on today's shape.
 */
export const schemaVersionNoteOf = (
  pinnedSchemaVersion: number | null,
  sentVersion: number | undefined,
): { kind: 'pinned' | 'sends'; version: number } | null => {
  if (sentVersion !== undefined && sentVersion !== pinnedSchemaVersion) {
    return { kind: 'sends', version: sentVersion };
  }
  return pinnedSchemaVersion === null ? null : { kind: 'pinned', version: pinnedSchemaVersion };
};
