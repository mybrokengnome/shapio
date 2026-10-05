import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { SEO_COMPONENT_ID, SEO_EDITOR_ID } from '@shapio/schema';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * Field placement (plan field-placement): the entry's Settings panel is open by default on wide screens and
 * remembers being closed; "Show in document" in the builder puts a string and the SEO group in the
 * document, where they are labelled sections, edited and saved, and leave the strip; a model without block
 * fields keeps its property grid under the field placed in the document. Captured in Shapio and Snowed
 * with axe.
 */
test.describe.configure({ mode: 'serial' });

const UPDATED = 'Model updated — no restart needed';
const ids = { article: randomUUID(), title: randomUUID(), tag: randomUUID(), name: randomUUID() };
const color = randomUUID();

let page: Page;
const pageErrors: string[] = [];

const getJson = async <T>(path: string) =>
  (await (await page.request.get(`${ADMIN_API}${path}`)).json()) as T;

const drawer = () => page.locator('#entry-settings');
const settingsButton = () => page.getByRole('button', { name: 'Settings', exact: true });
const strip = () => page.getByRole('group', { name: 'Properties' });
const documentField = (apiKey: string) => page.locator(`[data-canvas] [data-field-path="/${apiKey}"]`);

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  await adminRequest(page.request, 'POST', '/components/builtin/seo/ensure');
  await adminRequest(page.request, 'POST', '/models', {
    definition: {
      id: ids.article,
      kind: 'collection',
      apiKey: 'placedArticle',
      label: 'Placed article',
      display: { titleFieldId: ids.title },
      fields: [
        { id: ids.title, apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'excerpt', label: 'Excerpt', type: 'text' },
        { apiKey: 'publishOn', label: 'Publish on', type: 'date' },
        { apiKey: 'body', label: 'Body', type: 'richtext' },
        {
          apiKey: 'seo',
          label: 'SEO',
          type: 'component',
          settings: { component: SEO_COMPONENT_ID },
          editor: { id: SEO_EDITOR_ID },
        },
      ],
    },
  });
  // No block fields: the document is the property grid, under the one field placed in the document.
  await adminRequest(page.request, 'POST', '/models', {
    definition: {
      id: ids.tag,
      kind: 'collection',
      apiKey: 'placedTag',
      label: 'Placed tag',
      display: { titleFieldId: ids.name, canvasFieldIds: [color] },
      fields: [
        { id: ids.name, apiKey: 'name', label: 'Name', type: 'string' },
        { id: color, apiKey: 'color', label: 'Color', type: 'string' },
        { apiKey: 'note', label: 'Note', type: 'text' },
      ],
    },
  });
  for (const modelId of [ids.article, ids.tag]) {
    await expect
      .poll(async () => (await page.request.get(`${ADMIN_API}/models/${modelId}`)).status())
      .toBe(200);
  }
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  // Later specs expect an empty model list and no shared components.
  for (const modelId of [ids.article, ids.tag]) {
    const model = await page.request.get(`${ADMIN_API}/models/${modelId}`);
    if (model.ok()) {
      const { version } = (await model.json()) as { version: number };
      await adminRequest(page.request, 'DELETE', `/models/${modelId}?expectedVersion=${version}`);
    }
  }
  const component = await page.request.get(`${ADMIN_API}/components/${SEO_COMPONENT_ID}`);
  if (component.ok()) {
    const { version } = (await component.json()) as { version: number };
    await adminRequest(page.request, 'DELETE', `/components/${SEO_COMPONENT_ID}?expectedVersion=${version}`);
  }
  await page.context().close();
});

test('the Settings panel is open on a wide screen, keeps focus in the document, and stays closed', async () => {
  await page.goto(`${ADMIN_URL}content/placedArticle/new`);
  await expect(drawer()).toBeVisible();
  await expect(settingsButton()).toHaveAttribute('aria-expanded', 'true');
  // The default open doesn't take focus: nothing in the drawer has it.
  expect(await drawer().evaluate((element) => element.contains(document.activeElement))).toBe(false);
  await captureScreen(page, 'placement-01-drawer-default');

  await settingsButton().click();
  await expect(drawer()).toBeHidden();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Title' }).first()).toBeVisible();
  await expect(drawer()).toBeHidden();
  await settingsButton().click();
  await expect(drawer()).toBeVisible();
  await page.reload();
  await expect(drawer()).toBeVisible();
});

