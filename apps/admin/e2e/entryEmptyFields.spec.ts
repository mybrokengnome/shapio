import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { entryDocument } from './support/entryDocument';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * Empty component fields in the entry document: every canvas field carries its heading (so two lists of
 * the same component tell apart, and an empty one is visible), an empty list says so and offers "Add …",
 * and a single component in the settings drawer opens on click to its "Add …" button. Captured in Shapio
 * and Snowed with axe.
 */
test.describe.configure({ mode: 'serial' });

const id = () => randomUUID();
const ids = { textItem: id(), fact: id(), promo: id(), model: id(), headline: id(), plain: id(), name: id() };

let page: Page;
let entryUrl = '';
const pageErrors: string[] = [];

const getJson = async <T>(path: string) =>
  (await (await page.request.get(`${ADMIN_API}${path}`)).json()) as T;

/** The canvas field's heading row (label + rule): shown at full strength, not only on hover. */
const headingOf = (field: Locator, label: string) =>
  field.locator('[data-canvas-heading]').filter({ hasText: label });

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  const component = (componentId: string, apiKey: string, label: string, fields: unknown[]) =>
    adminRequest(page.request, 'POST', '/components', {
      definition: { id: componentId, kind: 'component', apiKey, label, fields },
    });
  await component(ids.textItem, 'textItem', 'Text item', [
    { id: id(), apiKey: 'text', label: 'Text', type: 'string' },
  ]);
  await component(ids.fact, 'fact', 'Fact', [
    { id: id(), apiKey: 'label', label: 'Label', type: 'string' },
    { id: id(), apiKey: 'value', label: 'Value', type: 'string' },
  ]);
  await component(ids.promo, 'promo', 'Promo', [
    { id: id(), apiKey: 'headline', label: 'Headline', type: 'string' },
  ]);
  const list = (apiKey: string, label: string, componentId: string, limits: object = {}) => ({
    id: id(),
    apiKey,
    label,
    type: 'component',
    settings: { component: componentId, repeatable: true, ...limits },
  });
  await adminRequest(page.request, 'POST', '/models', {
    definition: {
      id: ids.model,
      kind: 'collection',
      apiKey: 'homePage',
      label: 'Home page',
      display: { titleFieldId: ids.headline },
      fields: [
        { id: ids.headline, apiKey: 'heroHeadline', label: 'Hero headline', type: 'string' },
        { id: id(), apiKey: 'heroIntro', label: 'Hero intro', type: 'text' },
        { ...list('indexItems', 'Index items', ids.textItem, { min: 1 }), required: true },
        list('footerTagline', 'Footer tagline', ids.textItem, { min: 1, max: 6 }),
        {
          id: id(),
          apiKey: 'featured',
          label: 'Featured',
          type: 'component',
          required: true,
          settings: { component: ids.promo },
        },
        list('aboutFacts', 'About facts', ids.fact),
        { id: id(), apiKey: 'newField', label: 'New field', type: 'string' },
        {
          id: id(),
          apiKey: 'banner',
          label: 'Banner',
          type: 'component',
          settings: { component: ids.promo },
        },
        {
          id: id(),
          apiKey: 'sections',
          label: 'Sections',
          type: 'dynamiczone',
          settings: { components: [ids.textItem, ids.fact], min: 2 },
        },
      ],
    },
  });
  // No canvas fields: the document is the property grid, where a single component is a labelled line.
  await adminRequest(page.request, 'POST', '/models', {
    definition: {
      id: ids.plain,
      kind: 'collection',
      apiKey: 'promoSlot',
      label: 'Promo slot',
      display: { titleFieldId: ids.name },
      fields: [
        { id: ids.name, apiKey: 'name', label: 'Name', type: 'string' },
        { id: id(), apiKey: 'promo', label: 'Promo', type: 'component', settings: { component: ids.promo } },
      ],
    },
  });
  for (const modelId of [ids.model, ids.plain]) {
    await expect
      .poll(async () => (await page.request.get(`${ADMIN_API}/models/${modelId}`)).status())
      .toBe(200);
  }
  const created = await adminRequest(page.request, 'POST', '/content/homePage', {
    data: {
      heroHeadline: 'Brad home',
      indexItems: [{ text: 'Useful things' }],
      featured: { headline: 'Latest' },
      aboutFacts: [{ label: 'Based in', value: 'Ohio' }],
    },
  });
  const entry = (await created.json()) as { id: string };
  entryUrl = `${ADMIN_URL}content/homePage/${entry.id}`;
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  // Later specs expect an empty model list and no shared components.
  for (const modelId of [ids.model, ids.plain]) {
    const model = await page.request.get(`${ADMIN_API}/models/${modelId}`);
    if (model.ok()) {
      const { version } = (await model.json()) as { version: number };
      await adminRequest(page.request, 'DELETE', `/models/${modelId}?expectedVersion=${version}`);
    }
  }
  for (const componentId of [ids.textItem, ids.fact, ids.promo]) {
    const { version } = await getJson<{ version: number }>(`/components/${componentId}`);
    await adminRequest(page.request, 'DELETE', `/components/${componentId}?expectedVersion=${version}`);
  }
  await page.context().close();
});

