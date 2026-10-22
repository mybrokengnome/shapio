import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { adminApiFor } from './content/api';
import { captureScreen } from './support/capture';
import { ADMIN_URL, SCREENSHOT_DIR } from './support/constants';
import { entryDocument } from './support/entryDocument';
import { renderScheme } from './support/schemes';
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
/** What the rich text tests made, removed after the suite (models before the component they use). */
const longDocument = { models: [] as string[], components: [] as string[], assets: [] as string[] };

const nav = () => page.getByRole('navigation', { name: 'Main navigation' });
const fieldList = () => page.getByRole('list', { name: /^\d+ fields?$/ });
const fieldRow = (label: string) => fieldList().getByRole('button', { name: new RegExp(`^${label}\\b`) });
/** The selected field's properties panel ("Price properties"). */
const properties = () => page.getByRole('region', { name: / properties$/ });
const entryForm = () => page.locator('[data-entry-layout="form"]');

/** The form's sections in page order: the heading (null when unlabeled) and the top-level fields in each. */
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

/** Deletes a definition at its current version (it may already be gone). */
const deleteDefinition = async (category: 'models' | 'components', id: string) => {
  const definition = await page.request.get(`${ADMIN_API}/${category}/${id}`);
  if (definition.ok()) {
    const { version } = (await definition.json()) as { version: number };
    await adminRequest(
      page.request,
      'DELETE',
      `/${category}/${id}?expectedVersion=${version}&acknowledgeBreaking=true`,
    );
  }
};

test.afterAll(async () => {
  for (const id of longDocument.models) {
    await deleteDefinition('models', id);
  }
  for (const id of longDocument.components) {
    await deleteDefinition('components', id);
  }
  // Content used the image, so only a forced delete removes it (the media spec expects an empty library).
  for (const assetId of longDocument.assets) {
    await adminRequest(page.request, 'DELETE', `/media/assets/${assetId}?force=true`);
  }
  // Later specs expect an empty model list.
  if (modelId) {
    const model = await page.request.get(`${ADMIN_API}/models/${modelId}`);
    if (model.ok()) {
      const { version } = (await model.json()) as { version: number };
      await adminRequest(
        page.request,
        'DELETE',
        `/models/${modelId}?expectedVersion=${version}&acknowledgeBreaking=true`,
      );
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
    // Field order decides the sections: each run of ungrouped fields is its own unlabeled section.
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
    // Measured once the bar and the drawer have settled (the autosave's status, the Save button and the
    // drawer's slide can still be landing): polled until no transition runs, the bar ends left of the
    // drawer, sits on one row and nothing overlaps or clips, so only a lasting overlap fails. A bar
    // measured mid-slide is still wide and would pass. The boxes come along so a failure shows the numbers.
    const measure = () =>
      bar.evaluate((element) => {
        const rect = (target: Element | null) => target?.getBoundingClientRect() ?? null;
        const [left, actions] = [...element.children];
        const breadcrumb = rect(element.querySelector('nav'));
        // The save-state slot: the save state, or the "Changed elsewhere" notice with its Reload button.
        const saveState = rect(left?.lastElementChild ?? null);
        const status = left?.querySelector('[role="status"]');
        const actionsBox = rect(actions ?? null);
        const drawerBox = rect(document.querySelector('#entry-settings'));
        // The place name is whole when the breadcrumb (which clips) doesn't cut it off.
        const placeName = rect(element.querySelector('nav a'));
        return {
          settled: document.getAnimations().every((animation) => !(animation instanceof CSSTransition)),
          clearOfDrawer: Boolean(drawerBox && element.getBoundingClientRect().right <= drawerBox.left),
          oneRow: Boolean(saveState && actionsBox && actionsBox.top < saveState.bottom),
          placeNameFits: Boolean(breadcrumb && placeName && placeName.right <= breadcrumb.right),
          statusFits: Boolean(status && status.clientWidth >= status.scrollWidth),
          breadcrumbClear: Boolean(breadcrumb && saveState && breadcrumb.right <= saveState.left),
          saveStateClear: Boolean(saveState && actionsBox && saveState.right <= actionsBox.left),
          boxes: { breadcrumb, saveState, actions: actionsBox, drawer: drawerBox },
        };
      });
    const fits = {
      settled: true,
      clearOfDrawer: true,
      oneRow: true,
      placeNameFits: true,
      statusFits: true,
      breadcrumbClear: true,
      saveStateClear: true,
    };
    await expect.poll(measure).toMatchObject(fits);
    await captureScreen(page, 'form-04-layout-switch');

    // Another session saves the entry: "Changed elsewhere" and Reload take the save state's place, and the
    // bar still fits. Reload shows that save.
    const entryId = /\/content\/product\/([0-9a-f-]{36})/.exec(entryUrl)?.[1] ?? '';
    const { version } = (await (
      await page.request.get(`${ADMIN_API}/content/product/${entryId}`)
    ).json()) as {
      version: number;
    };
    await adminRequest(page.request, 'PUT', `/content/product/${entryId}`, {
      expectedVersion: version,
      data: { price: 13 },
    });
    // The next heartbeat carries the new draft version (TanStack Query refetches it when the tab is shown).
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
    await expect(bar.getByRole('status')).toHaveText('Changed elsewhere', { timeout: 20_000 });
    await expect.poll(measure).toMatchObject(fits);
    await captureScreen(page, 'form-05-remote-change');
    await bar.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(doc.field('/price').locator('input')).toHaveValue('13');
    await expect(bar.getByRole('button', { name: 'Reload', exact: true })).toHaveCount(0);

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

/** A rich text document of `count` paragraphs, with `image` (a library asset) after the second when given. */
const longBody = (count: number, image?: string) => {
  const paragraphs = Array.from({ length: count }, (_, index) => ({
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text: `Paragraph ${index + 1}. The tide came in over the flats while the boats waited at the quay for the morning light to reach the harbor wall.`,
      },
    ],
  }));
  const content = image
    ? [
        ...paragraphs.slice(0, 2),
        { type: 'image', attrs: { mediaId: image, alt: null } },
        ...paragraphs.slice(2),
      ]
    : paragraphs;
  return { format: 'shapio-richtext', version: 1, doc: { type: 'doc', content } };
};

/**
 * Screenshots `target` (the window when omitted: sticky chrome mid-scroll) in the light and the dark look,
 * once the theme's color transitions have finished.
 */
const captureInBothLooks = async (name: string, target?: Locator) => {
  await page.mouse.move(0, 0);
  for (const scheme of ['light', 'dark'] as const) {
    const restore = await renderScheme(page, scheme);
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== 'running'),
    );
    const path = join(SCREENSHOT_DIR, `${name}-${scheme}.png`);
    await (target ? target.screenshot({ path }) : page.screenshot({ path }));
    await restore();
  }
};

