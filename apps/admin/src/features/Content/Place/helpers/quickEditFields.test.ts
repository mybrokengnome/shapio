import { describe, expect, it } from 'vitest';
import { field, id, model } from '../../../../../../../packages/schema/src/testing/fixtures';
import { quickEditFieldsOf } from './quickEditFields';

const TITLE = id(1);
const SLUG = id(2);
const AUTHOR = id(3);
const BODY = id(4);

const article = (stripFieldIds?: string[], canvasFieldIds?: string[]) =>
  model({
    display: {
      titleFieldId: TITLE,
      ...(stripFieldIds ? { stripFieldIds } : {}),
      ...(canvasFieldIds ? { canvasFieldIds } : {}),
    },
    fields: [
      field({ id: TITLE, apiKey: 'title', type: 'string' }),
      field({ id: SLUG, apiKey: 'slug', type: 'slug', settings: { sourceFieldId: TITLE } }),
      field({ id: BODY, apiKey: 'body', type: 'richtext' }),
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

  it('keeps a non-block field placed in the document', () => {
    expect(quickEditFieldsOf(article(undefined, [BODY, SLUG])).map((item) => item.apiKey)).toEqual([
      'title',
      'author',
      'slug',
    ]);
  });

  it('offers every live field of a form in form order, without document-only values', () => {
    const MEDIA = id(5);
    const form = model({
      display: {
        layout: 'form',
        titleFieldId: TITLE,
        groups: [{ id: 'people', label: 'People', fieldIds: [AUTHOR] }],
        stripFieldIds: [SLUG],
      },
      fields: [
        field({ id: TITLE, apiKey: 'title', type: 'string' }),
        field({
          id: AUTHOR,
          apiKey: 'author',
          type: 'relation',
          settings: { target: id(9), cardinality: 'one' },
        }),
        field({ id: SLUG, apiKey: 'slug', type: 'slug', settings: { sourceFieldId: TITLE } }),
        field({ id: BODY, apiKey: 'body', type: 'richtext' }),
        field({ id: MEDIA, apiKey: 'gallery', type: 'media', settings: { multiple: true } }),
        field({ apiKey: 'cover', type: 'media', settings: { allowedKinds: ['image'] } }),
        field({ apiKey: 'meta', type: 'json' }),
        field({ apiKey: 'old', type: 'string', deprecated: true }),
      ],
    });
    expect(quickEditFieldsOf(form).map((item) => item.apiKey)).toEqual([
      'title',
      'author',
      'slug',
      'gallery',
      'cover',
    ]);
  });
});
