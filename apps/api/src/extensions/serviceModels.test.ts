import { createDefinitionIndex, type SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { toHookModel } from './hooks.js';
import { toServiceModel } from './serviceModels.js';

const field = (id: string, apiKey: string) =>
  ({
    id,
    apiKey,
    label: apiKey,
    type: 'string',
    required: false,
    localized: false,
    public: true,
    unique: false,
    filterable: false,
    sortable: false,
    deprecated: false,
    editor: { id: 'textInput', options: {} },
    settings: {},
  }) as const;

const collection = (id: string, apiKey: string, fields: ReturnType<typeof field>[], parent?: string) =>
  ({
    id,
    kind: 'collection',
    apiKey,
    pluralApiKey: `${apiKey}s`,
    label: apiKey,
    localized: false,
    draftAndPublish: true,
    display: {},
    fields,
    ...(parent === undefined ? {} : { extends: parent }),
  }) as unknown as SchemaDefinition;

/** Post (title) and Guide (level), which extends it: stored definitions, own fields only. */
const index = createDefinitionIndex([
  collection('post-id', 'post', [field('f-title', 'title')]),
  collection('guide-id', 'guide', [field('f-level', 'level')], 'post-id'),
]);
const apiKeyOf = (id: string) => index.get(id)?.apiKey;

describe('content.models() for extensions (ADR 0012)', () => {
  it('lists a child with its parent, nested route key and effective fields, inherited first', () => {
    const guide = index.resolve('guide-id');
    expect(guide).toBeDefined();
    const model = toServiceModel(guide!, { key: 'posts/guides', ancestors: ['post'] }, apiKeyOf);
    expect(model).toMatchObject({
      id: 'guide-id',
      apiKey: 'guide',
      extends: 'post',
      routeKey: 'posts/guides',
    });
    expect(model.fields).toEqual([
      {
        id: 'f-title',
        apiKey: 'title',
        label: 'title',
        type: 'string',
        required: false,
        localized: false,
        inheritedFrom: 'post',
      },
      { id: 'f-level', apiKey: 'level', label: 'level', type: 'string', required: false, localized: false },
    ]);
  });

  it('describes a root without extends or inheritedFrom', () => {
    const model = toServiceModel(index.resolve('post-id')!, { key: 'posts', ancestors: [] }, apiKeyOf);
    expect(model).not.toHaveProperty('extends');
    expect(model.routeKey).toBe('posts');
    expect(model.fields.every((candidate) => !('inheritedFrom' in candidate))).toBe(true);
  });

  it('keeps the hook model unchanged for a model without a parent', () => {
    const post = index.resolve('post-id')!;
    expect(toHookModel(post)).toEqual({
      id: 'post-id',
      apiKey: 'post',
      label: 'post',
      kind: 'collection',
      localized: false,
      draftAndPublish: true,
    });
    expect(toHookModel(post, 'parent')).toMatchObject({ extends: 'parent' });
  });
});
