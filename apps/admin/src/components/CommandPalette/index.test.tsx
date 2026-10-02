// @vitest-environment jsdom
import '@/test/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  linkOptions,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/api/queryKeys';
import { readRecentItems } from './helpers/recentItems';
import { usePaletteActions } from './hooks/usePaletteActions';
import { usePaletteItems } from './hooks/usePaletteItems';
import { usePaletteStore } from './store';
import { CommandPalette } from '.';

type ScreenProps = { onPublish: () => void };

/** A screen offering one page action and two destinations, as the Shell and a document would. */
const Screen = ({ onPublish }: ScreenProps) => {
  const actions = useMemo(() => [{ id: 'publish', label: 'Publish entry', run: onPublish }], [onPublish]);
  const places = useMemo(
    () => [
      { id: 'goto:media', label: 'Media', link: linkOptions({ to: '/media' }) },
      { id: 'goto:settings', label: 'Settings', link: linkOptions({ to: '/settings' }) },
    ],
    [],
  );
  usePaletteActions(actions);
  usePaletteItems('goto', places);
  return <h1>Home</h1>;
};

const renderPalette = (onPublish = vi.fn()) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(queryKeys.me, null);
  queryClient.setQueryData(queryKeys.schema.definitions('model'), []);
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <CommandPalette />
      </>
    ),
  });
  const routes = ['/media', '/settings'].map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => <h1>{path}</h1> }),
  );
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <Screen onPublish={onPublish} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, ...routes]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, onPublish };
};

afterEach(() => {
  act(() => usePaletteStore.getState().setOpen(false));
  window.localStorage.clear();
});

const openWithShortcut = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findByRole('heading', { name: 'Home' });
  await user.keyboard('{Control>}k{/Control}');
  const dialog = await screen.findByRole('dialog', { name: 'Search and commands' });
  const input = await screen.findByRole('combobox', { name: /Search places/ });
  await waitFor(() => expect(document.activeElement).toBe(input));
  return { dialog, input };
};

describe('CommandPalette', () => {
  it('opens with Ctrl+K as a dialog with a combobox and a grouped listbox, page actions first', async () => {
    const user = userEvent.setup();
    renderPalette();
    const { input } = await openWithShortcut(user);
    const listbox = screen.getByRole('listbox', { name: 'Results' });
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    expect(screen.getByRole('group', { name: 'On this page' })).toBeDefined();
    expect(screen.getByRole('group', { name: 'Go to' })).toBeDefined();
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Publish entry', 'Media', 'Settings']);
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('moves with the arrows and goes to the chosen place with Enter, remembering it', async () => {
    const user = userEvent.setup();
    const { router } = renderPalette();
    const { input } = await openWithShortcut(user);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const settings = screen.getByRole('option', { name: 'Settings' });
    expect(input.getAttribute('aria-activedescendant')).toBe(settings.id);
    await user.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Publish entry' }).id,
    );
    await user.keyboard('{ArrowUp}{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(readRecentItems().map(({ label }) => label)).toEqual(['Settings']);
  });

  it('filters as you type and runs page actions', async () => {
    const user = userEvent.setup();
    const { onPublish } = renderPalette();
    await openWithShortcut(user);
    await user.keyboard('pub');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Publish entry']);
    await user.keyboard('{Enter}');
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says when nothing matches, and closes with Escape', async () => {
    const user = userEvent.setup();
    renderPalette();
    await openWithShortcut(user);
    await user.keyboard('zzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect((await screen.findAllByText('Nothing found for “zzz”')).length).toBeGreaterThan(0);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
