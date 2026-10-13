import { describe, expect, it } from 'vitest';
import { parsePreviewUrl } from './preview.js';

const url = (model: string) =>
  new URL(`http://localhost:4321/preview/?model=${encodeURIComponent(model)}&id=e1&locale=fr#token=shpv_x`);

describe('parsePreviewUrl', () => {
  it('reads an allowlisted route key', () => {
    expect(parsePreviewUrl(url('articles'))).toEqual({
      token: 'shpv_x',
      modelKey: 'articles',
      family: 'articles',
      entryId: 'e1',
      locale: 'fr',
    });
  });

  it('accepts a type nested under an allowlisted one and renders it as its family', () => {
    expect(parsePreviewUrl(url('articles/guides'))).toMatchObject({
      modelKey: 'articles/guides',
      family: 'articles',
    });
  });

  it('refuses other models and anything that is not a route key', () => {
    expect(parsePreviewUrl(url('authors'))).toBeUndefined();
    expect(parsePreviewUrl(url('authors/articles'))).toBeUndefined();
    expect(parsePreviewUrl(url('articles/../admin'))).toBeUndefined();
    expect(parsePreviewUrl(url('articles/'))).toBeUndefined();
  });
});
