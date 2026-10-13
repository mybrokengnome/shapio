import { expect, test, type Page } from '@playwright/test';
import { adminApiFor, id, type AdminApi } from './content/api';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { entryDocument } from './support/entryDocument';
import { ADMIN_API, signInAsOwner } from './support/session';

/**
 * Types that extend a type, on the content side (plan polymorphic-types D13, D11): Products with the kinds
 * Digital and Physical, Physical with Apparel. The sidebar nests the kinds; the Products list holds every
 * kind's entries with a Kind column, a Kind filter and a New menu; a relation to Products links any kind; an
 * entry changes kind after an acknowledgement. Fixtures go through the admin API, never the UI under test.
 *
 * The groups marked `WP3` need the API's family reads (a type's list returns its kinds' entries, each item
 * with its `model`) and `POST /content/:modelKey/:id/kind`.
 */
test.describe.configure({ mode: 'serial' });

const PRODUCT_ID = id();
const DIGITAL_ID = id();
const PHYSICAL_ID = id();
const APPAREL_ID = id();
const ORDER_ID = id();
const NAME_ID = id();
const PRICE_ID = id();

/** Every family member shares the parent's localized and draft & publish flags. */
const FLAGS = { localized: false, draftAndPublish: true } as const;

const product = {
  id: PRODUCT_ID,
  kind: 'collection',
  apiKey: 'product',
  label: 'Products',
  ...FLAGS,
  display: { titleFieldId: NAME_ID, listFieldIds: [NAME_ID, PRICE_ID] },
  fields: [
    { id: NAME_ID, apiKey: 'name', label: 'Name', type: 'string', required: true, filterable: true },
    {
      id: PRICE_ID,
      apiKey: 'price',
      label: 'Price',
      type: 'decimal',
      filterable: true,
      sortable: true,
    },
  ],
};

const digital = {
  id: DIGITAL_ID,
  kind: 'collection',
  apiKey: 'digital',
  label: 'Digital',
  extends: PRODUCT_ID,
  ...FLAGS,
  fields: [{ id: id(), apiKey: 'downloadUrl', label: 'Download URL', type: 'string' }],
};

const physical = {
  id: PHYSICAL_ID,
  kind: 'collection',
  apiKey: 'physical',
  label: 'Physical',
  extends: PRODUCT_ID,
  ...FLAGS,
  fields: [{ id: id(), apiKey: 'weight', label: 'Weight', type: 'decimal' }],
};

const apparel = {
  id: APPAREL_ID,
  kind: 'collection',
  apiKey: 'apparel',
  label: 'Apparel',
  extends: PHYSICAL_ID,
  ...FLAGS,
  fields: [{ id: id(), apiKey: 'size', label: 'Size', type: 'string' }],
};

const ORDER_TITLE = id();
const order = {
  id: ORDER_ID,
  kind: 'collection',
  apiKey: 'order',
  label: 'Orders',
  ...FLAGS,
  display: { titleFieldId: ORDER_TITLE },
  fields: [
    { id: ORDER_TITLE, apiKey: 'reference', label: 'Reference', type: 'string' },
    {
      id: id(),
      apiKey: 'item',
      label: 'Item',
      type: 'relation',
      settings: { target: PRODUCT_ID, cardinality: 'one' },
      editor: { id: 'relationPicker', options: { allowInlineCreate: true } },
    },
  ],
};

/** Created in this order; deleted in reverse (a type with kinds can't be deleted before them). */
const MODELS = [product, digital, physical, apparel, order];

let page: Page;
let api: AdminApi;
const pageErrors: string[] = [];
const entries: Record<string, string> = {};

const createEntry = async (modelKey: string, data: Record<string, unknown>) =>
  (await api.send<{ id: string }>('POST', `/content/${modelKey}`, { data })).id;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  api = adminApiFor(page.request, ADMIN_API);
  for (const definition of MODELS) {
    await api.createDefinition('models', definition);
  }
  entries.lamp = await createEntry('product', { name: 'Desk lamp', price: 40 });
  entries.ebook = await createEntry('digital', {
    name: 'Field guide',
    price: 12,
    downloadUrl: 'https://example.com/guide.pdf',
  });
  entries.kettle = await createEntry('physical', { name: 'Kettle', price: 30, weight: 1.2 });
  entries.shirt = await createEntry('apparel', { name: 'T-shirt', price: 20, weight: 0.2, size: 'M' });
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  // Later specs expect an empty model list: kinds first, then the type they extend.
  for (const definition of [...MODELS].reverse()) {
    const response = await page.request.get(`${ADMIN_API}/models/${definition.id}`);
    if (response.ok()) {
      const { version } = (await response.json()) as { version: number };
      await api.send(
        'DELETE',
        `/models/${definition.id}?expectedVersion=${version}&acknowledgeBreaking=true`,
      );
    }
  }
  await page.context().close();
});

const sidebar = () => page.getByRole('navigation', { name: 'Main navigation' });