test('every list in the document is headed, and an empty one offers "Add …"', async () => {
  const doc = entryDocument(page);
  await page.goto(entryUrl);
  await expect(page.getByRole('heading', { level: 1, name: 'Brad home' })).toBeVisible();
  await page.mouse.move(0, 0);

  // Two lists of the same component are told apart by their headings, shown without hovering.
  for (const [path, label] of [
    ['/indexItems', 'Index items'],
    ['/footerTagline', 'Footer tagline'],
    ['/aboutFacts', 'About facts'],
  ] as const) {
    const heading = headingOf(doc.field(path), label);
    await expect(heading).toBeVisible();
    await expect(heading).toHaveCSS('opacity', '1');
  }

  // The empty list says so and offers its component.
  const footer = doc.field('/footerTagline');
  await expect(footer.getByText('Nothing added yet.')).toBeVisible();
  const add = footer.getByRole('button', { name: 'Add Text item' });
  await expect(add).toBeVisible();
  await captureScreen(page, 'entry-empty-01-document', { viewports: ['desktop'] });

  await add.click();
  // Focus lands on the new item's header; its field is ready to fill.
  await expect(footer.getByRole('button', { name: /^Text item/, expanded: true })).toBeFocused();
  await expect(footer.getByText('Nothing added yet.')).toHaveCount(0);
  await footer.locator('[data-field-path="/footerTagline/0/text"]').getByRole('textbox').fill('Made in Ohio');
  // A list with items keeps adding at its end.
  await expect(footer.getByRole('button', { name: 'Add Text item' })).toBeVisible();
  await expect(doc.field('/aboutFacts').getByRole('button', { name: 'Add Fact' })).toBeVisible();
  await captureScreen(page, 'entry-empty-02-filled', { viewports: ['desktop'] });
});

test('an empty zone says so, names its minimum, and adds a section from its menu', async () => {
  const doc = entryDocument(page);
  await page.goto(entryUrl);
  const sections = doc.field('/sections');
  await expect(headingOf(sections, 'Sections')).toHaveCSS('opacity', '1');
  await expect(sections.getByText('Nothing added yet.')).toBeVisible();
  // A min of 2 changes what the person does: one section is not enough.
  await expect(sections.getByText('Add at least 2 items.')).toBeVisible();
  await sections.getByRole('button', { name: 'Add section' }).click();
  await expect(page.getByRole('menuitem', { name: 'Fact', exact: true })).toBeVisible();
  await captureScreen(page, 'entry-empty-05-zone-menu', { viewports: ['desktop'] });
  await page.getByRole('menuitem', { name: 'Fact', exact: true }).click();
  await expect(sections.getByRole('button', { name: /^Fact/, expanded: true })).toBeFocused();
  await expect(sections.getByText('Nothing added yet.')).toHaveCount(0);
  await expect(sections.locator('[data-field-path="/sections/0/label"]').getByRole('textbox')).toBeVisible();
});

test('a single component property opens on click and offers "Add …" when empty', async () => {
  const doc = entryDocument(page);
  await page.goto(entryUrl);
  const drawer = await doc.openSettings();
  const row = drawer.locator('[data-property-row="banner"]');
  await expect(row.getByRole('button', { name: /Banner/ })).toHaveAttribute('aria-expanded', 'false');
  await row.getByRole('button', { name: /Banner/ }).click();
  await expect(row.getByRole('button', { name: /Banner/ })).toHaveAttribute('aria-expanded', 'true');
  const addPromo = row.getByRole('button', { name: 'Add Promo' });
  await expect(addPromo).toBeVisible();
  await captureScreen(page, 'entry-empty-03-property', { viewports: ['desktop'] });
  await addPromo.click();
  await expect(row.locator('[data-field-path="/banner/headline"]').getByRole('textbox')).toBeVisible();

  // A filled one opens to its editor too.
  const featured = drawer.locator('[data-property-row="featured"]');
  await featured.getByRole('button', { name: /Featured/ }).click();
  await expect(featured.locator('[data-field-path="/featured/headline"]').getByRole('textbox')).toHaveValue(
    'Latest',
  );
});

test('in a property-only document, an empty single component is labelled and offers "Add …"', async () => {
  const created = await adminRequest(page.request, 'POST', '/content/promoSlot', {
    data: { name: 'Sidebar' },
  });
  const entry = (await created.json()) as { id: string };
  await page.goto(`${ADMIN_URL}content/promoSlot/${entry.id}`);
  const grid = page.locator('[data-property-grid]');
  const promo = grid.locator('[data-field-path="/promo"]');
  await expect(promo.getByText('Promo', { exact: true })).toBeVisible();
  await expect(promo.getByRole('button', { name: 'Add Promo' })).toBeVisible();
  await captureScreen(page, 'entry-empty-04-property-grid', { viewports: ['desktop'] });
});
