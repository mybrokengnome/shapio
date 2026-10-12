import { describe, expect, it } from 'vitest';
import { localeSchemaFor } from './localeSchema';

const codeError = (existing: readonly string[], code: string) =>
  localeSchemaFor(existing)
    .safeParse({ code, label: 'Label', fallbacks: [] })
    .error?.issues.find((issue) => issue.path[0] === 'code')?.message;

describe('localeSchemaFor', () => {
  it('says a code that differs from an existing one only in case already exists', () => {
    expect(codeError(['en', 'fr'], 'FR')).toBe('validation.localeExists');
    expect(codeError(['en', 'fr'], 'fr')).toBe('validation.localeExists');
  });

  it('still explains a badly written new code, and accepts a good one', () => {
    expect(codeError(['en'], 'FR')).toBe('validation.localeCode');
    expect(codeError(['en'], 'not a code')).toBe('validation.localeCode');
    expect(codeError(['en'], 'fr-CA')).toBeUndefined();
  });
});
