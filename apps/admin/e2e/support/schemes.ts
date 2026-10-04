import type { Page } from '@playwright/test';

type Scheme = 'light' | 'dark';

/**
 * The admin no longer follows the OS: a person picks one look. Screens are still captured light and dark, in
 * the look that stands for each: Snowed (light) and Shapio (dark, the default).
 */
const LOOK_FOR_SCHEME = { light: 'snowed', dark: 'shapio' } as const satisfies Record<Scheme, string>;

type RenderedLook = { theme: string | null; dark: boolean };

const setRenderedLook = (page: Page, look: RenderedLook) =>
  page.evaluate(({ theme, dark }) => {
    const root = document.documentElement;
    if (theme === null) {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
    root.classList.toggle('dark', dark);
  }, look);

/**
 * Renders `scheme`'s look on <html> without touching the saved look (no reload, so open dialogs and menus
 * stay open); returns a function that puts back what was rendered before.
 */
export const renderScheme = async (page: Page, scheme: Scheme) => {
  const before = await page.evaluate((): RenderedLook => ({
    theme: document.documentElement.getAttribute('data-theme'),
    dark: document.documentElement.classList.contains('dark'),
  }));
  await setRenderedLook(page, { theme: LOOK_FOR_SCHEME[scheme], dark: scheme === 'dark' });
  return () => setRenderedLook(page, before);
};
