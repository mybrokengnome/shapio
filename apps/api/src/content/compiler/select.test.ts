import { normalizeDefinition, type ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import type { ContentModel } from '../model.js';
import { projectData, selectFields } from './select.js';

const ids = {
  body: '1a1a1a1a-1111-4111-8111-111111111111',
  count: '2b2b2b2b-2222-4222-8222-222222222222',
  title: '3c3c3c3c-3333-4333-8333-333333333333',
  tags: '4d4d4d4d-4444-4444-8444-444444444444',
  live: '5e5e5e5e-5555-4555-8555-555555555555',
};

const definition = normalizeDefinition({
  id: '0b5d6f3e-2d55-4f6c-9b1a-5d2c8e9f1a01',
  kind: 'collection',
  apiKey: 'article',
  label: 'Article',
  fields: [
    { id: ids.body, apiKey: 'body', label: 'Body', type: 'richtext' },
    { id: ids.count, apiKey: 'count', label: 'Count', type: 'integer' },
    { id: ids.title, apiKey: 'title', label: 'Title', type: 'string' },
    {
      id: ids.tags,
      apiKey: 'tags',
      label: 'Tags',
      type: 'enum',
      settings: { values: [{ value: 'a', label: 'A' }], multiple: true },
    },
    { id: ids.live, apiKey: 'live', label: 'Live', type: 'boolean' },
  ],
}) as ModelDefinition;

const model: ContentModel = { definition, version: 1, revisionId: 'r', components: new Map() };

const project = (data: Record<string, unknown>) =>
  projectData(data, {
    model,
    fields: selectFields(model, { mode: 'all' }, null),
    visibleTargets: null,
    populated: new Map(),
    richTextHtml: true,
    mediaAssets: null,
  });

describe('projectData', () => {
  it('emits values written under an older field type as empty, never as the new type', () => {
    // A snapshot from before `body` became rich text (it was text) and `count` became an integer.
    expect(
      project({
        [ids.body]: 'plain old text',
        [ids.count]: '12',
        [ids.title]: 42,
        [ids.tags]: 'a',
        [ids.live]: 'yes',
      }),
    ).toEqual({ body: null, count: null, title: null, tags: null, live: null });
  });

  it('passes values that match the current type through', () => {
    const doc = {
      version: 1,
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] },
    };
    const projected = project({
      [ids.body]: doc,
      [ids.count]: 12,
      [ids.title]: 'T',
      [ids.tags]: ['a'],
      [ids.live]: false,
    });
    expect(projected).toMatchObject({
      count: 12,
      title: 'T',
      tags: ['a'],
      live: false,
      body: { version: 1 },
    });
    expect((projected.body as { html: string }).html).toContain('Hi');
  });
});
