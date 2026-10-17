import type { ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { entryLink } from './entryLink';
import { fieldLabelOf, findingParams, linkedEntryOf, sentenceKeyOf } from './findingParams';

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
      target: '',
    });
    expect(
      findingParams({ locale: 'fr', params: { locale: 'fr', days: 21 } }, model, localeLabel, 'a field'),
    ).toEqual({ field: 'a field', locale: 'French', count: 21, target: '' });
    expect(findingParams({ locale: '*', params: {} }, undefined, localeLabel, 'a field').locale).toBe('');
  });
});

describe('sentenceKeyOf', () => {
  it('names the linked entry when its title came with the finding, else keeps the general sentence', () => {
    expect(sentenceKeyOf({ rule: 'relationUnpublished', targetTitle: 'Mobile app' })).toBe(
      'inbox.rules.relationUnpublished.sentenceTarget',
    );
    expect(sentenceKeyOf({ rule: 'relationUnpublished' })).toBe('inbox.rules.relationUnpublished.sentence');
    expect(sentenceKeyOf({ rule: 'altMissing', targetTitle: 'x' })).toBe('inbox.rules.altMissing.sentence');
  });
});

describe('linkedEntryOf and entryLink', () => {
  it('gives each linked entry its own URL, at the field', () => {
    expect(linkedEntryOf({ params: { targetEntryId: 'a1' } })).toBe('a1');
    expect(linkedEntryOf({ params: {} })).toBeUndefined();
    const link = entryLink('article', 'e1', 'collection', { locale: 'fr', path: '/related', target: 'a1' });
    expect(link).toMatchObject({ search: { locale: 'fr', target: 'a1' }, hash: 'related' });
    // A target without a field to point it out in is left off.
    expect(entryLink('article', 'e1', 'collection', { target: 'a1' }).search).toEqual({});
  });
});
