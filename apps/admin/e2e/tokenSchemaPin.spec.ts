import { expect, test, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { adminRequest, signInAsOwner } from './support/session';

/**
 * Pinning an API token to a schema version (plan schema-lenses): the token's edit sheet pins it to the
 * current version with one click, the list says "Pinned to schema version N", and clearing the field takes
 * the token back to today's shape. Captured at 1440 and 390 in light and dark with axe.
 */
test.describe.configure({ mode: 'serial' });

const TOKEN_NAME = 'Pinned kiosk app';
const BOTH = { viewports: ['desktop', 'phone'] } as const;

let page: Page;
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  // A schema change, so there is a schema version to pin to.
  await adminRequest(page.request, 'POST', '/models', {
    definition: {
      kind: 'collection',
      apiKey: 'pinKioskSlide',
      label: 'Kiosk slide',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    },
  });
  const role = await adminRequest(page.request, 'POST', '/roles', {
    key: 'pin-kiosk-reader',
    name: 'Kiosk reader',
    kind: 'delivery',
    permissions: [],
  });
  const roleId = ((await role.json()) as { id: string }).id;
  await adminRequest(page.request, 'POST', '/tokens', { name: TOKEN_NAME, roleId });
});

test.afterAll(async () => {
  expect(pageErrors).toEqual([]);
  await page.context().close();
});

const openEditSheet = async () => {
  await page.getByRole('button', { name: `Edit: ${TOKEN_NAME}` }).click();
  const sheet = page.getByRole('dialog', { name: `Edit ${TOKEN_NAME}` });
  await expect(sheet).toBeVisible();
  return sheet;
};

test('pins a token to the current schema version and clears the pin', async () => {
  await page.goto(`${ADMIN_URL}settings/api-tokens`);
  const row = page.getByRole('row', { name: new RegExp(TOKEN_NAME) });
  await expect(row).toBeVisible();
  await expect(row.getByText(/^Pinned to schema version/)).toHaveCount(0);

  const sheet = await openEditSheet();
  const field = sheet.getByRole('textbox', { name: 'Schema version' });
  await expect(field).toHaveValue('');
  await expect(field).toHaveAttribute('placeholder', 'Always the current schema');
  const pinCurrent = sheet.getByRole('button', { name: /^Pin to the current version \(\d+\)$/ });
  const version = Number(/\((\d+)\)/.exec((await pinCurrent.textContent()) ?? '')?.[1]);
  expect(version).toBeGreaterThan(0);
  await pinCurrent.click();
  await expect(field).toHaveValue(String(version));
  await captureScreen(page, 'token-pin-01-edit', BOTH);
  // What pinning does sits behind the label's info icon.
  await sheet.getByRole('button', { name: 'More about Schema version' }).click();
  await expect(
    page.locator('[data-slot=popover-content]').getByText(/A schema version the client sends wins/),
  ).toBeVisible();
  await captureScreen(page, 'token-pin-03-hint');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Save changes' }).click();
  await expect(sheet).toBeHidden();
  await expect(row.getByText(`Pinned to schema version ${version}`)).toBeVisible();
  await captureScreen(page, 'token-pin-02-list', BOTH);

  const again = await openEditSheet();
  const pinned = again.getByRole('textbox', { name: 'Schema version' });
  await expect(pinned).toHaveValue(String(version));
  await pinned.fill('');
  await again.getByRole('button', { name: 'Save changes' }).click();
  await expect(again).toBeHidden();
  await expect(row.getByText(/^Pinned to schema version/)).toHaveCount(0);
});

test('refuses a schema version the instance has not reached', async () => {
  await page.goto(`${ADMIN_URL}settings/api-tokens`);
  const sheet = await openEditSheet();
  await sheet.getByRole('textbox', { name: 'Schema version' }).fill('999999');
  await sheet.getByRole('button', { name: 'Save changes' }).click();
  await expect(sheet.getByText(/from 1 to the current schema version/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
});
