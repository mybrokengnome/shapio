import { describe, expect, it } from 'vitest';
import { field, id, model } from '../testing/fixtures.js';
import { effectiveTitleField } from './titleField.js';

describe('effectiveTitleField', () => {
  it('uses the configured title field', () => {
    const definition = model({
      fields: [
        field({ id: id(1), apiKey: 'name', type: 'string' }),
        field({
          id: id(2),
          apiKey: 'kind',
          type: 'enum',
          settings: { values: [{ value: 'a', label: 'A' }] },
        }),
      ],
      display: { titleFieldId: id(2) },
    });
    expect(effectiveTitleField(definition)?.apiKey).toBe('kind');
  });

  it('falls back to the first title-type field, in field order, when none is configured', () => {
    const definition = model({
      fields: [
        field({ id: id(3), apiKey: 'views', type: 'integer' }),
        field({ id: id(4), apiKey: 'summary', type: 'text' }),
        field({ id: id(5), apiKey: 'headline', type: 'string' }),
      ],
    });
    expect(effectiveTitleField(definition)?.apiKey).toBe('summary');
  });

  it('falls back when the configured field is deprecated, and skips deprecated text fields', () => {
    const definition = model({
      fields: [
        field({ id: id(6), apiKey: 'oldTitle', type: 'string', deprecated: true }),
        field({ id: id(7), apiKey: 'slug', type: 'slug' }),
      ],
      display: { titleFieldId: id(6) },
    });
    expect(effectiveTitleField(definition)?.apiKey).toBe('slug');
  });

  it('never falls back to a field the validator refuses as a title (url), but does to an enum', () => {
    const definition = model({
      fields: [
        field({ id: id(10), apiKey: 'website', type: 'url' }),
        field({
          id: id(11),
          apiKey: 'kind',
          type: 'enum',
          settings: { values: [{ value: 'a', label: 'A' }] },
        }),
        field({ id: id(12), apiKey: 'name', type: 'string' }),
      ],
    });
    expect(effectiveTitleField(definition)?.apiKey).toBe('kind');
    expect(
      effectiveTitleField(model({ fields: [field({ id: id(13), apiKey: 'link', type: 'url' })] })),
    ).toBeUndefined();
  });

  it('is undefined when there is no field of a title type', () => {
    const definition = model({
      fields: [
        field({ id: id(8), apiKey: 'count', type: 'integer' }),
        field({ id: id(9), apiKey: 'live', type: 'boolean' }),
      ],
    });
    expect(effectiveTitleField(definition)).toBeUndefined();
    expect(effectiveTitleField(model({ fields: [] }))).toBeUndefined();
  });
});
