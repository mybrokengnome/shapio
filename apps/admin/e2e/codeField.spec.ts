import { expect, test, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { entryDocument } from './support/entryDocument';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * The `code` data type (docs/plans/code-field.md): added in the builder as JSON with "Require valid JSON",
 * edited in an entry with CodeMirror, saved and reloaded unchanged; text that does not parse shows the
 * error inline, and Tab leaves the editor as it does everywhere in the admin. Light and dark, axe clean.
 */
test.describe.configure({ mode: 'serial' });

const MODEL_KEY = 'snippet';
const VALID = '{"ok": true, "list": [1, 2]}';

let page: Page;
let entryId = '';
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
      label: 'Snippet',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    },
  });
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page.context().close();
});

const properties = () => page.getByRole('region', { name: / properties$/ });
const codeContent = (field: ReturnType<Page['locator']>) => field.locator('.cm-content');

test('a code field is added in the builder as JSON with validation, and ships live', async () => {
  await page.goto(ADMIN_URL);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Snippet', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Structure' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Snippet' })).toBeVisible();

  await page.getByRole('button', { name: 'Add field' }).click();
  await expect(properties().getByLabel('Label', { exact: true })).toBeFocused();
  await page.keyboard.type('Config');
  await properties().getByRole('radio', { name: /^Code/ }).check();

  // The language is always set (plain by default, no "Not set"); "Require valid JSON" shows for JSON only.
  const languageSelect = properties().getByRole('combobox', { name: 'Language' });
  await expect(languageSelect).toHaveText('Plain text');
  await expect(properties().getByRole('switch', { name: 'Require valid JSON' })).toHaveCount(0);
  await languageSelect.click();
  await expect(page.getByRole('option', { name: 'Not set' })).toHaveCount(0);
  await page.getByRole('option', { name: 'JSON', exact: true }).click();
  await properties().getByRole('switch', { name: 'Require valid JSON' }).check();
  await captureScreen(page, 'code-field-01-builder', { viewports: ['desktop'] });

  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const plan = page.getByRole('dialog', { name: /^Review changes to / });
  await expect(plan.getByText('Add the field Config (Code)')).toBeVisible();
  await plan.getByRole('button', { name: 'Ship now' }).click();
  await expect(plan).toBeHidden();
  await expect(page.getByText('Model updated — no restart needed').first()).toBeVisible();
});

test('valid JSON typed into the editor is saved and comes back unchanged after a reload', async () => {
  const doc = entryDocument(page);
  await page.goto(`${ADMIN_URL}content/${MODEL_KEY}`);
  await page.getByRole('link', { name: 'New', exact: true }).first().click();
  await page.locator('[data-field-path="/name"]').getByRole('textbox').fill('Site config');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/content/${MODEL_KEY}/[0-9a-f-]{36}`));
  entryId = new RegExp(`/content/${MODEL_KEY}/([0-9a-f-]{36})`).exec(page.url())?.[1] ?? '';

  const field = await doc.property('config');
  const editor = codeContent(field);
  // Labelled by the field's label; a monospaced editor with line numbers.
  await expect(field.getByRole('textbox', { name: 'Config' })).toBeVisible();
  await expect(field.locator('.cm-lineNumbers')).toBeVisible();
  await editor.click();
  await page.keyboard.type(VALID);
  await expect(editor).toHaveText(VALID);
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes(`/content/${MODEL_KEY}/${entryId}`) &&
      response.request().method() === 'PUT' &&
      !(response.request().postData() ?? '').includes('"autosave":true'),
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await saved).status()).toBe(200);

  const stored = (await (await page.request.get(`${ADMIN_API}/content/${MODEL_KEY}/${entryId}`)).json()) as {
    data: Record<string, unknown>;
  };
  expect(stored.data.config).toBe(VALID);

  await page.reload();
  const reloaded = await doc.property('config');
  await expect(codeContent(reloaded)).toHaveText(VALID);
  await captureScreen(page, 'code-field-02-entry', { viewports: ['desktop'] });
});

test('text that is not JSON shows the error inline, and Tab moves on out of the editor', async () => {
  const doc = entryDocument(page);
  const field = await doc.property('config');
  const editor = codeContent(field);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('{bad');
  await expect(editor).toHaveText('{bad');
  await page.keyboard.press('Tab');
  // Tab is not captured for indentation: focus goes to the next control, the field's keyboard hint.
  await expect(editor).not.toBeFocused();
  await expect(field.getByRole('button', { name: 'More about Config' })).toBeFocused();
  await expect(field.getByText('Must be valid JSON.')).toBeVisible();
  await expect(editor).toHaveAttribute('aria-invalid', 'true');
  await captureScreen(page, 'code-field-03-invalid', { viewports: ['desktop'] });
});
