import { expect, test, type Locator, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { entryDocument } from './support/entryDocument';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * Document or form (plan form-layout): in the builder a Product type is set to Form, with price and sku at
 * half width in a "Pricing" group. Its entries open as a form: the title is a read-only heading and a field
 * of the form, price and sku share a row, rich text and a gallery render inline, the drawer has status and
 * history but no properties, save and publish work, and the pre-flight's Fix goes to the field on the page.
 * The layout also switches from the entry's Settings, at once and with Undo, and a collection entry sits
 * under the place's Entries · Structure · API tabs. Captured light (Snowed) and dark (Shapio) with axe.
 */
test.describe.configure({ mode: 'serial' });

const UPDATED = 'Model updated — no restart needed';

let page: Page;
let modelId = '';
const pageErrors: string[] = [];

const nav = () => page.getByRole('navigation', { name: 'Main navigation' });
const fieldList = () => page.getByRole('list', { name: /^\d+ fields?$/ });
const fieldRow = (label: string) => fieldList().getByRole('button', { name: new RegExp(`^${label}\\b`) });
/** The selected field's properties panel ("Price properties"). */
const properties = () => page.getByRole('region', { name: / properties$/ });
const entryForm = () => page.locator('[data-entry-layout="form"]');

/** The form's sections in page order: the heading (null when unlabelled) and the top-level fields in each. */
const formSections = () =>
  page.locator('section[data-form-section]').evaluateAll((sections) =>
    sections.map((section) => ({
      label: section.querySelector('h2')?.textContent ?? null,
      fields: [...section.querySelectorAll('[data-field-path]')]
        .map((field) => field.getAttribute('data-field-path') ?? '')
        .filter((path, index, all) => /^\/[^/]+$/.test(path) && all.indexOf(path) === index),
    })),
  );

/** Picks an option of a builder select (a Radix combobox) by its label. */
const choose = async (scope: Locator | Page, label: string, option: string) => {
  await scope.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(scope.getByRole('combobox', { name: label, exact: true })).toHaveText(option);
};

/** "Add field" adds a field with its label focused: type the name, pick the type. */
const addField = async (label: string, type: RegExp) => {
  await page.getByRole('button', { name: 'Add field' }).click();
  await expect(properties().getByLabel('Label', { exact: true })).toBeFocused();
  await page.keyboard.type(label);
  await properties().getByRole('radio', { name: type }).check();
  await expect(fieldRow(label)).toBeVisible();
};

/** Reviews the builder's draft and ships it, waiting for the new version. */
const ship = async () => {
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const plan = page.getByRole('dialog', { name: /^Review changes to / });
  await expect(plan).toBeVisible();
  await plan.getByRole('button', { name: 'Ship now' }).click();
  await expect(plan).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(UPDATED).first()).toBeVisible({ timeout: 30_000 });
};

/** Opens the type's Model settings in the builder (they stay expanded once open). */
const openModelSettings = async () => {
  const layout = page.getByRole('combobox', { name: 'Layout', exact: true });
  if (!(await layout.isVisible())) {
    await page.getByRole('button', { name: 'Model settings' }).click();
  }
  await expect(layout).toBeVisible();
};

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
  if (modelId) {
    const model = await page.request.get(`${ADMIN_API}/models/${modelId}`);
    if (model.ok()) {
      const { version } = (await model.json()) as { version: number };
      await adminRequest(page.request, 'DELETE', `/models/${modelId}?expectedVersion=${version}`);
    }
  }
  await page.context().close();
});

