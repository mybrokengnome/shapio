import { describe, expect, it } from 'vitest';
import { field, id, model } from '../../../../../../../packages/schema/src/testing/fixtures';
import { quickEditFieldsOf } from './quickEditFields';

const TITLE = id(1);
const SLUG = id(2);
const AUTHOR = id(3);

const article = (stripFieldIds?: string[]) =>
  model({
    display: { titleFieldId: TITLE, ...(stripFieldIds ? { stripFieldIds } : {}) },
    fields: [
      field({ id: TITLE, apiKey: 'title', type: 'string' }),
      field({ id: SLUG, apiKey: 'slug', type: 'slug', settings: { sourceFieldId: TITLE } }),
      field({ apiKey: 'body', type: 'richtext' }),
      field({ apiKey: 'cover', type: 'media', settings: { allowedKinds: ['image'] } }),
      field({ apiKey: 'meta', type: 'json' }),
      field({
        id: AUTHOR,
        apiKey: 'author',
        type: 'relation',
        settings: { target: id(9), cardinality: 'one' },
      }),
    ],
  });

describe('quickEditFieldsOf', () => {
  it('offers the inline title and the properties, never canvas, cover or document-only values', () => {
    expect(quickEditFieldsOf(article()).map((item) => item.apiKey)).toEqual(['title', 'slug', 'author']);
  });

  it('follows a configured properties strip', () => {
    expect(quickEditFieldsOf(article([AUTHOR])).map((item) => item.apiKey)).toEqual(['title', 'author']);
  });
});
