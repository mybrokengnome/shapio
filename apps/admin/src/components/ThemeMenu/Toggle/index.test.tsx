// @vitest-environment jsdom
import '@/test/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { queryKeys } from '@/api/queryKeys';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Appearance } from '@/constants/themes';
import { useThemeStore } from '@/stores/theme';
import { ThemeToggle } from '.';

const stubSystemDark = (matches: boolean) => {
  const matchMedia = (query: string) =>
    ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
  Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true, writable: true });
};

/** The toggle reads the theme list (built-in plus the project's, none here). */
const renderToggle = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(queryKeys.extensionThemes, { items: [] });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeToggle />
      </TooltipProvider>
    </QueryClientProvider>,
  );
};

const setPreference = (appearance: Appearance) =>
  act(() => useThemeStore.getState().setAppearance(appearance));

beforeEach(() => {
  act(() => useThemeStore.getState().setTheme('shapio', ['light', 'dark']));
  setPreference('system');
});

describe('ThemeToggle', () => {
  it('switches an explicit light theme to dark and back', async () => {
    const user = userEvent.setup();
    stubSystemDark(false);
    setPreference('light');
    renderToggle();
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(useThemeStore.getState().appearance).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(useThemeStore.getState().appearance).toBe('light');
  });

  it('on "system", switches to the opposite of what the OS renders', async () => {
    const user = userEvent.setup();
    stubSystemDark(true);
    renderToggle();
    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(useThemeStore.getState().appearance).toBe('light');
  });

  it('on "system" with a light OS, switches to dark', async () => {
    const user = userEvent.setup();
    stubSystemDark(false);
    renderToggle();
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(useThemeStore.getState().appearance).toBe('dark');
  });

  it('is unavailable, with the reason, for a single-variant theme', async () => {
    const user = userEvent.setup();
    stubSystemDark(false);
    act(() => useThemeStore.getState().setTheme('murdered-out', ['dark']));
    renderToggle();
    const button = screen.getByRole('button', { name: 'Murdered out has a dark version only.' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await user.click(button);
    expect(useThemeStore.getState().appearance).toBe('system');
  });

  it('follows a preference set elsewhere (the account menu)', () => {
    stubSystemDark(false);
    renderToggle();
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy();
    setPreference('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy();
  });
});
