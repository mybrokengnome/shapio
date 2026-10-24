// @vitest-environment jsdom
import '@/test/dom';
import type { DefinitionDetail } from '@shapio/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from './queryKeys';
import { useFreshDefinition } from './schema';

const mocks = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn() }));

vi.mock('./client', () => {
  const api = { get: mocks.get, list: mocks.list };
  return { adminApi: { models: api, components: api, interfaces: api }, siteAdminApi: () => ({}) };
});
vi.mock('./csrf', () => ({ withCsrf: (call: () => unknown) => call() }));

const ID = 'link-card';
const POST = 'post-collection';
const FEATURABLE = 'featurable-interface';

/** The `linkCard` component as the server answers it: `opens` targets `target` at some version. */
const linkCard = (version: number, target: string, description: string | null): DefinitionDetail =>
  ({
    version,
    scope: 'network',
    pendingChange: null,
    definition: {
      id: ID,
      kind: 'component',
      apiKey: 'linkCard',
      label: 'Link card',
      fields: [
        {
          id: 'opens',
          apiKey: 'opens',
          type: 'relation',
          description,
          settings: { target, cardinality: 'one' },
        },
      ],
    },
  }) as unknown as DefinitionDetail;

const setup = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
};

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  mocks.get.mockReset();
  mocks.list.mockReset().mockResolvedValue([]);
});

describe('a builder reopened after the definition changed through the schema API', () => {
  it('never opens on the cached copy, even one still inside the stale time, and opens on the new version', async () => {
    const { queryClient, wrapper } = setup();
    // Opened before: cached a moment ago with `opens` targeting a collection and no description.
    queryClient.setQueryData(queryKeys.schema.definition('component', ID), linkCard(2, POST, null));
    // Meanwhile the schema API moved it to the interface, with a description.
    const read = deferred<DefinitionDetail>();
    mocks.get.mockReturnValue(read.promise);

    const reopened = renderHook(() => useFreshDefinition('component', ID), { wrapper });
    expect(reopened.result.current.data).toBeUndefined();
    expect(mocks.get).toHaveBeenCalledTimes(1);

    act(() => read.resolve(linkCard(3, FEATURABLE, 'Where the card opens')));
    await waitFor(() => expect(reopened.result.current.data?.version).toBe(3));
    const opens = reopened.result.current.data?.definition.fields[0];
    expect(opens?.settings).toEqual({ target: FEATURABLE, cardinality: 'one' });
    expect(opens?.description).toBe('Where the card opens');
  });

  it('reads the lists of models, components and interfaces again, so a new relation target is offered', async () => {
    const { queryClient, wrapper } = setup();
    for (const category of ['model', 'component', 'interface'] as const) {
      queryClient.setQueryData(queryKeys.schema.definitions(category), []);
    }
    mocks.get.mockResolvedValue(linkCard(1, FEATURABLE, null));
    renderHook(() => useFreshDefinition('component', ID), { wrapper });
    for (const category of ['model', 'component', 'interface'] as const) {
      await waitFor(() =>
        expect(queryClient.getQueryState(queryKeys.schema.definitions(category))?.isInvalidated).toBe(true),
      );
    }
  });

  it('shows the error, not the cached copy, when the read on opening fails', async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(queryKeys.schema.definition('component', ID), linkCard(2, POST, null));
    mocks.get.mockRejectedValue(new Error('offline'));
    const reopened = renderHook(() => useFreshDefinition('component', ID), { wrapper });
    await waitFor(() => expect(reopened.result.current.error).toBeInstanceOf(Error));
    expect(reopened.result.current.data).toBeUndefined();
  });

  it('keeps a loaded builder’s definition when a later read fails', async () => {
    const { queryClient, wrapper } = setup();
    mocks.get.mockResolvedValue(linkCard(1, FEATURABLE, null));
    const opened = renderHook(() => useFreshDefinition('component', ID), { wrapper });
    await waitFor(() => expect(opened.result.current.data?.version).toBe(1));
    mocks.get.mockRejectedValue(new Error('offline'));
    await act(() => queryClient.refetchQueries({ queryKey: queryKeys.schema.definition('component', ID) }));
    expect(opened.result.current.data?.version).toBe(1);
    expect(opened.result.current.error).toBeNull();
  });
});
