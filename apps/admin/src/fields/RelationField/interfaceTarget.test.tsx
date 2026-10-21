// @vitest-environment jsdom
import '@/test/dom';
import type { ContentTargets, DefinitionListItem } from '@shapio/client';
import { ANY_TARGET, type ModelDefinition, type SchemaDefinition } from '@shapio/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/api/queryKeys';
import type { FieldsEnvironment } from '@/fields/form/context';
import { FieldsProvider } from '@/fields/form/FieldsProvider';
import { createEntryFormStore } from '@/fields/form/store';
import { contract, field, id, model } from '../../../../../packages/schema/src/testing/fixtures';
import { useRelationTypes } from './hooks/useRelationTypes';
import { RelationField } from '.';

const mocks = vi.hoisted(() => ({ targets: vi.fn(), list: vi.fn() }));
vi.mock('@/api/client', () => ({
  adminApi: {
    models: { list: vi.fn() },
    components: { list: vi.fn() },
    interfaces: { list: vi.fn() },
    auth: { me: vi.fn() },
    content: { targets: mocks.targets, list: mocks.list },
  },
  siteAdminApi: vi.fn(),
}));

const FEATURABLE = id(2);
const post = model({ id: id(1), apiKey: 'blogPost', label: 'Blog post', implements: [FEATURABLE] });
const guide = model({ id: id(3), apiKey: 'guide', label: 'Guide', implements: [FEATURABLE] });
const about = model({
  id: id(4),
  kind: 'singleton',
  apiKey: 'about',
  label: 'About',
  implements: [FEATURABLE],
});
const product = model({ id: id(5), apiKey: 'product', label: 'Product' });
const featurable = contract({ id: FEATURABLE, apiKey: 'featurable', label: 'Featurable' });
const FEATURED = id(40);
const homepage = model({
  id: id(6),
  kind: 'singleton',
  apiKey: 'homepage',
  label: 'Homepage',
  fields: [
    field({
      id: FEATURED,
      apiKey: 'featured',
      label: 'Featured',
      type: 'relation',
      settings: { target: FEATURABLE, cardinality: 'many' },
    }),
  ],
});
const models: ModelDefinition[] = [post, guide, about, product, homepage];

const item = (definition: SchemaDefinition): DefinitionListItem =>
  ({ definition, pendingChange: null }) as unknown as DefinitionListItem;

/** A client whose registry, interfaces, and `me` are already loaded (no request for them). */
const seededClient = (modelPermissions: Record<string, string[]>) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.schema.definitions('model'), models.map(item));
  client.setQueryData(queryKeys.schema.definitions('interface'), [item(featurable)]);
  client.setQueryData(queryKeys.me, { globalPermissions: [], modelPermissions });
  return client;
};

beforeEach(() => {
  mocks.targets.mockReset();
  mocks.list.mockReset();
});

describe('useRelationTypes for an interface target', () => {
  const wrapper =
    (client: QueryClient) =>
    ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

  it('offers the member collections the person may create, and covers every member', () => {
    const client = seededClient({ [post.id]: ['create'], [guide.id]: ['read'], [about.id]: ['create'] });
    const { result } = renderHook(
      () => useRelationTypes({ kind: 'interface', id: FEATURABLE, label: 'Featurable' }, undefined),
      { wrapper: wrapper(client) },
    );
    // About is a singleton (never created inline); Guide lacks create; Product is not a member.
    expect(result.current.creatable.map((model) => model.apiKey)).toEqual(['blogPost']);
    expect(result.current.covers(about.id)).toBe(true);
    expect(result.current.covers(product.id)).toBe(false);
    expect(result.current.typeLabelOf('guide')).toBe('Guide');
  });

  it('prefers the labels the content-targets response gives', () => {
    const client = seededClient({});
    const { result } = renderHook(
      () => useRelationTypes({ kind: 'any' }, [{ apiKey: 'guide', label: 'Field guide' }]),
      { wrapper: wrapper(client) },
    );
    expect(result.current.typeLabelOf('guide')).toBe('Field guide');
    expect(result.current.covers(product.id)).toBe(true);
  });
});

describe('a relation to an interface', () => {
  const environment: FieldsEnvironment = {
    idPrefix: 'test-',
    model: homepage,
    models: new Map(models.map((model) => [model.id, model])),
    components: new Map(),
    locale: null,
    entryId: null,
    // Read-only keeps the picker (and its media query) out; the rows are the same.
    readOnly: true,
    disabled: false,
    runtimeEditors: new Map(),
    pickMedia: () => Promise.resolve(null),
  };

  const renderField = (target: string, value: string[]) => {
    const definition = { ...homepage.fields[0]!, settings: { target, cardinality: 'many' as const } };
    return render(
      <QueryClientProvider client={seededClient({})}>
        <FieldsProvider environment={environment} store={createEntryFormStore({ featured: value })}>
          <RelationField
            value={value}
            onChange={() => undefined}
            onBlur={() => undefined}
            readOnly
            disabled={false}
            definition={definition as (typeof homepage.fields)[number]}
            field={{ options: {} } as never}
            model={{} as never}
            context={{} as never}
            validation={{} as never}
            path="/featured"
            inputId="featured"
            labelId="featured-label"
            describedBy={undefined}
          />
        </FieldsProvider>
      </QueryClientProvider>,
    );
  };

  const response = (items: ContentTargets['items']): ContentTargets => ({
    target: { kind: 'interface', label: 'Featurable' },
    members: [
      { apiKey: 'blogPost', label: 'Blog post' },
      { apiKey: 'guide', label: 'Guide' },
      { apiKey: 'about', label: 'About' },
    ],
    items,
    total: items.length,
  });
  const at = '2026-10-21T00:00:00Z';

  it('labels each linked entry with its title and its own type, from one lookup by IDs', async () => {
    mocks.targets.mockResolvedValue(
      response([
        { id: id(10), model: 'blogPost', title: 'Launch', status: 'published', locale: 'en', updatedAt: at },
        { id: id(11), model: 'guide', title: 'Setup', status: 'draft', locale: 'en', updatedAt: at },
        { id: id(12), model: 'about', title: null, status: 'published', locale: 'en', updatedAt: at },
      ]),
    );
    renderField(FEATURABLE, [id(10), id(11), id(12)]);
    expect(await screen.findByText('Launch')).toBeTruthy();
    const rows = [...document.querySelectorAll<HTMLElement>('[data-linked-entry]')].map(
      (row) => row.textContent,
    );
    expect(rows).toEqual(['LaunchBlog post', 'SetupGuide', `Untitled · ${id(12).slice(0, 8)}About`]);
    expect(mocks.targets).toHaveBeenCalledTimes(1);
    expect(mocks.targets).toHaveBeenCalledWith({ field: FEATURED, ids: [id(10), id(11), id(12)] });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('shows an entry the lookup did not return as missing', async () => {
    mocks.targets.mockResolvedValue(response([]));
    renderField(ANY_TARGET, [id(13)]);
    expect(await screen.findByText(/no longer exists/)).toBeTruthy();
  });
});
