import { createDefinitionIndex } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { field, id, model } from '../../../../../../../../packages/schema/src/testing/fixtures';
import { placeOf } from './places';

describe('placeOf', () => {
  it('reads a kind’s inherited title field', () => {
    const page = model({ id: id(1), apiKey: 'page', fields: [field({ id: id(2), apiKey: 'heading' })] });
    const article = model({
      id: id(3),
      apiKey: 'article',
      extends: page.id,
      display: { titleFieldId: id(2) },
    });
    const resolved = createDefinitionIndex([page, article]).resolve(article.id);
    expect(placeOf(resolved!, [page], ['en'])).toMatchObject({ modelKey: 'article', titleKey: 'heading' });
  });
  it('reads a kind where delivery serves it, under its family, and a root by its own plural', () => {
    const page = model({ id: id(1), apiKey: 'page', fields: [field({ id: id(2), apiKey: 'heading' })] });
    const article = model({ id: id(3), apiKey: 'article', extends: page.id });
    const resolved = createDefinitionIndex([page, article]).resolve(article.id);
    expect(placeOf(resolved!, [page], ['en']).routeKey).toBe('pages/articles');
    expect(placeOf(page, [], ['en']).routeKey).toBe('pages');
  });
});
