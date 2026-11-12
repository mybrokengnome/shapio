import { describe, expect, it } from 'vitest';
import {
  fromPinnedSchemaVersion,
  pinnedSchemaVersionField,
  schemaVersionNoteOf,
  toPinnedSchemaVersion,
} from './schemaVersionPin';

describe('the token schema version pin', () => {
  it('accepts empty or a whole number from 1 up', () => {
    const field = pinnedSchemaVersionField();
    expect(field.safeParse('').success).toBe(true);
    expect(field.safeParse(' 42 ').success).toBe(true);
    for (const value of ['0', '-1', '1.5', 'abc', '07']) {
      expect(field.safeParse(value).success, value).toBe(false);
    }
  });

  it('maps empty to no pin and back', () => {
    expect(toPinnedSchemaVersion('')).toBeNull();
    expect(toPinnedSchemaVersion(' 42 ')).toBe(42);
    expect(fromPinnedSchemaVersion(null)).toBe('');
    expect(fromPinnedSchemaVersion(42)).toBe('42');
  });

  it('names the pin unless the client sends another version', () => {
    expect(schemaVersionNoteOf(null, undefined)).toBeNull();
    expect(schemaVersionNoteOf(3, undefined)).toEqual({ kind: 'pinned', version: 3 });
    expect(schemaVersionNoteOf(3, 3)).toEqual({ kind: 'pinned', version: 3 });
    expect(schemaVersionNoteOf(3, 5)).toEqual({ kind: 'sends', version: 5 });
    expect(schemaVersionNoteOf(null, 5)).toEqual({ kind: 'sends', version: 5 });
  });
});
