import { describe, expect, it } from 'vitest';
import { renormalizeDefinition } from './normalize.js';
import { component, model } from './testing/fixtures.js';
import type { SchemaDefinition } from './types/definitions.js';

describe('normalizeDefinition: plural API IDs', () => {
  it('fills a missing or empty plural on a collection from the singular', () => {
    expect(model({ apiKey: 'category' }).pluralApiKey).toBe('categories');
    expect(model({ apiKey: 'news', pluralApiKey: '' }).pluralApiKey).toBe('newsItems');
  });

  it('keeps an explicit plural', () => {
    expect(model({ apiKey: 'person', pluralApiKey: 'persons' }).pluralApiKey).toBe('persons');
  });

  it('drops the plural on singletons and components (kind switches)', () => {
    expect(model({ apiKey: 'home', kind: 'singleton', pluralApiKey: 'homes' })).not.toHaveProperty(
      'pluralApiKey',
    );
    const switched = renormalizeDefinition({
      ...component({ apiKey: 'hero' }),
      pluralApiKey: 'heroes',
    } as unknown as SchemaDefinition);
    expect(switched).not.toHaveProperty('pluralApiKey');
  });

  it('fills a stored collection that predates plural API IDs', () => {
    const { pluralApiKey: _dropped, ...stored } = model({ apiKey: 'article' });
    expect(renormalizeDefinition(stored)).toMatchObject({ pluralApiKey: 'articles' });
  });
});
