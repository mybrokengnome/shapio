// @vitest-environment jsdom
import '@/test/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { queryKeys } from '@/api/queryKeys';
import { useThemeStore } from '@/stores/theme';
import { useReconcileTheme } from './useReconcileTheme';

const wrapperWith = (seed?: { items: unknown[] }) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (seed) {
    queryClient.setQueryData(queryKeys.extensionThemes, seed);
  } else {
    // Never resolves: the project's list is still loading.
    queryClient.setQueryDefaults(queryKeys.extensionThemes, { queryFn: () => new Promise(() => undefined) });
  }
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const choose = (theme: string, appearance: 'light' | 'dark', variants: Array<'light' | 'dark'>) =>
  act(() => useThemeStore.getState().setLook(theme, appearance, variants));

beforeEach(() => choose('shapio', 'dark', ['dark']));

describe('useReconcileTheme', () => {
  it('falls back to Shapio when the saved theme no longer exists', () => {
    choose('gone', 'light', ['light']);
    renderHook(useReconcileTheme, { wrapper: wrapperWith({ items: [] }) });
    expect(useThemeStore.getState()).toMatchObject({
      theme: 'shapio',
      appearance: 'dark',
      variants: ['dark'],
    });
  });

  it('keeps an extension theme and refreshes its cached variants (and a lost variant) from the server', () => {
    choose('sepia', 'dark', ['light', 'dark']);
    renderHook(useReconcileTheme, {
      wrapper: wrapperWith({ items: [{ key: 'sepia', name: 'Sepia', variants: ['light'] }] }),
    });
    expect(useThemeStore.getState()).toMatchObject({
      theme: 'sepia',
      appearance: 'light',
      variants: ['light'],
    });
  });

  it('judges nothing while the project list is still loading', () => {
    choose('sepia', 'light', ['light']);
    renderHook(useReconcileTheme, { wrapper: wrapperWith() });
    expect(useThemeStore.getState()).toMatchObject({ theme: 'sepia', variants: ['light'] });
  });
});
