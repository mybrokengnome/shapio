import { expect, test, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { adminRequest, signInAsOwner } from './support/session';

/**
 * A model without fields: its entry document points to its Structure tab. Adding the first text field there
 * makes it the title field, so entries are not "Untitled". A new field's properties fit at phone width.
 */
test.describe.configure({ mode: 'serial' });

const MODEL_KEY = 'emptyShelf';

let page: Page;
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  await adminRequest(page.request, 'POST', '/models', {
    definition: { kind: 'collection', apiKey: MODEL_KEY, label: 'Empty shelf', fields: [] },
  });
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page.context().close();
});

const properties = () => page.getByRole('region', { name: / properties$/ });

/** "Add field" adds a field at once with its label focused and selected: type the name, pick the type. */
const addField = async (label: string, type: RegExp) => {
  await page.getByRole('button', { name: 'Add field' }).click();
  await expect(properties().getByLabel('Label', { exact: true })).toBeFocused();
  await page.keyboard.type(label);
  await properties().getByRole('radio', { name: type }).check();
};

test('an entry document without fields links to the structure of its content type', async () => {
  await page.goto(`${ADMIN_URL}content/${MODEL_KEY}/new`);
  await expect(page.getByText('Nothing to write here yet')).toBeVisible();
  await captureScreen(page, 'polish-01-entry-no-fields', { viewports: ['desktop'] });
  await page.getByRole('link', { name: 'Add fields' }).click();
  await expect(page).toHaveURL(/tab=structure/);
  await expect(page.getByRole('heading', { level: 1, name: 'Empty shelf' })).toBeVisible();
});

test('the first text field becomes the title field', async () => {
  await addField('Featured', /^Boolean/);
  await page.getByRole('button', { name: 'Model settings' }).click();
  await expect(page.getByRole('combobox', { name: 'Title field' })).toHaveText('Not set');
  await addField('Name', /^Short text/);
  // Model settings stay expanded.
  await expect(page.getByRole('combobox', { name: 'Title field' })).toHaveText('Name');
});

test('a new field at phone width: scrolled into view, label focused, type grid below the list', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Add field' }).click();
  const panel = page.getByRole('region', { name: 'New field properties' });
  const label = panel.getByLabel('Label', { exact: true });
  await expect(label).toBeFocused();
  await expect(label).toBeInViewport();
  await expect(panel.getByRole('radio', { name: /^Short text/ })).toBeChecked();
  const listBox = await page.getByRole('region', { name: 'Fields', exact: true }).boundingBox();
  const panelBox = await panel.boundingBox();
  expect(listBox && panelBox && listBox.y + listBox.height <= panelBox.y).toBe(true);
  await captureScreen(page, 'polish-02-new-field-phone');
  // Untouched, so Escape takes it away again.
  await label.focus();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.setViewportSize({ width: 1360, height: 900 });
});

test('the new content type page shows every API name an ID produces', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${ADMIN_URL}content/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'New content type' })).toBeVisible();
  const dialog = page.getByRole('main');
  await dialog.getByLabel('Label', { exact: true }).fill('Article');
  await expect(dialog.getByLabel('Plural API ID', { exact: true })).toHaveValue('articles');
  await expect(dialog.getByText('/api/content/articles', { exact: true })).toBeVisible();
  await expect(dialog.getByText('article', { exact: true })).toBeVisible();
  await expect(dialog.getByText('articles', { exact: true })).toBeVisible();
  await expect(dialog.getByText('articleCollection', { exact: true })).toHaveCount(0);
  await captureScreen(page, 'polish-03-new-model-names');
  await dialog.getByRole('radio', { name: 'Singleton' }).check();
  await expect(dialog.getByText('/api/content/article', { exact: true })).toBeVisible();
  await expect(dialog.getByText('article', { exact: true })).toBeVisible();
  await expect(dialog.getByText('articles', { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('Plural API ID', { exact: true })).toHaveCount(0);
  await dialog.getByRole('link', { name: 'Cancel' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard and leave' }).click();
  await expect(page).toHaveURL(/\/content(\/[A-Za-z]+)?$/);
  await page.setViewportSize({ width: 1360, height: 900 });
});
