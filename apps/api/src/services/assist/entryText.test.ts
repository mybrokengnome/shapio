import type { FieldDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import type { ContentModel } from '../../content/model.js';
import { entrySourceText } from './entryText.js';

const field = (id: string, type: string, settings: Record<string, unknown> = {}) =>
  ({
    id,
    apiKey: id,
    label: id,
    type,
    settings,
    localized: true,
    deprecated: false,
  }) as unknown as FieldDefinition;

const hero = {
  id: 'hero',
  kind: 'component',
  apiKey: 'hero',
  label: 'Hero',
  fields: [field('heading', 'string')],
};

const model = {
  definition: {
    id: 'm',
    apiKey: 'page',
    label: 'Page',
    localized: true,
    display: {},
    fields: [field('title', 'string'), field('hero', 'component', { component: 'hero' })],
  },
  components: new Map([['hero', { definition: hero, version: 1 }]]),
} as unknown as ContentModel;

describe('entry source text', () => {
  it('reads a single component by its fields and never includes its item ID', () => {
    const text = entrySourceText(
      model,
      { title: 'Home', hero: { __id: '11111111-1111-4111-8111-000000000001', heading: 'Welcome' } },
      { mode: 'all' },
    );
    expect(text).toContain('Welcome');
    expect(text).not.toContain('11111111');
  });
});
