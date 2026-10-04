import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { adminApiFor, type AdminApi } from './content/api';
import { captureRendered } from './support/capture';
import { ADMIN_URL, SCREENSHOT_DIR } from './support/constants';
import { ADMIN_API, signInAsOwner } from './support/session';

/**
 * Named themes (docs/plans/themes.md): each built-in theme is picked from the account menu and kept across a
 * reload; single-variant themes ignore the appearance and lock the quick switch; and the sign-in screen,
 * the Inbox, an entry document and a place's Structure tab pass axe in every theme and variant.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const THEMES = [
  { key: 'shapio', name: 'Shapio', variants: ['light', 'dark'] },
  { key: 'classic', name: 'Classic', variants: ['light', 'dark'] },
  { key: 'murdered-out', name: 'Murdered out', variants: ['dark'] },
  { key: 'snowed', name: 'Snowed', variants: ['light'] },
] as const;

const MODEL = { apiKey: 'themeNote', label: 'Theme note' };

let page: Page;
let api: AdminApi;
let entryId = '';
const pageErrors: string[] = [];

const openPage = async (browser: Browser) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const opened = await context.newPage();
  opened.on('pageerror', (error) => pageErrors.push(error.message));
  return opened;
};

/** Saves a theme the way the store does (version 2), then reloads: the pre-paint script applies it. */
const applyStoredTheme = async (on: Page, key: string, variants: readonly string[], appearance: string) => {
  await on.evaluate(
    (state) => window.localStorage.setItem('shapio.theme', JSON.stringify({ state, version: 2 })),
    { theme: key, appearance, variants },
  );
  await on.reload();
};

const html = (on: Page) => on.locator('html');

const expectRendered = async (on: Page, key: string, variant: string) => {
  await expect(html(on)).toHaveAttribute('data-theme', key);
  await expect(html(on)).toHaveClass(variant === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b).*$/);
};

