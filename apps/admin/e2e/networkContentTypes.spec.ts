import { expect, test, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { expectVisibleFocus, inBothSchemes } from './support/keyboard';
import { signInAsOwner } from './support/session';
import { siteApi } from './support/sites';

/**
 * Network → Content types against the real API: the content types and components shared with all sites,
 * creating one there (shared, no "Available on" choice) and opening it in the builder. Captured in light and
 * dark with axe; the page's actions work from the keyboard with a visible focus.
 */
test.describe.configure({ mode: 'serial' });

const PROMO = { key: 'promo', label: 'Promo' };

let page: Page;
let promoId = '';
const pageErrors: string[] = [];

const owner = () => siteApi(page.request);
const nav = () => page.getByRole('navigation', { name: 'Main navigation' });

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  if (promoId) {
    const { version } = await owner().get<{ version: number }>(`/models/${promoId}`);
    await owner().send('DELETE', `/models/${promoId}?expectedVersion=${version}`);
  }
  await page.context().close();
});

test('the network view lists shared content types and creates one, shared', async () => {
  await page.goto(`${ADMIN_URL}network`);
  await nav().getByRole('link', { name: 'Content types', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/network\/content-types$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Content types' })).toBeVisible();

  await page.getByRole('link', { name: 'New shared type' }).first().click();
  await expect(page).toHaveURL(/\/admin\/network\/content-types\/new$/);
  await expect(page.getByRole('heading', { level: 1, name: 'New shared content type' })).toBeVisible();
  const form = page.getByRole('main');
  // All three kinds; where it lives isn't a choice here.
  await expect(form.getByRole('radio')).toHaveCount(3);
  await expect(form.getByRole('group', { name: 'Available on' })).toHaveCount(0);
  await form.getByLabel('Label', { exact: true }).fill(PROMO.label);
  await captureScreen(page, 'network-content-types-01-new', { viewports: ['desktop', 'phone'] });
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Created — no restart needed.').first()).toBeVisible();
  // It opens in the builder, on a site.
  await expect(page).toHaveURL(new RegExp(`/admin/s/default/content/${PROMO.key}\\?tab=structure$`));
  await expect(page.getByRole('heading', { level: 1, name: PROMO.label })).toBeVisible();

  const shared = await owner().get<{ items: { definition: { id: string; apiKey: string } }[] }>(
    '/models?scope=network',
  );
  promoId = shared.items.find(({ definition }) => definition.apiKey === PROMO.key)?.definition.id ?? '';
  expect(promoId).not.toBe('');

  await page.goto(`${ADMIN_URL}network/content-types`);
  const row = page.getByRole('row').filter({ hasText: PROMO.label });
  await expect(row).toContainText('Collection');
  await expect(row).toContainText(PROMO.key);
  await captureScreen(page, 'network-content-types-02-list', { viewports: ['desktop', 'phone'] });

  // The row opens the builder.
  await row.getByRole('link', { name: PROMO.label }).click();
  await expect(page).toHaveURL(new RegExp(`/content/${PROMO.key}\\?tab=structure$`));
});

test('the page works from the keyboard with a visible focus in both themes', async () => {
  await page.goto(`${ADMIN_URL}network/content-types`);
  const create = page.getByRole('link', { name: 'New shared type' }).first();
  await inBothSchemes(page, async () => {
    await create.focus();
    await expectVisibleFocus(page, 'new shared type');
    const link = page
      .getByRole('row')
      .filter({ hasText: PROMO.label })
      .getByRole('link', { name: PROMO.label });
    await link.focus();
    await expectVisibleFocus(page, 'shared type row');
  });
  await create.press('Enter');
  await expect(page).toHaveURL(/\/admin\/network\/content-types\/new$/);
});
