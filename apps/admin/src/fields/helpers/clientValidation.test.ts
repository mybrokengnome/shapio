import { describe, expect, it } from 'vitest';
import { field, model } from '../../../../../packages/schema/src/testing/fixtures';
import { clientIssuesOf } from './clientValidation';

const [title, email, slug, rating, price, tags, gallery] = model({
  fields: [
    field({ apiKey: 'title', settings: { minLength: 3, maxLength: 10 } }),
    field({ apiKey: 'email', type: 'email' }),
    field({ apiKey: 'slug', type: 'slug' }),
    field({ apiKey: 'rating', type: 'integer', settings: { min: 1, max: 5 } }),
    field({ apiKey: 'price', type: 'decimal' }),
    field({ apiKey: 'tags', type: 'enum', settings: { values: [{ value: 'a', label: 'A' }] } }),
    field({ apiKey: 'gallery', type: 'media', settings: { multiple: true, max: 2 } }),
  ],
}).fields;

const codes = (definition: typeof title, value: unknown) =>
  clientIssuesOf(definition as NonNullable<typeof title>, value).map((issue) => issue.code);

describe('clientIssuesOf', () => {
  it('checks formats, lengths, ranges, choices and counts, and never `required`', () => {
    expect(codes(title, '')).toEqual([]);
    expect(codes(title, 'ab')).toEqual(['TOO_SHORT']);
    expect(codes(title, 'abcdefghijk')).toEqual(['TOO_LONG']);
    expect(codes(email, 'not-an-email')).toEqual(['INVALID_FORMAT']);
    expect(codes(email, 'ada@example.com')).toEqual([]);
    expect(codes(slug, 'Summer Sale')).toEqual(['INVALID_FORMAT']);
    expect(codes(rating, 6)).toEqual(['TOO_LARGE']);
    expect(codes(rating, 2.5)).toEqual(['INVALID_TYPE']);
    expect(codes(price, '1.')).toEqual(['INVALID_FORMAT']);
    expect(codes(tags, 'b')).toEqual(['NOT_ALLOWED']);
    expect(codes(gallery, ['a', 'b', 'c'])).toEqual(['TOO_MANY']);
  });
});