/** The toolbar is in the window, under the entry's top bar (not behind it), and its buttons take clicks. */
const expectToolbarUnderTopBar = async (toolbar: Locator) => {
  await expect(toolbar).toBeInViewport();
  const bar = await page.locator('[data-slot="entry-top-bar"]').boundingBox();
  const box = await toolbar.boundingBox();
  expect(bar && box && box.y >= bar.y + bar.height - 1, `toolbar ${box?.y} under the top bar`).toBe(true);
};

test('a long rich text body keeps its toolbar in view; alt text grows as you type', async () => {
  const api = adminApiFor(page.request, ADMIN_API);
  const suffix = randomUUID().slice(0, 8);
  const ids = { form: randomUUID(), title: randomUUID(), doc: randomUUID(), docTitle: randomUUID() };
  const section = { id: randomUUID(), apiKey: `longSection${suffix}` };
  const image = await api.uploadPng('tide.png', 640, 400);
  longDocument.assets.push(image.id);
  await api.createDefinition('components', {
    id: section.id,
    kind: 'component',
    apiKey: section.apiKey,
    label: 'Long section',
    fields: [{ id: randomUUID(), apiKey: 'text', label: 'Text', type: 'richtext' }],
  });
  longDocument.components.push(section.id);
  const formKey = `longRead${suffix}`;
  await api.createDefinition('models', {
    id: ids.form,
    kind: 'collection',
    apiKey: formKey,
    label: 'Long read',
    display: { layout: 'form', titleFieldId: ids.title },
    fields: [
      { id: ids.title, apiKey: 'title', label: 'Title', type: 'string' },
      { id: randomUUID(), apiKey: 'body', label: 'Body', type: 'richtext' },
    ],
  });
  longDocument.models.push(ids.form);
  const docKey = `longZone${suffix}`;
  await api.createDefinition('models', {
    id: ids.doc,
    kind: 'collection',
    apiKey: docKey,
    label: 'Long zone',
    display: { titleFieldId: ids.docTitle },
    fields: [
      { id: ids.docTitle, apiKey: 'title', label: 'Title', type: 'string' },
      {
        id: randomUUID(),
        apiKey: 'sections',
        label: 'Sections',
        type: 'dynamiczone',
        settings: { components: [section.id] },
      },
    ],
  });
  longDocument.models.push(ids.doc);
  const formEntry = await api.send<{ id: string }>('POST', `/content/${formKey}`, {
    data: { title: 'Tide tables', body: longBody(40, image.id) },
  });
  const docEntry = await api.send<{ id: string }>('POST', `/content/${docKey}`, {
    data: {
      title: 'Harbor notes',
      sections: [
        { __component: section.apiKey, text: longBody(40) },
        { __component: section.apiKey, text: longBody(40) },
      ],
    },
  });
  const doc = entryDocument(page);

  await test.step('form layout: the toolbar stays under the top bar at the end of the body', async () => {
    await page.goto(`${ADMIN_URL}content/${formKey}/${formEntry.id}`);
    await expect(entryForm()).toBeVisible();
    const body = doc.field('/body');
    const toolbar = body.getByRole('toolbar', { name: 'Text formatting' });
    const last = body.locator('.ProseMirror p').last();
    await last.click();
    await page.keyboard.press('End');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    await expectToolbarUnderTopBar(toolbar);
    // Still usable: Bold from the toolbar applies to what is typed next, at the end of the body.
    await toolbar.getByRole('button', { name: 'Bold' }).click();
    // The editor takes focus back (on the next frame) before the typing goes in.
    await expect(body.locator('.ProseMirror')).toBeFocused();
    await page.keyboard.type(' Low water at noon.');
    await expect(body.locator('.ProseMirror p').last().locator('strong')).toHaveText('Low water at noon.');
    await captureInBothLooks('richtext-sticky-toolbar-form');
  });

  await test.step('form layout: the alt text box grows with a long description', async () => {
    const alt = doc.field('/body').getByLabel('Alt text');
    await alt.scrollIntoViewIfNeeded();
    const before = (await alt.boundingBox())?.height ?? 0;
    const description =
      'Fishing boats tied up along the stone quay at low tide, nets drying on the rails, gulls on the harbor wall, and the lighthouse in morning fog behind them';
    await alt.click();
    await page.keyboard.type(description);
    // Enter adds no line break: alt text is one line.
    await page.keyboard.press('Enter');
    await expect(alt).toHaveValue(description);
    await expect.poll(async () => (await alt.boundingBox())?.height ?? 0).toBeGreaterThan(before * 1.8);
    await captureInBothLooks('richtext-alt-text-grown', doc.field('/body').locator('figure[data-media-id]'));
  });

  await test.step('document layout: a rich text field in a zone component keeps its toolbar too', async () => {
    await page.goto(`${ADMIN_URL}content/${docKey}/${docEntry.id}`);
    await expect(page.locator('[data-entry-layout="document"]')).toBeVisible();
    const text = doc.field('/sections/0/text');
    const toolbar = text.getByRole('toolbar', { name: 'Text formatting' });
    await text.locator('.ProseMirror p').last().click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    await expectToolbarUnderTopBar(toolbar);
    await captureInBothLooks('richtext-sticky-toolbar-zone');
    // Past the field the toolbar goes with it: at the end of the next section only that one's toolbar shows.
    const next = doc.field('/sections/1/text');
    await next.locator('.ProseMirror p').last().click();
    await expectToolbarUnderTopBar(next.getByRole('toolbar', { name: 'Text formatting' }));
    await expect(toolbar).not.toBeInViewport();

    // On a phone the top bar sits under the phone bar and wraps; the toolbar stays under both.
    await page.setViewportSize({ width: 390, height: 844 });
    await next.locator('.ProseMirror p').nth(-3).scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 400);
    await expectToolbarUnderTopBar(next.getByRole('toolbar', { name: 'Text formatting' }));
    await page.setViewportSize({ width: 1360, height: 900 });
  });
});