test.beforeAll(async ({ browser }) => {
  page = await openPage(browser);
  await signInAsOwner(page);
  api = adminApiFor(page.request, ADMIN_API);
  await api.createDefinition('models', {
    kind: 'collection',
    apiKey: MODEL.apiKey,
    label: MODEL.label,
    fields: [
      { apiKey: 'title', label: 'Title', type: 'string' },
      { apiKey: 'body', label: 'Body', type: 'text' },
    ],
  });
  const entry = await api.send<{ id: string }>('POST', `/content/${MODEL.apiKey}`, {
    data: { title: 'Theme sampler', body: 'Every theme, every variant.' },
  });
  entryId = entry.id;
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

/** Leaves the shared server as it was: later specs list the models. */
test.afterAll(async () => {
  if (entryId) {
    await api.send('DELETE', `/content/${MODEL.apiKey}/${entryId}`);
  }
  const models = await api.get<{ items: { version: number; definition: { id: string; apiKey: string } }[] }>(
    '/models',
  );
  const model = models.items.find(({ definition }) => definition.apiKey === MODEL.apiKey);
  if (model) {
    await api.send('DELETE', `/models/${model.definition.id}?expectedVersion=${model.version}`);
  }
  await page.context().close();
});

const chooseFromAccountMenu = async (group: 'Theme' | 'Colour mode', name: string) => {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Theme' }).hover();
  await page.getByRole('group', { name: group }).getByRole('menuitemradio', { name, exact: true }).click();
};

test('a stored pre-theme setting becomes Classic with the same appearance', async () => {
  await page.goto(ADMIN_URL);
  await page.evaluate(() =>
    window.localStorage.setItem(
      'shapio.theme',
      JSON.stringify({ state: { preference: 'dark' }, version: 1 }),
    ),
  );
  await page.reload();
  await expectRendered(page, 'classic', 'dark');
  await page.evaluate(() => window.localStorage.removeItem('shapio.theme'));
  await page.reload();
  await page.emulateMedia({ colorScheme: 'light' });
  await expectRendered(page, 'shapio', 'light');
});

test('each theme is picked from the account menu and kept across a reload', async () => {
  await page.goto(ADMIN_URL);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const footer = page.locator('[data-slot="sidebar-footer"]');
  for (const theme of THEMES) {
    await chooseFromAccountMenu('Theme', theme.name);
    await page.keyboard.press('Escape');
    const variant = theme.variants.length === 1 ? theme.variants[0] : 'light';
    await expectRendered(page, theme.key, variant);
    await page.reload();
    await expectRendered(page, theme.key, variant);
    if (theme.variants.length === 1) {
      // The appearance does nothing here: the quick switch says why and changes nothing.
      const locked = footer.getByRole('button', { name: `${theme.name} has a ${variant} version only.` });
      await expect(locked).toHaveAttribute('aria-disabled', 'true');
      await locked.focus();
      await page.keyboard.press('Enter');
      await expectRendered(page, theme.key, variant);
    } else {
      await footer.getByRole('button', { name: 'Switch to dark theme' }).click();
      await expectRendered(page, theme.key, 'dark');
      await chooseFromAccountMenu('Colour mode', 'System');
      await expectRendered(page, theme.key, 'light');
    }
  }
  await chooseFromAccountMenu('Theme', 'Shapio');
  await expectRendered(page, 'shapio', 'light');
});

test('the picker: the account menu and Settings → Appearance', async () => {
  await page.goto(`${ADMIN_URL}settings/theme`);
  await expect(page.getByRole('heading', { level: 1, name: 'Appearance' })).toBeVisible();
  await page.getByRole('radio', { name: 'Murdered out' }).click();
  await expectRendered(page, 'murdered-out', 'dark');
  await expect(page.getByRole('radio', { name: 'Light', exact: true })).toBeDisabled();
  await captureRendered(page, 'appearance-settings-murdered-out');
  await page.getByRole('radio', { name: 'Shapio' }).click();
  await expect(page.getByRole('radio', { name: 'Light', exact: true })).toBeEnabled();
  await captureRendered(page, 'appearance-settings-shapio');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Theme' }).hover();
  await expect(page.getByRole('menuitemradio', { name: 'Shapio' })).toHaveAttribute('aria-checked', 'true');
  // A screenshot only: with a menu open, Radix hides the page behind it (axe would flag the page, not us).
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'appearance-menu.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

const SCREENS = [
  {
    name: 'inbox',
    path: '',
    ready: (on: Page) => on.getByRole('heading', { level: 1 }),
  },
  {
    name: 'entry',
    path: () => `content/${MODEL.apiKey}/${entryId}`,
    ready: (on: Page) => on.getByText('Theme sampler').first(),
  },
  {
    name: 'structure',
    path: `content/${MODEL.apiKey}?tab=structure`,
    ready: (on: Page) => on.getByRole('region', { name: 'Fields' }),
  },
] as const;

for (const theme of THEMES) {
  test(`axe passes in ${theme.name} (${theme.variants.join(' and ')})`, async ({ browser }) => {
    for (const variant of theme.variants) {
      for (const screen of SCREENS) {
        const path = typeof screen.path === 'function' ? screen.path() : screen.path;
        await page.goto(`${ADMIN_URL}${path}`);
        await applyStoredTheme(page, theme.key, theme.variants, variant);
        await expectRendered(page, theme.key, variant);
        await expect(screen.ready(page)).toBeVisible();
        await captureRendered(page, `theme-${theme.key}-${variant}-${screen.name}`);
      }
      // Signed out: the brand panel in the theme's colours.
      const signedOut = await openPage(browser);
      await signedOut.goto(ADMIN_URL);
      await applyStoredTheme(signedOut, theme.key, theme.variants, variant);
      await expect(signedOut.getByRole('button', { name: 'Sign in' })).toBeVisible();
      await expectRendered(signedOut, theme.key, variant);
      await captureRendered(signedOut, `theme-${theme.key}-${variant}-sign-in`);
      await signedOut.context().close();
    }
  });
}