test('a Product type set to Form opens its entries as a form', async () => {
  const doc = entryDocument(page);

  await test.step('build the type: fields, Form layout, widths and a Pricing group', async () => {
    await page.goto(ADMIN_URL);
    await nav().getByRole('link', { name: 'New content type' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'New content type' })).toBeVisible();
    await page.getByRole('main').getByLabel('Label', { exact: true }).fill('Product');
    await page.getByRole('main').getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Product' })).toBeVisible();

    await addField('Name', /^Short text/);
    await addField('Price', /^Number/);
    await addField('SKU', /^Short text/);
    await properties().getByRole('switch', { name: 'Required' }).click();
    await addField('Description', /^Rich text/);
    await addField('Gallery', /^Media/);
    await properties().getByRole('switch', { name: 'Allow several' }).click();

    // Width is a form's control: none while the type is a document.
    await fieldRow('Price').click();
    await expect(properties().getByRole('combobox', { name: 'Width' })).toHaveCount(0);

    await openModelSettings();
    await choose(page, 'Layout', 'Form');
    await expect(page.getByRole('switch', { name: 'Show in document' })).toHaveCount(0);

    await fieldRow('Price').click();
    await choose(properties(), 'Width', 'Half');
    await properties().getByRole('combobox', { name: 'Group', exact: true }).click();
    await page.getByRole('option', { name: 'New group…' }).click();
    await properties().getByLabel('Group name').fill('Pricing');
    await page.keyboard.press('Enter');
    await expect(properties().getByRole('combobox', { name: 'Group', exact: true })).toHaveText('Pricing');

    await fieldRow('SKU').click();
    await choose(properties(), 'Width', 'Half');
    await choose(properties(), 'Group', 'Pricing');
    await captureScreen(page, 'form-01-builder');

    await ship();
    const models = (await (await page.request.get(`${ADMIN_API}/models`)).json()) as {
      items: {
        definition: {
          id: string;
          apiKey: string;
          display: { layout?: string; groups?: { label: string; fieldIds: string[] }[] };
          fields: { id: string; apiKey: string; width?: string }[];
        };
      }[];
    };
    const definition = models.items.find((item) => item.definition.apiKey === 'product')?.definition;
    if (!definition) {
      throw new Error('the Product type is not listed');
    }
    modelId = definition.id;
    const fieldOf = (apiKey: string) => definition.fields.find((field) => field.apiKey === apiKey);
    expect(definition.display.layout).toBe('form');
    expect(fieldOf('price')?.width).toBe('half');
    expect(fieldOf('sku')?.width).toBe('half');
    expect(fieldOf('name')?.width).toBeUndefined();
    expect(definition.display.groups).toEqual([
      expect.objectContaining({ label: 'Pricing', fieldIds: [fieldOf('price')?.id, fieldOf('sku')?.id] }),
    ]);
  });

  await test.step('a new entry is a form: heading, sections, widths, inline rich text', async () => {
    await page.goto(`${ADMIN_URL}content/product/new`);
    await expect(entryForm()).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'New Product' })).toBeVisible();
    // No document chrome: no inline title, no strip, no canvas.
    await expect(page.locator('textarea[aria-label="Name"]')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Properties' })).toHaveCount(0);
    await expect(page.locator('[data-canvas]')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Pricing' })).toBeVisible();
    // Field order decides the sections: each run of ungrouped fields is its own unlabelled section.
    expect(await formSections()).toEqual([
      { label: null, fields: ['/name'] },
      { label: 'Pricing', fields: ['/price', '/sku'] },
      { label: null, fields: ['/description', '/gallery'] },
    ]);

    // The row holds with the drawer open beside the form, as it is by default on a wide screen.
    await expect(doc.drawer()).toBeVisible();
    const price = await doc.field('/price').boundingBox();
    const sku = await doc.field('/sku').boundingBox();
    expect(price && sku).toBeTruthy();
    if (price && sku) {
      expect(Math.abs(price.y - sku.y)).toBeLessThan(1);
      expect(sku.x).toBeGreaterThan(price.x + price.width);
    }
    await expect(doc.field('/description').locator('[contenteditable="true"]')).toBeVisible();
    await expect(doc.field('/gallery')).toBeVisible();
    await captureScreen(page, 'form-02-new-entry');

    // The drawer: status and history (once saved), never properties or the cover.
    const drawer = await doc.openSettings();
    await expect(drawer.locator('[data-drawer-section="entry-settings-properties"]')).toHaveCount(0);
    await expect(drawer.locator('[data-property-row]')).toHaveCount(0);
  });

  await test.step('fill, save and publish', async () => {
    await doc.field('/name').getByRole('textbox').fill('Blue mug');
    await doc.field('/price').locator('input').fill('12.5');
    await doc.field('/sku').getByRole('textbox').fill('MUG-BLUE');
    await doc.field('/description').locator('[contenteditable="true"]').click();
    await page.keyboard.type('Holds a large coffee.');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\/content\/product\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Blue mug' })).toBeVisible();
    await expect(entryForm()).toBeVisible();

    const drawer = await doc.openSettings();
    await expect(drawer.locator('[data-drawer-section="entry-settings-history"]')).toBeVisible();
    await expect(drawer.locator('[data-drawer-section="entry-settings-properties"]')).toHaveCount(0);
    await captureScreen(page, 'form-03-entry-drawer');
    await doc.publish();

    const entryId = /\/content\/product\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
    const entry = (await (await page.request.get(`${ADMIN_API}/content/product/${entryId}`)).json()) as {
      data: Record<string, unknown>;
    };
    expect(entry.data).toMatchObject({ name: 'Blue mug', price: 12.5, sku: 'MUG-BLUE' });
  });

  await test.step('the pre-flight Fix goes to a required field on the page', async () => {
    await doc.closeSettings();
    await doc.field('/sku').getByRole('textbox').fill('');
    const preflight = await doc.openPreflight();
    const check = preflight.getByRole('listitem').filter({ hasText: "SKU is empty, and it's required." });
    await expect(check).toBeVisible();
    await check.getByRole('button', { name: 'Fix' }).click();
    await expect(preflight).toBeHidden();
    await expect(doc.field('/sku').getByRole('textbox')).toBeFocused();
    // Everything is on the page, so Fix never opens the drawer at properties.
    await expect(page.locator('[data-drawer-section="entry-settings-properties"]')).toHaveCount(0);
    await page.keyboard.type('MUG-BLUE');
  });

  await test.step('a collection entry sits under the place tabs', async () => {
    const tabs = page.getByRole('tablist', { name: 'Product sections' });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'Entries' })).toHaveAttribute('aria-selected', 'true');
    // The edit above autosaves: nothing is left to guard when leaving the entry.
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: /autosaved|All changes saved/ })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Settings → Layout switches the type at once, with Undo', async () => {
    const entryUrl = page.url();
    const drawer = await doc.openSettings();
    const sections = await drawer
      .locator('[data-drawer-section]')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-drawer-section')));
    expect(sections.slice(0, 2)).toEqual(['entry-settings-layout', 'entry-settings-status']);
    const layout = drawer.locator('[data-drawer-section="entry-settings-layout"]');
    await expect(layout.getByRole('switch', { name: 'Open as a form' })).toBeChecked();
    // A narrow bar (drawer open at 1360px): the place name stays readable and nothing overlaps.
    const bar = page.locator('[data-slot="entry-top-bar"]');
    await expect(bar.getByRole('link', { name: 'Product', exact: true })).toBeVisible();
    await expect(bar.getByRole('status')).not.toContainText('2026');
    const boxes = await bar.evaluate((element) => {
      const rect = (target: Element | null) => target?.getBoundingClientRect() ?? null;
      const [left, actions] = [...element.children];
      return {
        breadcrumb: rect(element.querySelector('nav')),
        placeName: element.querySelector('nav a')?.scrollWidth ?? 0,
        placeNameShown: element.querySelector('nav a')?.clientWidth ?? 0,
        saveState: rect(left?.querySelector('[role="status"]') ?? null),
        actions: rect(actions ?? null),
      };
    });
    expect(boxes.placeNameShown).toBeGreaterThanOrEqual(boxes.placeName);
    expect(boxes.breadcrumb && boxes.saveState && boxes.actions).toBeTruthy();
    if (boxes.breadcrumb && boxes.saveState && boxes.actions) {
      expect(boxes.breadcrumb.right).toBeLessThanOrEqual(boxes.saveState.left);
      expect(boxes.saveState.right).toBeLessThanOrEqual(boxes.actions.left);
    }
    await captureScreen(page, 'form-04-layout-switch');

    // The switch turns it off; the word Document on its left would do the same.
    await layout.getByRole('switch', { name: 'Open as a form' }).click();
    const switched = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'Product now opens as a document.' });
    await expect(switched).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-entry-layout="document"]')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Blue mug');
    await expect(page).toHaveURL(entryUrl);

    await switched.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Product now opens as a form.').first()).toBeVisible({ timeout: 30_000 });
    await expect(entryForm()).toBeVisible();
    await expect(layout.getByRole('switch', { name: 'Open as a form' })).toBeChecked();

    // The word picks its side: Document turns the switch off.
    await layout.getByText('Document', { exact: true }).click();
    await expect(page.locator('[data-entry-layout="document"]')).toBeVisible({ timeout: 30_000 });
  });

  await test.step('Structure opens the builder, where Layout reads Document', async () => {
    await page
      .getByRole('tablist', { name: 'Product sections' })
      .getByRole('tab', { name: 'Structure' })
      .click();
    await expect(page).toHaveURL(/\/content\/product\?tab=structure$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Product' })).toBeVisible();
    await openModelSettings();
    await expect(page.getByRole('combobox', { name: 'Layout', exact: true })).toHaveText('Document');
  });

  await test.step('Entries from an entry goes back to the list; the entry is a document now', async () => {
    await page.goto(`${ADMIN_URL}content/product`);
    await page.getByRole('link', { name: 'Blue mug' }).first().click();
    await expect(page.locator('[data-entry-layout="document"]')).toBeVisible();
    await expect(entryForm()).toHaveCount(0);
    await page
      .getByRole('tablist', { name: 'Product sections' })
      .getByRole('tab', { name: 'Entries' })
      .click();
    await expect(page).toHaveURL(/\/content\/product$/);
    await expect(page.getByRole('link', { name: 'Blue mug' }).first()).toBeVisible();
  });
});