test('builder: "Show in document" for a string and the SEO group ships through the review', async () => {
  await page.goto(`${ADMIN_URL}models/${ids.article}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Placed article' })).toBeVisible();
  const fields = page.getByRole('list', { name: /^\d+ fields?$/ });
  const inDocument = page.getByRole('switch', { name: 'Show in document' });

  await fields.getByRole('button', { name: /^Title\b/ }).click();
  await expect(inDocument).toBeDisabled();
  await expect(page.getByText("The title is the document's heading.")).toBeVisible();

  await fields.getByRole('button', { name: /^Body\b/ }).click();
  await expect(inDocument).toBeChecked();
  await expect(inDocument).toBeDisabled();

  await fields.getByRole('button', { name: /^Excerpt\b/ }).click();
  await expect(inDocument).not.toBeChecked();
  await inDocument.click();
  await expect(inDocument).toBeChecked();
  await fields.getByRole('button', { name: /^SEO\b/ }).click();
  await inDocument.click();
  await expect(inDocument).toBeChecked();
  await captureScreen(page, 'placement-02-builder-switch');

  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const plan = page.getByRole('dialog', { name: /^Review changes to / });
  await expect(plan).toBeVisible();
  await plan.getByRole('button', { name: 'Ship now' }).click();
  await expect(plan).toBeHidden();
  await expect(page.getByText(UPDATED).first()).toBeVisible({ timeout: 30_000 });

  const model = await getJson<{
    definition: { fields: { id: string; apiKey: string }[]; display: { canvasFieldIds?: string[] } };
  }>(`/models/${ids.article}`);
  const idOf = (apiKey: string) => model.definition.fields.find((field) => field.apiKey === apiKey)?.id;
  expect(model.definition.display.canvasFieldIds).toEqual([idOf('excerpt'), idOf('body'), idOf('seo')]);
});

test('the entry shows the string and the SEO group as sections of the document and saves them', async () => {
  await page.goto(`${ADMIN_URL}content/placedArticle/new`);
  await page.getByRole('textbox', { name: 'Title' }).first().fill('Placed in the page');

  const excerpt = documentField('excerpt');
  await expect(excerpt.locator('[data-canvas-heading]')).toContainText('Excerpt');
  await excerpt.getByRole('textbox', { name: 'Excerpt' }).fill('Written where it is read.');
  const seo = documentField('seo');
  await expect(seo.locator('[data-canvas-heading]')).toContainText('SEO');
  await seo.getByRole('textbox', { name: 'Description', exact: true }).fill('A page about placement.');
  await expect(seo.getByRole('region', { name: 'Search result preview' })).toContainText(
    'A page about placement.',
  );
  // Neither is a property any more: not in the strip, not in the Settings panel.
  await expect(strip().getByRole('button', { name: /^(Excerpt|SEO)/ })).toHaveCount(0);
  await expect(drawer().locator('[data-property-row="excerpt"]')).toHaveCount(0);
  await expect(drawer().locator('[data-property-row="seo"]')).toHaveCount(0);
  await expect(drawer().locator('[data-property-row="publishOn"]')).toHaveCount(1);
  await captureScreen(page, 'placement-03-entry-document');

  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/content\/placedArticle\/[0-9a-f-]{36}/);
  const entryId = /\/content\/placedArticle\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  const entry = await getJson<{ data: { excerpt: string; seo: { description: string } } }>(
    `/content/placedArticle/${entryId}`,
  );
  expect(entry.data.excerpt).toBe('Written where it is read.');
  expect(entry.data.seo).toMatchObject({ description: 'A page about placement.' });
});

test('a model without block fields keeps its property grid under the field placed in the document', async () => {
  await page.goto(`${ADMIN_URL}content/placedTag/new`);
  await expect(documentField('color').locator('[data-canvas-heading]')).toContainText('Color');
  const grid = page.locator('[data-property-grid]');
  await expect(grid.locator('[data-field-path="/note"]')).toBeVisible();
  await expect(grid.locator('[data-field-path="/color"]')).toHaveCount(0);
  await expect(strip()).toHaveCount(0);
  await captureScreen(page, 'placement-04-grid-under-document');
});