test('the sidebar nests each kind under the type it extends', async () => {
  await page.goto(`${ADMIN_URL}content/product`);
  const products = sidebar()
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: 'Products' }) });
  // Digital and Physical under Products, Apparel under Physical, by label.
  const kinds = products.locator('[data-sidebar="menu-sub"]').first();
  await expect(kinds.getByRole('link')).toHaveText([/^Digital/, /^Physical/, /^Apparel/]);
  const physicalKinds = kinds
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: /^Physical/ }) })
    .locator('[data-sidebar="menu-sub"]');
  await expect(physicalKinds.getByRole('link')).toHaveText([/^Apparel/]);
  // A kind opens its own place, and the sidebar marks it rather than its parent.
  await kinds.getByRole('link', { name: /^Digital/ }).click();
  await expect(page).toHaveURL(/\/content\/digital$/);
  await expect(sidebar().getByRole('link', { name: /^Digital/ })).toHaveAttribute('aria-current', 'page');
  await expect(sidebar().getByRole('link', { name: 'Products' })).not.toHaveAttribute('aria-current');
  await captureScreen(page, 'inheritance-sidebar');

  // Collapsed to icons, only the roots show.
  const toggle = page.getByRole('button', { name: 'Toggle sidebar', exact: true }).first();
  await toggle.click();
  await expect(sidebar().getByRole('link', { name: /^Digital/ })).toBeHidden();
  await expect(sidebar().getByRole('link', { name: 'Products' })).toBeVisible();
  await toggle.click();
  await expect(sidebar().getByRole('link', { name: /^Digital/ })).toBeVisible();
});

test('New on a type with kinds is a menu of the kinds, the type first', async () => {
  await page.goto(`${ADMIN_URL}content/product`);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['Products', 'Digital', 'Physical', 'Apparel']);
  await captureScreen(page, 'inheritance-new-menu');
  await menu.getByRole('menuitem', { name: 'Apparel' }).click();
  await expect(page).toHaveURL(/\/content\/apparel\/new/);
  await expect(page.getByRole('heading', { level: 1, name: 'New Apparel' })).toBeVisible();

  // Apparel has no kinds of its own: a plain New button.
  await page.goto(`${ADMIN_URL}content/apparel`);
  await expect(page.getByRole('link', { name: 'New', exact: true }).first()).toBeVisible();
});

test('a kind opens with its own fields, the inherited ones first', async () => {
  await page.goto(`${ADMIN_URL}content/apparel/${entries.shirt}`);
  await expect(page.getByRole('heading', { level: 1, name: 'T-shirt' })).toBeVisible();
  const doc = entryDocument(page);
  await expect(await doc.property('price')).toBeVisible();
  await expect(await doc.property('weight')).toBeVisible();
  await expect(await doc.property('size')).toBeVisible();
});

test('a type with kinds shows the Kind column and filter, and its entries offer Change kind', async () => {
  // Until WP3, the list holds the type's own entries only; the column and the chip show for the family.
  await page.goto(`${ADMIN_URL}content/product`);
  await expect(page.getByRole('table').getByRole('columnheader', { name: 'Kind' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kind', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Kind', exact: true }).click();
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
    'Products',
    'Digital',
    'Physical',
    'Apparel',
  ]);
  await page.keyboard.press('Escape');
  await captureScreen(page, 'inheritance-family-list-header');

  // A kind's entry: Change kind sits in the danger zone, listing the family's other kinds.
  await page.goto(`${ADMIN_URL}content/digital/${entries.ebook}`);
  const drawer = await entryDocument(page).openSettings();
  const select = drawer.getByRole('combobox', { name: 'Change kind' });
  await expect(select).toBeEnabled();
  await select.click();
  await expect(page.getByRole('option')).toHaveText(['Products', 'Physical', 'Apparel']);
  await page.keyboard.press('Escape');
  await drawer.getByRole('heading', { name: 'Change kind' }).scrollIntoViewIfNeeded();
  await captureScreen(page, 'inheritance-change-kind-section');

  // An entry of a type without kinds has no such section.
  const orderId = await createEntry('order', { reference: 'Order 0' });
  await page.goto(`${ADMIN_URL}content/order/${orderId}`);
  await expect((await entryDocument(page).openSettings()).getByText('Change kind')).toHaveCount(0);
});

