// @vitest-environment jsdom
import '@/test/dom';
import { ShapioApiError } from '@shapio/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';
import { useBulkEntryActions } from './useBulkEntryActions';

const mocks = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock('@/api/client', () => ({ adminApi: { content: { publish: mocks.publish } } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/helpers/reportError', () => ({ logError: vi.fn(), reportError: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('useBulkEntryActions', () => {
  it('publishes each loaded row with its draft version and reports a stale one as failed', async () => {
    mocks.publish.mockImplementation((_model: string, id: string) =>
      id === 'stale'
        ? Promise.reject(
            new ShapioApiError(409, { error: { code: 'CONTENT_VERSION_CONFLICT', message: 'x' } }),
          )
        : Promise.resolve({}),
    );
    const { result } = renderHook(() => useBulkEntryActions('article', 'fr'), { wrapper });
    const rows = [
      { id: 'fresh', locale: 'fr', version: 4 },
      { id: 'stale', locale: 'fr', version: 2 },
      { id: 'fallback', locale: 'en', version: 9 },
    ];
    let failed: string[] = [];
    await act(async () => {
      failed = await result.current.run('publish', ['fresh', 'stale', 'fallback', 'otherPage'], rows);
    });
    expect(failed).toEqual(['stale']);
    expect(mocks.publish.mock.calls).toEqual([
      ['article', 'fresh', { locales: ['fr'], expectedVersion: 4 }],
      ['article', 'stale', { locales: ['fr'], expectedVersion: 2 }],
      // Read from a fallback locale, or ticked on another page: no version to guard with.
      ['article', 'fallback', { locales: ['fr'] }],
      ['article', 'otherPage', { locales: ['fr'] }],
    ]);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("sends each loaded row to its own kind, and rows not loaded to the place's type", async () => {
    mocks.publish.mockReset().mockResolvedValue({});
    const { result } = renderHook(() => useBulkEntryActions('product', null), { wrapper });
    await act(async () => {
      await result.current.run(
        'publish',
        ['plain', 'digital', 'otherPage'],
        [
          { id: 'plain', model: 'product', locale: 'en', version: 1 },
          { id: 'digital', model: 'digital', locale: 'en', version: 3 },
        ],
      );
    });
    expect(mocks.publish.mock.calls).toEqual([
      ['product', 'plain', { expectedVersion: 1 }],
      ['digital', 'digital', { expectedVersion: 3 }],
      ['product', 'otherPage', {}],
    ]);
  });
});
