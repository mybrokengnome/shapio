import { describe, expect, it } from 'vitest';
import { component, field, model } from '../../../../../packages/schema/src/testing/fixtures';
import { isSuggestible } from './assistEligibility';

const [seoTitle] = component({ apiKey: 'seo', fields: [field({ apiKey: 'title', label: 'Title' })] }).fields;
const article = model({
  fields: [
    field({ apiKey: 'title', label: 'Title' }),
    field({ apiKey: 'excerpt', label: 'Excerpt', type: 'text' }),
    field({
      apiKey: 'kind',
      label: 'Kind',
      type: 'enum',
      settings: {
        values: [
          { value: 'news', label: 'News' },
          { value: 'guide', label: 'Guide' },
        ],
      },
    }),
    field({ apiKey: 'readingTime', label: 'Reading time', type: 'integer' }),
    field({ apiKey: 'old', label: 'Old', deprecated: true }),
    field({
      apiKey: 'seo',
      label: 'SEO',
      type: 'component',
      settings: { component: 'seo', repeatable: false },
    }),
    field({
      apiKey: 'sections',
      label: 'Sections',
      type: 'component',
      settings: { component: 'section', repeatable: true },
    }),
  ],
});
const fieldOf = (apiKey: string) => {
  const found = article.fields.find((candidate) => candidate.apiKey === apiKey);
  if (!found) {
    throw new Error(`no field ${apiKey}`);
  }
  return found;
};

if (!seoTitle) {
  throw new Error('no SEO title');
}

describe('isSuggestible', () => {
  it('accepts top-level string, text and enum fields, the title included', () => {
    expect(isSuggestible(article, fieldOf('title'), '/title')).toBe(true);
    expect(isSuggestible(article, fieldOf('excerpt'), '/excerpt')).toBe(true);
    expect(isSuggestible(article, fieldOf('kind'), '/kind')).toBe(true);
  });

  it('refuses other types and deprecated fields', () => {
    expect(isSuggestible(article, fieldOf('readingTime'), '/readingTime')).toBe(false);
    expect(isSuggestible(article, fieldOf('old'), '/old')).toBe(false);
    expect(isSuggestible(article, fieldOf('seo'), '/seo')).toBe(false);
  });

  it("accepts a single component's fields", () => {
    expect(isSuggestible(article, seoTitle, '/seo/title')).toBe(true);
  });

  it('refuses repeatable items, unknown parents and deeper paths', () => {
    expect(isSuggestible(article, seoTitle, '/sections/0/title')).toBe(false);
    expect(isSuggestible(article, seoTitle, '/sections/title')).toBe(false);
    expect(isSuggestible(article, seoTitle, '/missing/title')).toBe(false);
    expect(isSuggestible(article, seoTitle, '/seo/inner/title')).toBe(false);
  });

  it('refuses a field that is not the one the path names', () => {
    expect(isSuggestible(article, fieldOf('excerpt'), '/title')).toBe(false);
  });
});
