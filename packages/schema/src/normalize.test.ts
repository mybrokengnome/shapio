import { describe, expect, it } from 'vitest';
import { hashDefinition } from './fileFormat/hash.js';
import { createDefinitionIndex } from './inheritance/resolve.js';
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

  it('keeps an explicit document layout on a kind, where leaving it out would inherit the parent’s', () => {
    const page = model({ id: id(10), apiKey: 'page', display: { layout: 'form' } });
    const article = model({
      id: id(11),
      apiKey: 'article',
      extends: page.id,
      display: { layout: 'document' },
    });
    expect(article.display).toEqual({ layout: 'document' });
    const inheriting = model({ id: id(12), apiKey: 'news', extends: page.id });
    const index = createDefinitionIndex([page, article, inheriting]);
    expect(index.resolve(article.id)?.display.layout).toBe('document');
    expect(index.resolve(inheriting.id)?.display.layout).toBe('form');
  });
});
