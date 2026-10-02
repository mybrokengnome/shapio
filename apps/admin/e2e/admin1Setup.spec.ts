import { expect, test, type Page } from '@playwright/test';
import { OWNER } from './support/accounts';
import { captureScreen, type ViewportName } from './support/capture';
import { ADMIN_URL } from './support/constants';

/**
 * First-run setup against the real API: the admin sends the first visitor to setup, validates inline, and
 * creates the owner. Every other spec relies on this running first.
 * The admin*.spec.ts files run in name order (Playwright sorts files): admin1Setup does first-run setup,
 * admin3Team sends the invitation admin4Auth accepts.
 */
test.describe.configure({ mode: 'serial' });

const AUTH_VIEWPORTS: ViewportName[] = ['desktop', 'phone'];

let page: Page;
/** Uncaught exceptions in the admin fail the test that caused them. */
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  // axe needs a page from an explicit context.
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page.context().close();
});

test('first run: the admin sends visitors to setup', async () => {
  await page.goto(ADMIN_URL);
  await expect(page).toHaveURL(/\/cms\/admin\/setup$/);
  await expect(page.getByRole('heading', { name: 'Set up Shapio' })).toBeVisible();
  await captureScreen(page, 'auth-01-setup', { viewports: AUTH_VIEWPORTS });
});

test('setup validates inline before calling the API', async () => {
  await page.getByRole('button', { name: 'Create owner account' }).click();
  await expect(page.getByText('This field is required.').first()).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Create owner account' }).click();
  await expect(page.getByText('Use at least 12 characters.')).toBeVisible();
  await captureScreen(page, 'auth-02-setup-errors');
});

test('setup creates the owner and opens the shell', async () => {
  // No setup token by default (SETUP_REQUIRE_TOKEN unset): the first visitor creates the owner.
  await expect(page.getByLabel('Setup token')).toHaveCount(0);
  await page.getByLabel('Name').fill(OWNER.name);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
  await page.getByLabel('Confirm password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Create owner account' }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${OWNER.name}` })).toBeVisible();
  await expect(page).toHaveURL(/\/cms\/admin\/$/);
  await captureScreen(page, '03-home');
});
