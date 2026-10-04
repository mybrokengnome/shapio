import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { adminApiFor, type AdminApi } from './content/api';
import { captureRendered } from './support/capture';
import { ADMIN_URL, SCREENSHOT_DIR } from './support/constants';
import { ADMIN_API, signInAsOwner } from './support/session';

/**
 * Looks (docs/plans/themes.md): every built-in theme is one look, picked from the account menu or Settings →
 * Appearance and kept across a reload; nothing follows the OS; and the sign-in screen, the Inbox, an entry
 * document and a place's Structure tab pass axe in every look.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const THEMES = [
  { key: 'shapio', name: 'Shapio', variant: 'dark' },
  { key: 'classic', name: 'Cobalt', variant: 'dark' },
  { key: 'murdered-out', name: 'Murdered out', variant: 'dark' },
  { key: 'forest', name: 'Forest', variant: 'dark' },
  { key: 'snowed', name: 'Snowed', variant: 'light' },
  { key: 'butter', name: 'Butter', variant: 'light' },
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

/** Saves a stored value (by default a look, the way the store does), then reloads: the pre-paint script applies it. */
const applyStored = async (on: Page, state: unknown, version = 3) => {
  await on.evaluate((stored) => window.localStorage.setItem('shapio.theme', JSON.stringify(stored)), {
    state,
    version,
  });
  await on.reload();
};

const applyStoredLook = (on: Page, key: string, variant: string) =>
  applyStored(on, { theme: key, appearance: variant, variants: [variant] });

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

const openThemeMenu = async () => {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Theme' }).hover();
};

const chooseFromAccountMenu = async (name: string) => {
  await openThemeMenu();
  await page.getByRole('group', { name: 'Theme' }).getByRole('menuitemradio', { name, exact: true }).click();
};

test('stored values: pre-theme becomes Cobalt, colour modes become the look, nothing follows the OS', async () => {
  await page.goto(ADMIN_URL);
  await applyStored(page, { preference: 'light' }, 1);
  await expectRendered(page, 'classic', 'dark');
  await applyStored(page, { theme: 'shapio', appearance: 'light', variants: ['light', 'dark'] }, 2);
  await expectRendered(page, 'shapio', 'dark');
  await applyStored(page, { theme: 'snowed', appearance: 'system', variants: ['light'] }, 2);
  await expectRendered(page, 'snowed', 'light');
  await page.evaluate(() => window.localStorage.removeItem('shapio.theme'));
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.reload();
    await expectRendered(page, 'shapio', 'dark');
  }
});

test('each look is picked from the account menu and kept across a reload', async () => {
  await page.goto(ADMIN_URL);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  for (const theme of THEMES) {
    await chooseFromAccountMenu(theme.name);
    await page.keyboard.press('Escape');
    await expectRendered(page, theme.key, theme.variant);
    await page.reload();
    await expectRendered(page, theme.key, theme.variant);
  }
  // One list of looks, nothing else: no colour mode, no quick switch.
  await expect(page.getByRole('button', { name: /Switch to (light|dark) theme/ })).toHaveCount(0);
  await openThemeMenu();
  await expect(page.getByRole('menuitemradio')).toHaveCount(THEMES.length);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await chooseFromAccountMenu('Shapio');
  await expectRendered(page, 'shapio', 'dark');
});

test('the picker: Settings → Appearance and the account menu', async () => {
  await page.goto(`${ADMIN_URL}settings/theme`);
  await expect(page.getByRole('heading', { level: 1, name: 'Appearance' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(THEMES.length);
  for (const look of ['Shapio', 'Murdered out'] as const) {
    const theme = THEMES.find(({ name }) => name === look);
    await page.getByRole('radio', { name: look }).click();
    await expectRendered(page, theme?.key ?? '', theme?.variant ?? '');
    await expect(page.getByRole('radio', { name: look })).toBeChecked();
    await captureRendered(page, `appearance-settings-${theme?.key}`);
    await openThemeMenu();
    await expect(page.getByRole('menuitemradio', { name: look })).toHaveAttribute('aria-checked', 'true');
    // A screenshot only: with a menu open, Radix hides the page behind it (axe would flag the page, not us).
    await page.screenshot({ path: join(SCREENSHOT_DIR, `appearance-menu-${theme?.key}.png`) });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
  // Murdered out is all dark: the profile's buttons are dark fills, not white pills.
  await page.goto(`${ADMIN_URL}settings/profile`);
  await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
  await captureRendered(page, 'profile-murdered-out');
  await chooseFromAccountMenu('Shapio');
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
  test(`axe passes in ${theme.name}`, async ({ browser }) => {
    for (const screen of SCREENS) {
      const path = typeof screen.path === 'function' ? screen.path() : screen.path;
      await page.goto(`${ADMIN_URL}${path}`);
      await applyStoredLook(page, theme.key, theme.variant);
      await expectRendered(page, theme.key, theme.variant);
      await expect(screen.ready(page)).toBeVisible();
      await captureRendered(page, `theme-${theme.key}-${screen.name}`);
    }
    // Signed out: the brand panel in the look's colours.
    const signedOut = await openPage(browser);
    await signedOut.goto(ADMIN_URL);
    await applyStoredLook(signedOut, theme.key, theme.variant);
    await expect(signedOut.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expectRendered(signedOut, theme.key, theme.variant);
    await captureRendered(signedOut, `theme-${theme.key}-sign-in`);
    await signedOut.context().close();
  });
}