test.describe('WP3: family reads', () => {
  test('the list of a type holds every kind, with a Kind column and a Kind filter', async () => {
    await page.goto(`${ADMIN_URL}content/product?sort=price:asc`);
    const table = page.getByRole('table');
    await expect(table.getByRole('columnheader', { name: 'Kind' })).toBeVisible();
    const rows = table.getByRole('row');
    await expect(rows.nth(1)).toContainText('Field guide');
    await expect(rows.nth(1)).toContainText('Digital');
    await expect(rows.nth(2)).toContainText('T-shirt');
    await expect(rows.nth(2)).toContainText('Apparel');
    await expect(rows.nth(4)).toContainText('Desk lamp');
    await expect(rows.nth(4)).toContainText('Products');
    // Each row opens under its own kind.
    await expect(rows.nth(1).getByRole('link', { name: 'Field guide', exact: true })).toHaveAttribute(
      'href',
      new RegExp(`/content/digital/${entries.ebook}`),
    );
    await captureScreen(page, 'inheritance-family-list');

    // Kind is Physical: Physical's entries and Apparel's.
    await page.getByRole('button', { name: 'Kind', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Physical' }).click();
    await expect(page).toHaveURL(/kind=physical/);
    await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('Kind is Physical');
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(table).toContainText('Kettle');
    await expect(table).toContainText('T-shirt');
    await page.getByRole('button', { name: 'Remove filter: Kind is Physical' }).click();
    await expect(table.getByRole('row')).toHaveCount(5);

    // Kind is Products: the type's own entries only, none of its kinds'.
    const listed = page.waitForResponse(
      (response) =>
        decodeURIComponent(response.url()).includes('filters[__model][$eq]=product') && response.ok(),
    );
    await page.getByRole('button', { name: 'Kind', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Products' }).click();
    await listed;
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('Desk lamp');
    await page.getByRole('button', { name: 'Remove filter: Kind is Products' }).click();
    await expect(table.getByRole('row')).toHaveCount(5);
  });

  test('a relation to a type links any kind and names it', async () => {
    const orderId = await createEntry('order', { reference: 'Order 1' });
    await page.goto(`${ADMIN_URL}content/order/${orderId}`);
    const doc = entryDocument(page);
    // The relation's editor in the settings drawer (the properties strip shows it too).
    const item = await doc.property('item');
    await item.getByRole('button', { name: 'Choose Products' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose Products' });
    await expect(picker.getByRole('option', { name: /Field guide\s*Digital/ })).toBeVisible();
    await expect(picker.getByRole('option', { name: /Desk lamp/ })).toBeVisible();
    await captureScreen(page, 'inheritance-relation-picker');
    await picker.getByRole('option', { name: /Field guide/ }).click();
    await expect(item.getByText('Field guide')).toBeVisible();
    await expect(item.getByText('Digital')).toBeVisible();

    // Inline create asks for the kind first.
    await item.getByRole('button', { name: 'Change' }).click();
    await page
      .getByRole('dialog', { name: 'Choose Products' })
      .getByRole('button', { name: 'Create a new Products' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'New Products' });
    await sheet.getByRole('combobox', { name: 'Kind' }).click();
    await page.getByRole('option', { name: 'Digital' }).click();
    await sheet.getByRole('textbox', { name: /^Name/ }).fill('Recipe pack');
    await expect(sheet.getByRole('textbox', { name: /^Download URL/ })).toBeVisible();
    const created = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/content/digital'),
    );
    await sheet.getByRole('button', { name: 'Create and link' }).click();
    expect((await created).status()).toBe(201);
    await expect(item.getByText('Recipe pack')).toBeVisible();
  });
});

test.describe('WP3: change kind', () => {
  test('an entry changes kind after acknowledging the values it drops', async () => {
    await page.goto(`${ADMIN_URL}content/digital/${entries.ebook}`);
    const doc = entryDocument(page);
    const drawer = await doc.openSettings();
    const select = drawer.getByRole('combobox', { name: 'Change kind' });
    await select.click();
    await page.getByRole('option', { name: 'Physical' }).click();
    await expect(drawer.getByText('Removes the value of “Download URL”.')).toBeVisible();
    await captureScreen(page, 'inheritance-change-kind');
    await drawer.getByRole('button', { name: 'Change to Physical' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Change “Field guide” to Physical?' });
    await expect(dialog.getByRole('button', { name: 'Change kind' })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: "Remove this field's value" }).check();
    const changed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith(`/${entries.ebook}/kind`),
    );
    await dialog.getByRole('button', { name: 'Change kind' }).click();
    const response = await changed;
    expect(response.status(), await response.text()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({
      targetModelKey: 'physical',
      expectedVersion: 1,
      acknowledgeDroppedFields: true,
    });
    await expect(page).toHaveURL(new RegExp(`/content/physical/${entries.ebook}`));
    await expect(page.getByText('Changed to Physical.')).toBeVisible();
    await expect(await doc.property('weight')).toBeVisible();

    // The Products list shows it as Physical now.
    await page.goto(`${ADMIN_URL}content/product`);
    await expect(page.getByRole('row').filter({ hasText: 'Field guide' })).toContainText('Physical');
  });

  test('change kind waits for a save while the entry has unsaved edits', async () => {
    await page.goto(`${ADMIN_URL}content/physical/${entries.kettle}`);
    const doc = entryDocument(page);
    await (await doc.property('weight')).getByRole('textbox').fill('2');
    const drawer = await doc.openSettings();
    await expect(drawer.getByRole('combobox', { name: 'Change kind' })).toBeDisabled();
    await expect(drawer.getByText('Save your changes first.')).toBeVisible();
  });
});
