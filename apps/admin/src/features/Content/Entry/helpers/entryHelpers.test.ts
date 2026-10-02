import { describe, expect, it } from 'vitest';
import { component, field, model } from '../../../../../../../packages/schema/src/testing/fixtures';
import { resolveFieldPath } from './fieldPath';
import { ENTRY_LOCALE_MISSING_KEY, PREFLIGHT_RULE_KEYS, sentenceOf } from './preflightSentences';

const feature = component({
  apiKey: 'feature',
  label: 'Feature',
  fields: [field({ apiKey: 'title', label: 'Feature title' })],
});
const story = model({
  fields: [
    field({ apiKey: 'title', label: 'Title' }),
    field({ apiKey: 'body', label: 'Body', type: 'richtext' }),
    field({
      apiKey: 'sections',
      label: 'Sections',
      type: 'dynamiczone',
      settings: { components: [feature.id] },
    }),
  ],
});
const components = new Map([[feature.id, feature]]);
const values = { sections: [{ __component: 'feature', title: 'Maps' }] };

describe('resolveFieldPath', () => {
  it('names a nested value by its labels and list position, and finds the field to reveal', () => {
    const target = resolveFieldPath(story, components, values, '/sections/0/title');
    expect(target?.topLevel.apiKey).toBe('sections');
    expect(target?.trail).toEqual(['Sections', '1', 'Feature title']);
    expect(target?.field.label).toBe('Feature title');
  });

  it('is undefined for a path outside the model', () => {
    expect(resolveFieldPath(story, components, values, '/missing')).toBeUndefined();
  });
});

describe('sentenceOf', () => {
  const context = {
    fieldLabel: 'Body',
    field: undefined,
    localeLabel: (code: string) => `L:${code}`,
    entryLevel: false,
  };

  it('builds a field sentence for most rules', () => {
    expect(
      sentenceOf({ rule: 'altMissing', severity: 'warning', path: '/body', params: {} }, context),
    ).toEqual({
      key: PREFLIGHT_RULE_KEYS.altMissing,
      values: { field: 'Body' },
    });
  });

  it('reads a missing locale differently for this locale and for the entry as a whole', () => {
    const check = { rule: 'localeMissing', severity: 'warning', params: { locale: 'fr' } } as const;
    expect(sentenceOf(check, context).key).toBe(PREFLIGHT_RULE_KEYS.localeMissing);
    expect(sentenceOf(check, { ...context, entryLevel: true })).toEqual({
      key: ENTRY_LOCALE_MISSING_KEY,
      values: { locale: 'L:fr' },
    });
  });

  it('counts days for the time-based rules (plurals need `count`)', () => {
    expect(
      sentenceOf({ rule: 'staleDraft', severity: 'warning', params: { days: 3 } }, context).values,
    ).toEqual({
      days: 3,
      count: 3,
    });
  });
});
