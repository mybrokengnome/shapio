import { expect, test, type Page } from '@playwright/test';
import { ADMIN_URL } from './support/constants';
import { entryDocument } from './support/entryDocument';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * A model that is not localized has no locale to publish: the admin must leave `locales` out of the
 * publish request (the API rejects an empty list). The model also has no title field configured, so the
 * entry is labelled by its first text field instead of "Untitled".
 */
test.describe.configure({ mode: 'serial' });

const MODEL_KEY = 'quickNote';

let page: Page;
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  await adminRequest(page.request, 'POST', '/models', {
    definition: {
      kind: 'collection',
      apiKey: MODEL_KEY,
      label: 'Quick note',
      fields: [{ apiKey: 'heading', label: 'Heading', type: 'string' }],
    },
  });
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page.context().close();
});

test('an entry of a non-localized model is created and published from the document', async () => {
  const doc = entryDocument(page);
  await page.goto(`${ADMIN_URL}content/${MODEL_KEY}`);
  await page.getByRole('link', { name: 'New', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'New Quick note' })).toBeVisible();
  await page.locator('[data-field-path="/heading"]').getByRole('textbox').fill('Groceries');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/content/${MODEL_KEY}/[0-9a-f-]{36}`));
  await doc.openSettings();
  await expect(page.getByRole('button', { name: 'Unpublish' })).toHaveCount(0);
  const entryId = new RegExp(`/content/${MODEL_KEY}/([0-9a-f-]{36})`).exec(page.url())?.[1] ?? '';
  await doc.closeSettings();
  // No title field is configured: the first text field labels the entry.
  await expect(page.getByRole('heading', { level: 1, name: 'Groceries' })).toBeVisible();

  const published = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith(`/${entryId}/publish`),
  );
  // Publish opens the pre-flight; its checks are requested without locales too.
  const preflight = await doc.openPreflight();
  await preflight.getByRole('button', { name: 'Publish now' }).click();
  const response = await published;
  expect(response.status(), await response.text()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({});
  await expect(page.getByText('Published.')).toBeVisible();
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();

  const entry = (await (await page.request.get(`${ADMIN_API}/content/${MODEL_KEY}/${entryId}`)).json()) as {
    status: string;
  };
  expect(entry.status).toBe('published');

  // Nothing new to publish: the header's primary action says so and is disabled.
  await expect(page.getByRole('button', { name: 'Published', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);

  await page.goto(`${ADMIN_URL}content/${MODEL_KEY}`);
  const row = page.getByRole('table').getByRole('row').nth(1);
  await expect(row).toContainText('Groceries');
  await expect(row).toContainText('Published');
  await expect(row).not.toContainText('Untitled');

  // Reopened, the entry is still up to date; an edit makes it publishable again.
  await page.goto(`${ADMIN_URL}content/${MODEL_KEY}/${entryId}`);
  await expect(page.getByRole('button', { name: 'Published', exact: true })).toBeDisabled();
  // Unpublish sits in the settings drawer while the entry is live, asks in place, and takes it off the API.
  const unpublished = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith(`/${entryId}/unpublish`),
  );
  const drawer = await doc.openSettings();
  await drawer.getByRole('button', { name: 'Unpublish' }).click();
  await page
    .getByRole('alertdialog', { name: 'Unpublish this locale?' })
    .getByRole('button', { name: 'Unpublish' })
    .click();
  expect((await unpublished).request().postDataJSON()).toEqual({});
  await expect(page.getByText('Unpublished. It is no longer served by the API.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unpublish' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
  await page.locator('[data-field-path="/heading"]').getByRole('textbox').fill('Groceries and more');
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Published', exact: true })).toHaveCount(0);
});
