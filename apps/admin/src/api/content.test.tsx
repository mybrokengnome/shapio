// @vitest-environment jsdom
import '@/test/dom';
import type { AdminEntry } from '@shapio/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { forgetEntries, useFreshEntry, usePublishEntry, useSaveEntry } from './content';
import { queryKeys } from './queryKeys';

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), publish: vi.fn() }));

vi.mock('./client', () => ({
  adminApi: { content: { get: mocks.get, update: mocks.update, publish: mocks.publish } },
}));
vi.mock('./csrf', () => ({ withCsrf: (call: () => unknown) => call() }));

const ID = 'entry-1';

/** An article as the server answers it, with its search keywords at some draft version. */
const article = (keywords: string, version: number): AdminEntry =>
  ({
    id: ID,
    model: 'article',
    locale: 'en',
    version,
    data: { title: 'Mute notifications', searchKeywords: keywords },
  }) as unknown as AdminEntry;

const setup = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
};

describe('an entry reopened after saving and publishing it', () => {
  it('never opens on the copy cached before the edit, and opens on the saved values', async () => {
    const { queryClient, wrapper } = setup();
    // 1. The editor opened the entry without a locale in its URL: cached under the `null` locale key.
    const before = article('silence notifications', 3);
    queryClient.setQueryData(queryKeys.content.entry('article', ID, undefined), before);

    // 2. A property is edited and saved, then the entry is published: the answers name the locale ('en').
    const saved = article('silence notifications\nquiet notifications', 4);
    mocks.update.mockResolvedValue(saved);
    mocks.publish.mockResolvedValue(saved);
    const save = renderHook(() => useSaveEntry('article'), { wrapper });
    const publish = renderHook(() => usePublishEntry('article'), { wrapper });
    await act(async () => {
      await save.result.current.mutateAsync({ id: ID, input: { data: saved.data, expectedVersion: 3 } });
      await publish.result.current.mutateAsync({ id: ID, expectedVersion: 4 });
    });
    save.unmount();
    publish.unmount();

    // 3. Back to the list, then the entry is opened again the same way (no locale in the URL).
    let release: (entry: AdminEntry) => void = () => undefined;
    mocks.get.mockReturnValue(new Promise<AdminEntry>((resolve) => (release = resolve)));
    const reopened = renderHook(() => useFreshEntry('article', ID, undefined), { wrapper });
    expect(reopened.result.current.data).toBeUndefined();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    act(() => release(saved));
    await waitFor(() =>
      expect(reopened.result.current.data?.data.searchKeywords).toBe(
        'silence notifications\nquiet notifications',
      ),
    );
  });

  it('opens at once on a copy that is still fresh (no extra read)', () => {
    const { queryClient, wrapper } = setup();
    mocks.get.mockClear();
    const fresh = article('silence notifications', 3);
    queryClient.setQueryData(queryKeys.content.entry('article', ID, 'en'), fresh);
    const opened = renderHook(() => useFreshEntry('article', ID, 'en'), { wrapper });
    expect(opened.result.current.data).toBe(fresh);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('keeps a loaded form’s entry while it is read again later', async () => {
    const { queryClient, wrapper } = setup();
    mocks.get.mockReset().mockResolvedValue(article('first', 1));
    const opened = renderHook(() => useFreshEntry('article', ID, 'en'), { wrapper });
    await waitFor(() => expect(opened.result.current.data?.version).toBe(1));
    let release: (entry: AdminEntry) => void = () => undefined;
    mocks.get.mockReturnValue(new Promise<AdminEntry>((resolve) => (release = resolve)));
    act(() => void queryClient.invalidateQueries({ queryKey: queryKeys.content.entry('article', ID, 'en') }));
    expect(opened.result.current.data?.version).toBe(1);
    act(() => release(article('second', 2)));
    await waitFor(() => expect(opened.result.current.data?.version).toBe(2));
  });
});

describe('forgetEntries', () => {
  it('marks every cached copy of the entry stale, whatever key it was read under, without reading it', async () => {
    const { queryClient } = setup();
    const keys = [
      queryKeys.content.entry('article', ID, undefined),
      queryKeys.content.entry('article', ID, 'fr'),
      queryKeys.content.entry('page', ID, undefined),
      queryKeys.content.revisions('article', ID, undefined),
    ];
    const other = queryKeys.content.entry('article', 'entry-2', undefined);
    for (const key of [...keys, other]) {
      queryClient.setQueryData(key, { id: 'x' });
    }
    mocks.get.mockClear();
    await forgetEntries(queryClient, [ID]);
    expect(keys.map((key) => queryClient.getQueryState(key)?.isInvalidated)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false);
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
