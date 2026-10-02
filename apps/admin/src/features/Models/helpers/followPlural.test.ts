import { describe, expect, it } from 'vitest';
import { followPlural } from './followPlural';

describe('followPlural', () => {
  it('follows the singular while empty or still the suggestion', () => {
    expect(followPlural('', 'categ', '')).toBe('categs');
    expect(followPlural('categ', 'category', 'categs')).toBe('categories');
    expect(followPlural('article', 'news', undefined)).toBe('newsItems');
  });

  it('keeps a plural typed by hand', () => {
    expect(followPlural('person', 'people', 'persons')).toBe('persons');
  });
});
