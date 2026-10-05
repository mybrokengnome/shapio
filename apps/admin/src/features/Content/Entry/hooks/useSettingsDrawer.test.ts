// @vitest-environment jsdom
import '@/test/dom';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '@/stores/ui';
import { useSettingsDrawer } from './useSettingsDrawer';

const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');

const setWide = (wide: boolean) => {
  window.matchMedia = (query: string) =>
    ({
      matches: wide,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
};

beforeEach(() => act(() => useUiStore.getState().setEntrySettingsOpen(true)));
afterEach(() => {
  if (original) {
    Object.defineProperty(window, 'matchMedia', original);
  }
});

describe('useSettingsDrawer', () => {
  it('opens by default on wide screens without counting as the person opening it', () => {
    setWide(true);
    const { result } = renderHook(() => useSettingsDrawer());
    expect(result.current.open).toBe(true);
    expect(result.current.automatic).toBe(true);
    act(() => result.current.openAt({ section: 'properties', property: 'excerpt' }));
    expect(result.current.automatic).toBe(false);
    expect(result.current.expanded.has('excerpt')).toBe(true);
  });

  it('remembers a close on wide screens', () => {
    setWide(true);
    const first = renderHook(() => useSettingsDrawer());
    act(() => first.result.current.toggle());
    expect(first.result.current.open).toBe(false);
    expect(useUiStore.getState().entrySettingsOpen).toBe(false);
    first.unmount();
    const next = renderHook(() => useSettingsDrawer());
    expect(next.result.current.open).toBe(false);
  });

  it('makes room for the preview without changing the remembered choice', () => {
    setWide(true);
    const { result } = renderHook(() => useSettingsDrawer());
    act(() => result.current.hideForPreview());
    expect(result.current.open).toBe(false);
    expect(useUiStore.getState().entrySettingsOpen).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
  });

  it('starts closed below wide and leaves the remembered choice alone', () => {
    setWide(false);
    const { result } = renderHook(() => useSettingsDrawer());
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    act(() => result.current.setOpen(false));
    expect(useUiStore.getState().entrySettingsOpen).toBe(true);
  });

  it('stays open when the window narrows', () => {
    setWide(true);
    const { result, rerender } = renderHook(() => useSettingsDrawer());
    expect(result.current.open).toBe(true);
    setWide(false);
    rerender();
    expect(result.current.open).toBe(true);
  });
});
