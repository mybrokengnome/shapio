import type { ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { fieldLabelOf, findingParams } from './findingParams';

const model = {
  fields: [
    { apiKey: 'cover', label: 'Cover' },
    { apiKey: 'sections', label: 'Sections' },
  ],
} as unknown as ModelDefinition;

const localeLabel = (code: string) => ({ fr: 'French' })[code] ?? code;

describe('fieldLabelOf', () => {
  it('names the top-level field of a pointer', () => {
    expect(fieldLabelOf(model, '/cover')).toBe('Cover');
    expect(fieldLabelOf(model, '/sections/2/title')).toBe('Sections');
    expect(fieldLabelOf(model, '/missing')).toBeUndefined();
    expect(fieldLabelOf(model, undefined)).toBeUndefined();
    expect(fieldLabelOf(undefined, '/cover')).toBeUndefined();
  });
});

describe('findingParams', () => {
  it('fills field, locale and days', () => {
    expect(
      findingParams({ path: '/cover', locale: 'en', params: {} }, model, localeLabel, 'a field'),
    ).toEqual({
      field: 'Cover',
      locale: 'en',
      count: 0,
    });
    expect(
      findingParams({ locale: 'fr', params: { locale: 'fr', days: 21 } }, model, localeLabel, 'a field'),
    ).toEqual({ field: 'a field', locale: 'French', count: 21 });
    expect(findingParams({ locale: '*', params: {} }, undefined, localeLabel, 'a field').locale).toBe('');
  });
});
