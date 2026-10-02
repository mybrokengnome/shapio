import { describe, expect, it } from 'vitest';
import { MAX_API_KEY_LENGTH } from '../validators/apiKey.js';
import { suggestPlural } from './plural.js';

describe('suggestPlural', () => {
  it.each([
    ['article', 'articles'],
    ['category', 'categories'],
    ['blogPost', 'blogPosts'],
    ['person', 'people'],
    ['hero', 'heroes'],
    ['status', 'statuses'],
  ])('pluralises %s as %s', (singular, plural) => {
    expect(suggestPlural(singular)).toBe(plural);
  });

  it.each([
    ['news', 'newsItems'],
    ['series', 'seriesItems'],
    ['articles', 'articlesItems'],
  ])('appends Items when English has no distinct plural: %s → %s', (singular, plural) => {
    expect(suggestPlural(singular)).toBe(plural);
  });

  it('truncates the stem so the Items fallback fits the API ID length limit', () => {
    const singular = `${'a'.repeat(MAX_API_KEY_LENGTH - 4)}news`;
    const plural = suggestPlural(singular);
    expect(plural).toHaveLength(MAX_API_KEY_LENGTH);
    expect(plural).toBe(`${singular.slice(0, MAX_API_KEY_LENGTH - 5)}Items`);
  });

  it('falls back to Items when the plural would be too long', () => {
    const singular = `${'a'.repeat(MAX_API_KEY_LENGTH - 6)}status`;
    expect(suggestPlural(singular)).toBe(`${singular.slice(0, MAX_API_KEY_LENGTH - 5)}Items`);
  });

  it('suggests nothing for an empty API ID', () => {
    expect(suggestPlural('')).toBe('');
  });
});
