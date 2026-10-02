import { expect, test, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * Locale management against the real API: add (with validation and a fallback chain), change the default
 * (acknowledged) and back, delete a locale with content (acknowledged in a dialog) and one without (an
 * inline confirmation). Every screen is captured in light and dark and checked with axe.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
const pageErrors: string[] = [];
let model: { id: string; version: number } | undefined;

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
  // Later specs expect an empty model list.
  if (model) {
    await adminRequest(page.request, 'DELETE', `/models/${model.id}?expectedVersion=${model.version}`);
  }
  await page.context().close();
});

/** A localized model with one entry written in `locale`, so deleting that locale has content to purge. */
const createContentIn = async (locale: string) => {
  const created = await adminRequest(page.request, 'POST', '/models', {
    definition: {
      kind: 'collection',
      apiKey: 'greeting',
      label: 'Greeting',
      localized: true,
      fields: [{ apiKey: 'title', label: 'Title', type: 'string', localized: true }],
    },
  });
  const { definitionId } = (await created.json()) as { definitionId: string };
  await expect
    .poll(async () => (await page.request.get(`${ADMIN_API}/models/${definitionId}`)).status())
    .toBe(200);
  const detail = (await (await page.request.get(`${ADMIN_API}/models/${definitionId}`)).json()) as {
    version: number;
  };
  model = { id: definitionId, version: detail.version };
  await adminRequest(page.request, 'POST', '/content/greeting', { locale, data: { title: 'Bonjour' } });
};

const toast = (text: string, on: Page = page) => on.getByText(text).first();

test('locales: add, fallback chain, default (acknowledged) and delete', async () => {
  await page.goto(`${ADMIN_URL}settings/locales`);
  await expect(page.getByRole('heading', { level: 1, name: 'Locales' })).toBeVisible();

  await page.getByRole('button', { name: 'Add locale' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add a locale' });
  await dialog.getByLabel('Code', { exact: true }).fill('FR');
  await dialog.getByLabel('Name').fill('French');
  await dialog.getByRole('button', { name: 'Add locale' }).click();
  await expect(dialog.getByText('Use a language code such as en, fr or fr-CA.')).toBeVisible();
  await dialog.getByLabel('Code', { exact: true }).fill('fr');
  await dialog.getByRole('button', { name: 'Add locale' }).click();
  await expect(toast('French added.')).toBeVisible();

  await page.getByRole('button', { name: 'Add locale' }).click();
  dialog = page.getByRole('dialog', { name: 'Add a locale' });
  await dialog.getByLabel('Code', { exact: true }).fill('fr-CA');
  await dialog.getByLabel('Name').fill('Canadian French');
  await dialog.getByRole('combobox', { name: 'Add a fallback locale' }).click();
  await page.getByRole('option', { name: 'French (fr)' }).click();
  await expect(dialog.getByRole('listitem')).toContainText('French');
  await captureScreen(page, 'locales-01-add-sheet');
  await dialog.getByRole('button', { name: 'Add locale' }).click();
  await expect(toast('Canadian French added.')).toBeVisible();
  await expect(page.getByRole('row', { name: /Canadian French/ })).toContainText('fr → en');
  await captureScreen(page, 'locales-02-list', { viewports: ['desktop'] });

  await page.getByRole('button', { name: 'Actions: French' }).click();
  await page.getByRole('menuitem', { name: 'Make default' }).click();
  const makeDefault = page.getByRole('alertdialog', { name: 'Make French the default locale?' });
  const confirm = makeDefault.getByRole('button', { name: 'Make default' });
  await expect(confirm).toBeDisabled();
  await captureScreen(page, 'locales-03-default-dialog');
  await makeDefault.getByLabel('I understand API clients', { exact: false }).check();
  await confirm.click();
  await expect(toast('French is now the default locale.')).toBeVisible();
  await expect(page.getByRole('row', { name: /^French/ })).toContainText('Default');

  // Back to English as the default, so later runs and specs see the usual setup.
  await page.getByRole('button', { name: 'Actions: English' }).click();
  await page.getByRole('menuitem', { name: 'Make default' }).click();
  const back = page.getByRole('alertdialog', { name: 'Make English the default locale?' });
  await back.getByLabel('I understand API clients', { exact: false }).check();
  await back.getByRole('button', { name: 'Make default' }).click();
  await expect(toast('English is now the default locale.')).toBeVisible();

  // A locale with content: the inline confirmation's first attempt is refused with the content count,
  // which the admin acknowledges in a blocking dialog.
  await createContentIn('fr-CA');
  await page.getByRole('button', { name: 'Actions: Canadian French' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const inline = page.getByRole('alertdialog', { name: 'Delete Canadian French?' });
  await expect(inline.getByText('its content is purged in the background', { exact: false })).toBeVisible();
  await inline.getByRole('button', { name: 'Delete' }).click();
  const remove = page.getByRole('alertdialog', { name: 'Delete Canadian French?' });
  await expect(
    remove.getByText('1 entry version has content in Canadian French.', { exact: false }),
  ).toBeVisible();
  const confirmRemove = remove.getByRole('button', { name: 'Delete' });
  await expect(confirmRemove).toBeDisabled();
  await expect(remove.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await captureScreen(page, 'locales-04-delete-dialog', { viewports: ['desktop', 'phone'] });
  await remove.getByLabel('I understand 1 entry version will be permanently deleted.').check();
  await confirmRemove.click();
  await expect(toast('Canadian French deleted.')).toBeVisible();
  await expect(page.getByRole('row', { name: /Canadian French/ })).toHaveCount(0);

  // A locale without content goes after the inline confirmation alone.
  await page.getByRole('button', { name: 'Actions: French' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const inlineFrench = page.getByRole('alertdialog', { name: 'Delete French?' });
  await expect(inlineFrench.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await captureScreen(page, 'locales-05-delete-confirm');
  await inlineFrench.getByRole('button', { name: 'Delete' }).click();
  await expect(toast('French deleted.')).toBeVisible();
  await expect(page.getByRole('row', { name: /^French/ })).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
