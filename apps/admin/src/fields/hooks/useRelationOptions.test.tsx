// @vitest-environment jsdom
import '@/test/dom';
import type { ContentTargets } from '@shapio/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { field, id, model } from '../../../../../packages/schema/src/testing/fixtures';
import type { RelationTargetInfo } from '../helpers/relationTargetLabel';
import { useEntryLabels } from './useEntryLabels';
import { useRelationOptions } from './useRelationOptions';

const mocks = vi.hoisted(() => ({ list: vi.fn(), targets: vi.fn() }));
vi.mock('@/api/client', () => ({ adminApi: { content: { list: mocks.list, targets: mocks.targets } } }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const FIELD = id(50);
const featurable: RelationTargetInfo = { kind: 'interface', id: id(2), label: 'Featurable' };
const response: ContentTargets = {
  target: { kind: 'interface', label: 'Featurable' },
  members: [
    { apiKey: 'blogPost', label: 'Blog post' },
    { apiKey: 'guide', label: 'Guide' },
  ],
  items: [
    {
      id: id(10),
      model: 'blogPost',
      title: 'Hello',
      status: 'published',
      locale: 'en',
      updatedAt: '2026-10-21T00:00:00Z',
    },
    {
      id: id(11),
      model: 'guide',
      title: null,
      status: 'draft',
      locale: 'en',
      updatedAt: '2026-10-21T00:00:00Z',
    },
  ],
  total: 2,
};

beforeEach(() => {
  mocks.list.mockReset();
  mocks.targets.mockReset();
});

describe('useRelationOptions', () => {
  it('reads an interface target through content-targets, with the field, search, type, and locale', async () => {
    mocks.targets.mockResolvedValue(response);
    const { result } = renderHook(
      () =>
        useRelationOptions({
          target: featurable,
          fieldId: FIELD,
          q: 'hel',
          types: ['guide'],
          locale: 'fr',
          pageSize: 20,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(mocks.targets).toHaveBeenCalledWith({
      field: FIELD,
      pageSize: 20,
      q: 'hel',
      types: ['guide'],
      locale: 'fr',
    });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(result.current.searchable).toBe(true);
    expect(result.current.members).toEqual(response.members);
    expect(result.current.items).toEqual([
      { id: id(10), model: 'blogPost', title: 'Hello' },
      { id: id(11), model: 'guide', title: undefined },
    ]);
  });

  it('sends no type filter for every type, and no locale when the form has none', async () => {
    mocks.targets.mockResolvedValue(response);
    renderHook(
      () =>
        useRelationOptions({
          target: { kind: 'any' },
          fieldId: FIELD,
          q: '',
          types: [],
          locale: null,
          pageSize: 20,
        }),
      { wrapper },
    );
    await waitFor(() => expect(mocks.targets).toHaveBeenCalledWith({ field: FIELD, pageSize: 20 }));
  });

  it('reads a model target through its own list, titled by its title field', async () => {
    const author = model({
      apiKey: 'author',
      label: 'Author',
      fields: [field({ apiKey: 'name' })],
    });
    mocks.list.mockResolvedValue({
      items: [{ id: id(20), model: 'author', data: { name: 'Ana' } }],
      pagination: { page: 1, pageSize: 20, total: 1, pageCount: 1 },
      locale: 'en',
    });
    const { result } = renderHook(
      () =>
        useRelationOptions({
          target: { kind: 'model', model: author },
          fieldId: FIELD,
          q: 'an',
          types: [],
          locale: null,
          pageSize: 20,
        }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.items).toEqual([{ id: id(20), model: 'author', title: 'Ana' }]),
    );
    expect(mocks.list).toHaveBeenCalledWith('author', { pageSize: 20, q: 'an' });
    expect(mocks.targets).not.toHaveBeenCalled();
  });

  it('reads nothing for a target this role cannot read', () => {
    renderHook(
      () =>
        useRelationOptions({
          target: { kind: 'unreadable' },
          fieldId: FIELD,
          q: '',
          types: [],
          locale: null,
          pageSize: 20,
        }),
      { wrapper },
    );
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.targets).not.toHaveBeenCalled();
  });
});

describe('useEntryLabels', () => {
  it('labels an interface value with one content-targets lookup by IDs, each entry with its own type', async () => {
    mocks.targets.mockResolvedValue({ ...response, total: 2 });
    const { result } = renderHook(() => useEntryLabels(featurable, FIELD, [id(11), id(10)], null), {
      wrapper,
    });
    await waitFor(() => expect(result.current.byId.size).toBe(2));
    expect(mocks.targets).toHaveBeenCalledTimes(1);
    expect(mocks.targets).toHaveBeenCalledWith({ field: FIELD, ids: [id(10), id(11)] });
    expect(result.current.byId.get(id(10))).toEqual({ title: 'Hello', model: 'blogPost' });
    expect(result.current.byId.get(id(11))).toEqual({ title: undefined, model: 'guide' });
    expect(result.current.members).toEqual(response.members);
  });

  it('reads nothing for an empty value', () => {
    const { result } = renderHook(() => useEntryLabels({ kind: 'any' }, FIELD, [], null), { wrapper });
    expect(mocks.targets).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });
});