test('choosing a heading keeps the cursor in the text; shortcut hints name the real key', async () => {
  const api = adminApiFor(page.request, ADMIN_API);
  const suffix = randomUUID().slice(0, 8);
  const ids = { model: randomUUID(), title: randomUUID() };
  const key = `headingNote${suffix}`;
  await api.createDefinition('models', {
    id: ids.model,
    kind: 'collection',
    apiKey: key,
    label: 'Heading note',
    display: { layout: 'form', titleFieldId: ids.title },
    fields: [
      { id: ids.title, apiKey: 'title', label: 'Title', type: 'string' },
      { id: randomUUID(), apiKey: 'body', label: 'Body', type: 'richtext' },
    ],
  });
  longDocument.models.push(ids.model);
  const entry = await api.send<{ id: string }>('POST', `/content/${key}`, {
    data: { title: 'Harbor log', body: null },
  });
  await page.goto(`${ADMIN_URL}content/${key}/${entry.id}`);
  await expect(entryForm()).toBeVisible();
  const body = entryDocument(page).field('/body');
  const editor = body.locator('.ProseMirror');
  const toolbar = body.getByRole('toolbar', { name: 'Text formatting' });

  await test.step('the Bold tooltip shows ⌘B or Ctrl+B, never Mod', async () => {
    const tooltip = page.getByRole('tooltip');
    for (const scheme of ['light', 'dark'] as const) {
      const restore = await renderScheme(page, scheme);
      await toolbar.getByRole('button', { name: 'Bold' }).hover();
      await expect(tooltip).toHaveText(/^Bold \((⌘B|Ctrl\+B)\)$/);
      await page.waitForFunction(() =>
        document.getAnimations().every((animation) => animation.playState !== 'running'),
      );
      // The tooltip is portaled above the toolbar: capture both together.
      const box = await toolbar.boundingBox();
      if (box) {
        const clip = { x: box.x, y: box.y - 48, width: box.width, height: box.height + 48 };
        await page.screenshot({
          path: join(SCREENSHOT_DIR, `richtext-shortcut-tooltip-${scheme}.png`),
          clip,
        });
      }
      await page.mouse.move(0, 0);
      await restore();
    }
  });

  await test.step('a heading chosen from the select takes the typing, and Mod+B still bolds', async () => {
    await editor.click();
    const blockType = toolbar.getByRole('combobox', { name: 'Text style' });
    await blockType.click();
    await page.getByRole('option', { name: 'Heading 2', exact: true }).click();
    await expect(blockType).toHaveText('Heading 2');
    await expect(editor).toBeFocused();
    await page.keyboard.type('Tides');
    await expect(editor.locator('h2')).toHaveText('Tides');
    // Select the word with the keyboard only (a click would put the focus back by itself); the heading is
    // the whole document.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+b');
    await expect(editor.locator('h2 strong')).toHaveText('Tides');
    await editor.locator('h2').click();
    await blockType.click();
    await captureInBothLooks('richtext-heading-select', page.getByRole('listbox'));
    await page.keyboard.press('Escape');
    // Escape without a choice leaves the focus on the select, as for any select.
    await expect(blockType).toBeFocused();
  });

  await test.step('an image chosen from the toolbar keeps the cursor in the text', async () => {
    const image = await api.uploadPng(`buoy-${suffix}.png`, 64, 64);
    longDocument.assets.push(image.id);
    await editor.click();
    await toolbar.getByRole('button', { name: 'Insert image' }).click();
    const picker = page.getByRole('dialog', { name: /Choose (a file|files)/ });
    await expect(picker).toBeVisible();
    await picker.getByRole('checkbox', { name: `Select buoy-${suffix}.png` }).check();
    await picker.getByRole('button', { name: 'Choose file', exact: true }).click();
    await expect(picker).toBeHidden();
    await expect(editor.locator(`figure[data-media-id="${image.id}"]`)).toBeVisible();
    await expect(editor).toBeFocused();
  });
});
