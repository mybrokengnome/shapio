import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll } from 'vitest';
import { initI18n } from '@/app/i18n';

/**
 * Setup for component tests that run in jsdom (`// @vitest-environment jsdom`): English translations,
 * cleanup between tests, and the browser APIs Radix uses that jsdom lacks (ResizeObserver for Popper,
 * pointer capture and scrollIntoView for menus). Import it first in the test file.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof window !== 'undefined') {
  window.ResizeObserver ??= ResizeObserverStub;
  const stubs: Record<string, () => unknown> = {
    hasPointerCapture: () => false,
    releasePointerCapture: () => undefined,
    scrollIntoView: () => undefined,
  };
  for (const [name, stub] of Object.entries(stubs)) {
    if (!(name in Element.prototype)) {
      Object.defineProperty(Element.prototype, name, { value: stub, configurable: true, writable: true });
    }
  }
  if (!Reflect.has(window, 'matchMedia')) {
    const matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true, writable: true });
  }
}

beforeAll(async () => {
  await initI18n();
});

afterEach(() => {
  cleanup();
});
