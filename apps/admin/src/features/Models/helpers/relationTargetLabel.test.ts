import { ANY_TARGET, createDefinitionIndex } from '@shapio/schema';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import {
  component,
  contract,
  field,
  id,
  model,
} from '../../../../../../packages/schema/src/testing/fixtures';
import { fieldTargetLabel, relationTargetLabel, targetTypeLabel } from './relationTargetLabel';

const t = ((key: string, options?: { name?: string; count?: number }) => {
  switch (key) {
    case 'models.builder.anyEntry':
      return 'Any entry';
    case 'models.builder.targetInterfaceLabel':
      return `${options?.name} (interface)`;
    case 'models.builder.targetWithKinds':
      return `${options?.name} and ${options?.count} kinds`;
    default:
      return key;
  }
}) as unknown as TFunction;

const page = model({ id: id(1), apiKey: 'page', label: 'Page' });
const article = model({ id: id(2), apiKey: 'article', label: 'Article', extends: page.id });
const post = model({ id: id(3), apiKey: 'post', label: 'Post' });
const linkable = contract({ id: id(4), apiKey: 'linkable', label: 'Linkable' });
const hero = component({ id: id(5), apiKey: 'hero', label: 'Hero' });
const grid = component({ id: id(6), apiKey: 'grid', label: 'Grid' });
const index = createDefinitionIndex([page, article, post, linkable, hero, grid]);

describe('relationTargetLabel', () => {
  it('names a type with its kinds, or alone', () => {
    expect(relationTargetLabel(page.id, index, t)).toBe('Page and 1 kinds');
    expect(relationTargetLabel(post.id, index, t)).toBe('Post');
    expect(targetTypeLabel(article, index, t)).toBe('Article');
  });

  it('marks an interface as one', () => {
    expect(relationTargetLabel(linkable.id, index, t)).toBe('Linkable (interface)');
  });

  it('calls the * target "Any entry"', () => {
    expect(relationTargetLabel(ANY_TARGET, index, t)).toBe('Any entry');
  });

  it('has nothing to say for an unset or unknown target', () => {
    expect(relationTargetLabel(undefined, index, t)).toBeUndefined();
    expect(relationTargetLabel('', index, t)).toBeUndefined();
    expect(relationTargetLabel(id(99), index, t)).toBeUndefined();
  });
});

describe('fieldTargetLabel', () => {
  it('reads a relation, a component field and a dynamic zone', () => {
    const relation = field({ apiKey: 'link', type: 'relation', settings: { target: linkable.id } });
    const single = field({ apiKey: 'hero', type: 'component', settings: { component: hero.id } });
    const zone = field({
      apiKey: 'blocks',
      type: 'dynamiczone',
      settings: { components: [hero.id, id(98), grid.id] },
    });
    expect(fieldTargetLabel(relation, index, t)).toBe('Linkable (interface)');
    expect(fieldTargetLabel(single, index, t)).toBe('Hero');
    // An unknown component is left out rather than shown as an ID.
    expect(fieldTargetLabel(zone, index, t)).toBe('Hero, Grid');
  });

  it('is undefined for other types and for a component not chosen yet', () => {
    expect(fieldTargetLabel(field({ apiKey: 'title' }), index, t)).toBeUndefined();
    expect(
      fieldTargetLabel(
        field({ apiKey: 'blocks', type: 'dynamiczone', settings: { components: [] } }),
        index,
        t,
      ),
    ).toBeUndefined();
  });
});
