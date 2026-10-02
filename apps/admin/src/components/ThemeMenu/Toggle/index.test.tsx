// @vitest-environment jsdom
import '@/test/dom';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { type ThemePreference, useThemeStore } from '@/stores/theme';
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

const setPreference = (preference: ThemePreference) =>
  act(() => useThemeStore.getState().setPreference(preference));

beforeEach(() => setPreference('system'));

describe('ThemeToggle', () => {
  it('switches an explicit light theme to dark and back', async () => {
    const user = userEvent.setup();
    stubSystemDark(false);
    setPreference('light');
    render(<ThemeToggle />);
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(useThemeStore.getState().preference).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(useThemeStore.getState().preference).toBe('light');
  });

  it('on "system", switches to the opposite of what the OS renders', async () => {
    const user = userEvent.setup();
    stubSystemDark(true);
    render(<ThemeToggle />);
    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(useThemeStore.getState().preference).toBe('light');
  });

  it('on "system" with a light OS, switches to dark', async () => {
    const user = userEvent.setup();
    stubSystemDark(false);
    render(<ThemeToggle />);
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(useThemeStore.getState().preference).toBe('dark');
  });

  it('follows a preference set elsewhere (the account menu)', () => {
    stubSystemDark(false);
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy();
    setPreference('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy();
  });
});
