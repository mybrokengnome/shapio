import { describe, expect, it } from 'vitest';
import { component, model } from '../testing/fixtures.js';
import { collectionQueryName, routeKeyOf, withDerivedPlural } from './naming.js';

describe('routeKeyOf', () => {
  it('is the plural of a collection and the API ID of a singleton', () => {
    expect(routeKeyOf(model({ apiKey: 'article' }))).toBe('articles');
    expect(routeKeyOf(model({ apiKey: 'article', pluralApiKey: 'posts' }))).toBe('posts');
    expect(routeKeyOf(model({ apiKey: 'homepage', kind: 'singleton' }))).toBe('homepage');
    expect(collectionQueryName(model({ apiKey: 'article', pluralApiKey: 'posts' }))).toBe('posts');
  });

  it('derives the plural of a stored collection that has none', () => {
    const { pluralApiKey: _dropped, ...stored } = model({ apiKey: 'news' });
    expect(routeKeyOf(stored)).toBe('newsItems');
  });
});

describe('withDerivedPlural', () => {
  it('fills a stored collection without a plural and says so', () => {
    const { pluralApiKey: _dropped, ...stored } = model({ apiKey: 'article' });
    const result = withDerivedPlural(stored);
    expect(result.filled).toBe(true);
    expect(result.definition).toEqual(model({ ...stored }));
    expect(Object.keys(result.definition).slice(0, 4)).toEqual(['id', 'kind', 'apiKey', 'pluralApiKey']);
  });

  it('leaves collections with a plural, singletons and components alone', () => {
    for (const definition of [
      model({ apiKey: 'article', pluralApiKey: 'posts' }),
      model({ apiKey: 'home', kind: 'singleton' }),
      component({ apiKey: 'hero' }),
    ]) {
      expect(withDerivedPlural(definition)).toEqual({ definition, filled: false });
    }
  });
});
