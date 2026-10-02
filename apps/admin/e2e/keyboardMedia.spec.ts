import { expect, test, type Page } from '@playwright/test';
import type { AdminApi } from './content/api';
import type { ProjectServer } from './content/projectServer';
import {
  expectFocusTrappedIn,
  expectFullTabCycle,
  inBothSchemes,
  resetFocusToTop,
  tabTo,
} from './support/keyboard';
import { createKeyboardHelpers, openKeyboardSuite } from './support/keyboardSuite';
import { createPng } from './support/png';

/**
 * Keyboard-only use of the media library: upload, browse, edit alt text and close. After the first
 * page.goto nothing is clicked: only Tab, arrows, Enter, Space and Escape. Every focus stop must show a
 * visible indicator in light and dark, Tab must cycle through the page without a trap, the details sheet
 * must hold focus until Escape, and focus must return to the control that opened it. Runs on its own
 * server (a fresh database).
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

type Asset = { id: string; filename: string; alt: string | null };

let server: ProjectServer;
let page: Page;
let api: AdminApi;
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  ({ server, page, api } = await openKeyboardSuite(browser, 'keyboardMedia', pageErrors));
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page?.context().close();
  await server?.stop();
});

const { escapeBackTo } = createKeyboardHelpers(() => page);

test('media library: upload, browse, edit alt text and close with the keyboard only', async () => {
  await page.goto(`${server.adminUrl}media`);
  await expect(page.getByRole('heading', { level: 1, name: 'Media' })).toBeVisible();
  const upload = page.getByRole('button', { name: 'Upload', exact: true });
  await resetFocusToTop(page);
  await tabTo(page, upload, { max: 40 });
  for (const name of ['kb-meadow.png', 'kb-castle.png']) {
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: createPng(640, 480) });
    await expect(page.getByRole('button', { name: `Open ${name}` })).toBeVisible({ timeout: 20_000 });
    await expect(upload).toBeFocused();
  }
  await inBothSchemes(page, () => expectFullTabCycle(page));

  // Tab moves through the assets: each card's open button, then its selection checkbox.
  await resetFocusToTop(page);
  const cards = page.getByRole('list', { name: /files?$/ }).getByRole('button', { name: /^Open / });
  await tabTo(page, cards.first(), { max: 60 });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name: /^Select / }).first()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cards.nth(1)).toBeFocused();
  const meadow = page.getByRole('button', { name: 'Open kb-meadow.png' });
  if (!(await meadow.evaluate((element) => element === document.activeElement))) {
    await tabTo(page, meadow, { max: 6, backwards: true });
  }
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'kb-meadow.png' });
  await expect(sheet).toBeVisible();
  await inBothSchemes(page, () => expectFocusTrappedIn(page, sheet, { max: 60 }));
  const alt = sheet.getByLabel('Alt text');
  await tabTo(page, alt, { max: 30 });
  await page.keyboard.type('Green meadow at dawn');
  await tabTo(page, sheet.getByRole('button', { name: 'Save changes' }), { max: 10 });
  await page.keyboard.press('Enter');
  await expect(page.getByText('Details saved').first()).toBeVisible();
  await escapeBackTo(sheet, meadow);

  const assets = await api.get<{ items: Asset[] }>('/media/assets?search=kb-meadow');
  expect(assets.items.find((asset) => asset.filename === 'kb-meadow.png')?.alt).toBe('Green meadow at dawn');
});
