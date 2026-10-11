import { describe, expect, it } from 'vitest';
import { hashDefinition } from './fileFormat/hash.js';
import { renormalizeDefinition } from './normalize.js';
import { component, field, id, model } from './testing/fixtures.js';
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

describe('normalizeDefinition: form layout and widths', () => {
  const product = (display: { layout?: 'document' | 'form' }, width?: 'full' | 'half') =>
    model({
      id: id(1),
      apiKey: 'product',
      fields: [field({ id: id(2), apiKey: 'name', ...(width ? { width } : {}) })],
      display,
    });

  it('keeps a form layout and a width other than full', () => {
    const normalized = product({ layout: 'form' }, 'half');
    expect(normalized.display).toEqual({ layout: 'form' });
    expect(normalized.fields[0]?.width).toBe('half');
  });

  it('drops the defaults, so spelling them out hashes like leaving them out', async () => {
    const spelled = product({ layout: 'document' }, 'full');
    expect(spelled.display).toEqual({});
    expect(spelled.fields[0]).not.toHaveProperty('width');
    expect(await hashDefinition(spelled)).toBe(await hashDefinition(product({})));
  });
});
