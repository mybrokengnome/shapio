import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_URL } from './support/constants';
import { entryDocument } from './support/entryDocument';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * An entry reopened in the same visit shows what was saved, not the copy the admin cached when it first
 * opened it (0.5.14: a property edited and published came back with its old value until a reload). Every
 * step moves inside the app, as a person does: a reload would empty the cache and hide the bug. The entry is
 * a kind (Help article extends Help page), opened from its list and from the palette.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const ids = { page: randomUUID(), article: randomUUID(), title: randomUUID() };
const ORIGINAL = 'silence notifications';
const PUBLISHED = 'silence notifications\nquiet notifications';
const DRAFTED = 'silence notifications\nquiet notifications\nhush alerts';

let page: Page;
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  await adminRequest(page.request, 'POST', '/models', {
    definition: {
      id: ids.page,
      kind: 'collection',
      apiKey: 'helpPage',
      label: 'Help page',
      display: { titleFieldId: ids.title },
      fields: [{ id: ids.title, apiKey: 'title', label: 'Title', type: 'string', required: true }],
    },
  });
  await adminRequest(page.request, 'POST', '/models', {
    definition: {
      id: ids.article,
      kind: 'collection',
      apiKey: 'helpArticle',
      label: 'Help article',
      extends: ids.page,
      display: { titleFieldId: ids.title },
      fields: [{ id: randomUUID(), apiKey: 'searchKeywords', label: 'Search keywords', type: 'text' }],
    },
  });
  await adminRequest(page.request, 'POST', '/content/helpArticle', {
    data: { title: 'Mute notifications', searchKeywords: ORIGINAL },
  });
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  // The types go when the spec is done, kind first: the suite's other specs share this server.
  for (const modelId of [ids.article, ids.page]) {
    const response = await page.request.get(`${ADMIN_API}/models/${modelId}`);
    const { version } = (await response.json()) as { version: number };
    await adminRequest(
      page.request,
      'DELETE',
      `/models/${modelId}?expectedVersion=${version}&acknowledgeBreaking=true`,
    );
  }
  await page?.context().close();
});

const doc = () => entryDocument(page);

/** The Search keywords property's text, from the settings drawer. */
const keywords = async () => (await doc().property('searchKeywords')).getByRole('textbox');

/** The list, reached through the app (the sidebar), searched, and the entry opened from its row. */
const reopenFromList = async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Help article', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search entries' }).fill('mute');
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(2);
  await rows.nth(1).getByRole('link', { name: 'Mute notifications' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mute notifications' })).toBeVisible();
};

test('a property edited and published shows its new value when the entry is opened again', async () => {
  await page.goto(`${ADMIN_URL}content/helpArticle`);
  await page.getByRole('table').getByRole('link', { name: 'Mute notifications' }).first().click();
  const field = await keywords();
  await expect(field).toHaveValue(ORIGINAL);
  await field.fill(PUBLISHED);
  await doc().publish();

  await reopenFromList();
  await expect(await keywords()).toHaveValue(PUBLISHED);
});

test('a draft saved without publishing shows its new value when reopened from the palette', async () => {
  const field = await keywords();
  const autosaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().includes('/content/helpArticle/') &&
      response.ok(),
  );
  await field.fill(DRAFTED);
  await autosaved;

  await page.getByRole('navigation').getByRole('link', { name: 'Help article', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search entries' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Search and commands' });
  await palette.getByRole('combobox', { name: /Search places/ }).fill('Mute');
  await palette
    .getByRole('option', { name: /Mute notifications/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mute notifications' })).toBeVisible();
  await expect(await keywords()).toHaveValue(DRAFTED);
});
