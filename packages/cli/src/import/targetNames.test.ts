import type { SchemaDefinition } from '@shapio/schema';
import { describe, expect, it, vi } from 'vitest';
import { assignIds, buildDefinitions } from './planner.js';
import {
  avoidTargetNames,
  checkTargetNames,
  NAMES_NOT_CHECKED_NOTE,
  SHARED_PLAN_NOTE,
} from './targetNames.js';
import type { ImportSource, PlannedDefinition } from './types.js';

const sourceOf = (definitions: PlannedDefinition[]): ImportSource => ({
  kind: 'strapi',
  definitions,
  media: [],
  entries: [],
  notes: ['Adapter note.'],
});

const seoComponent: PlannedDefinition = {
  key: 'shared.seo',
  kind: 'component',
  apiKey: 'seo',
  label: 'SEO',
  fields: [{ key: 'metaTitle', apiKey: 'metaTitle', label: 'Meta title', type: 'string' }],
};

const article: PlannedDefinition = {
  key: 'api::article.article',
  kind: 'collection',
  apiKey: 'article',
  label: 'Article',
  fields: [
    { key: 'title', apiKey: 'title', label: 'Title', type: 'string' },
    { key: 'seo', apiKey: 'seo', label: 'SEO', type: 'component', component: 'shared.seo' },
  ],
};

/** What an instance holds, built the way a plan is (valid, normalized definitions). */
const targetOf = (definitions: PlannedDefinition[]): SchemaDefinition[] =>
  buildDefinitions(sourceOf(definitions), assignIds(definitions));

const apiKeys = (source: ImportSource) =>
  Object.fromEntries(source.definitions.map((definition) => [definition.key, definition.apiKey]));

describe('avoidTargetNames', () => {
  it('names a planned component the target already has with the Item suffix and notes it', () => {
    const target = targetOf([{ ...seoComponent, key: 'builtin.seo' }]);
    const checked = avoidTargetNames(sourceOf([seoComponent, article]), target);
    expect(apiKeys(checked)).toEqual({ 'shared.seo': 'seoItem', 'api::article.article': 'article' });
    expect(checked.notes).toEqual([
      'Adapter note.',
      'Component seo is named seoItem (the target already has seo).',
    ]);
    // The renamed plan validates together with the target, as `schema apply` will check it.
    const planned = buildDefinitions(checked, assignIds(checked.definitions));
    expect(planned.map((definition) => definition.apiKey)).toEqual(['seoItem', 'article']);
  });

  it('numbers the rename when the Item name is taken too', () => {
    const target = targetOf([
      { ...seoComponent, key: 'a' },
      { ...seoComponent, key: 'b', apiKey: 'seoItem' },
    ]);
    const checked = avoidTargetNames(sourceOf([seoComponent]), target);
    expect(apiKeys(checked)).toEqual({ 'shared.seo': 'seoItem2' });
  });

  it('renames a model whose plural API ID the target already has, and derives the new plural', () => {
    const target = targetOf([
      {
        key: 'story',
        kind: 'collection',
        apiKey: 'story',
        pluralApiKey: 'posts',
        label: 'Story',
        fields: [{ key: 'title', apiKey: 'title', label: 'Title', type: 'string' }],
      },
    ]);
    const post: PlannedDefinition = { ...article, key: 'post', apiKey: 'post', pluralApiKey: 'posts' };
    const checked = avoidTargetNames(sourceOf([seoComponent, post]), target);
    expect(apiKeys(checked)).toEqual({ 'shared.seo': 'seo', post: 'postItem' });
    expect(checked.definitions.find((definition) => definition.key === 'post')?.pluralApiKey).toBeUndefined();
    const built = buildDefinitions(checked, assignIds(checked.definitions));
    expect(built.find((definition) => definition.apiKey === 'postItem')).toMatchObject({
      pluralApiKey: 'postItems',
    });
    expect(checked.notes).toContain('Model post is named postItem (the target already has posts).');
  });

  it('renames on a generated GraphQL name clash alone', () => {
    // The target's `seoPage` model generates the type `SeoPageInput`, the type a planned `seoPageInput`
    // component is named after: different API IDs, still refused by `schema apply`.
    const target = targetOf([
      { ...article, key: 'seo', apiKey: 'seoPage', fields: article.fields.slice(0, 1) },
    ]);
    const clashing: PlannedDefinition = { ...seoComponent, apiKey: 'seoPageInput' };
    const checked = avoidTargetNames(sourceOf([clashing]), target);
    expect(apiKeys(checked)).toEqual({ 'shared.seo': 'seoPageInputItem' });
  });

  it('leaves a plan that fits unchanged', () => {
    const source = sourceOf([seoComponent, article]);
    const checked = avoidTargetNames(
      source,
      targetOf([{ ...article, key: 'x', apiKey: 'page', fields: [] }]),
    );
    expect(checked.definitions).toEqual(source.definitions);
    expect(checked.notes).toEqual(['Adapter note.']);
  });
});

describe('checkTargetNames', () => {
  it('notes that names were not checked without a target', async () => {
    const checked = await checkTargetNames(sourceOf([seoComponent]), undefined);
    expect(checked.notes).toEqual(['Adapter note.', NAMES_NOT_CHECKED_NOTE]);
  });

  it("reads the site's view with the site header and notes a shared plan's limit", async () => {
    const target = targetOf([{ ...seoComponent, key: 'builtin.seo' }]);
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 3,
            site: { id: 's1', key: 'default' },
            definitions: target.map((definition) => ({ definition, version: 1, hash: 'h', site: null })),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const checked = await checkTargetNames(sourceOf([seoComponent]), {
      baseUrl: 'https://cms.test',
      token: 'shp_test',
      site: 'default',
      shared: true,
      fetch,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://cms.test/api/admin/schema/export');
    expect(new Headers(init.headers).get('shapio-site')).toBe('default');
    expect(apiKeys(checked)).toEqual({ 'shared.seo': 'seoItem' });
    expect(checked.notes.at(-1)).toBe(SHARED_PLAN_NOTE);
  });
});
