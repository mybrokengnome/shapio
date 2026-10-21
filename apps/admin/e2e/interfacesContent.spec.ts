import { expect, test, type Page } from '@playwright/test';
import { adminApiFor, id, type AdminApi } from './content/api';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { ADMIN_API, signInAsOwner } from './support/session';

/**
 * Interfaces on the content side (plan interfaces D11, part 2 of the interfaces e2e): a relation to the
 * interface Featurable links a blog post, a guide, and the About singleton; the picker searches across the
 * member types through the content-targets endpoint, filters by type, names each result's and each linked
 * entry's type, and creates a member inline. Fixtures go through the admin API, never the UI under test.
 * API IDs carry an `ifc` prefix so they never meet another spec's.
 */
test.describe.configure({ mode: 'serial' });

const FEATURABLE_ID = id();
const CONTRACT_TITLE = id();
const FLAGS = { localized: false, draftAndPublish: true } as const;

const featurable = {
  id: FEATURABLE_ID,
  kind: 'interface',
  apiKey: 'ifcFeaturable',
  pluralApiKey: 'ifcFeaturables',
  label: 'Featurable',
  display: { titleFieldId: CONTRACT_TITLE },
  fields: [
    {
      id: CONTRACT_TITLE,
      apiKey: 'title',
      label: 'Title',
      type: 'string',
      required: true,
      filterable: true,
      sortable: true,
    },
  ],
};

/** A member: its own `title` satisfies the contract (same API ID, type, and flags). */
const member = (kind: 'collection' | 'singleton', apiKey: string, label: string) => {
  const title = id();
  return {
    id: id(),
    kind,
    apiKey,
    label,
    ...FLAGS,
    implements: [FEATURABLE_ID],
    display: { titleFieldId: title },
    fields: [
      {
        id: title,
        apiKey: 'title',
        label: 'Title',
        type: 'string',
        required: true,
        filterable: true,
        sortable: true,
      },
    ],
  };
};

const blogPost = member('collection', 'ifcBlogPost', 'Blog posts');
const guide = member('collection', 'ifcGuide', 'Guides');
const about = member('singleton', 'ifcAbout', 'About');

const SHOWCASE_TITLE = id();
const showcase = {
  id: id(),
  kind: 'collection',
  apiKey: 'ifcShowcase',
  label: 'Showcases',
  ...FLAGS,
  display: { layout: 'form', titleFieldId: SHOWCASE_TITLE },
  fields: [
    { id: SHOWCASE_TITLE, apiKey: 'name', label: 'Name', type: 'string' },
    {
      id: id(),
      apiKey: 'featured',
      label: 'Featured',
      type: 'relation',
      settings: { target: FEATURABLE_ID, cardinality: 'many' },
      editor: { id: 'relationPicker', options: { allowInlineCreate: true } },
    },
  ],
};

/** Created in this order; deleted in reverse (an interface can't be deleted while types implement it). */
const MODELS = [blogPost, guide, about, showcase];

let page: Page;
let api: AdminApi;
const pageErrors: string[] = [];
let showcaseId = '';

const createEntry = async (modelKey: string, data: Record<string, unknown>) =>
  (await api.send<{ id: string }>('POST', `/content/${modelKey}`, { data })).id;

const deleteDefinition = async (category: 'models' | 'interfaces', definitionId: string) => {
  const response = await page.request.get(`${ADMIN_API}/${category}/${definitionId}`);
  if (response.ok()) {
    const { version } = (await response.json()) as { version: number };
    await api.send(
      'DELETE',
      `/${category}/${definitionId}?expectedVersion=${version}&acknowledgeBreaking=true`,
    );
  }
};

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  api = adminApiFor(page.request, ADMIN_API);
  await api.send('POST', '/interfaces', { definition: featurable });
  for (const definition of MODELS) {
    await api.createDefinition('models', definition);
  }
  await createEntry('ifcBlogPost', { title: 'Launch notes' });
  await createEntry('ifcBlogPost', { title: 'Spring roadmap' });
  await createEntry('ifcGuide', { title: 'Getting started' });
  await createEntry('ifcAbout', { title: 'About the studio' });
  showcaseId = await createEntry('ifcShowcase', { name: 'Homepage' });
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  // Later specs expect an empty model list.
  for (const definition of [...MODELS].reverse()) {
    await deleteDefinition('models', definition.id);
  }
  await deleteDefinition('interfaces', FEATURABLE_ID);
  await page.context().close();
});

const featured = () => page.locator('[data-field-path="/featured"]');

test('a relation to an interface links entries of every member type and names each type', async () => {
  await page.goto(`${ADMIN_URL}content/ifcShowcase/${showcaseId}`);
  await featured().getByRole('button', { name: 'Add Featurable' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose Featurable' });
  await expect(picker.getByRole('option', { name: /Launch notes\s*Blog posts/ })).toBeVisible();
  await expect(picker.getByRole('option', { name: /Getting started\s*Guides/ })).toBeVisible();
  await expect(picker.getByRole('option', { name: /About the studio\s*About/ })).toBeVisible();
  await captureScreen(page, 'interfaces-relation-picker');

  // Search runs across the member types.
  await picker.getByRole('combobox', { name: 'Search Featurable' }).fill('start');
  await expect(picker.getByRole('option')).toHaveCount(1);
  await picker.getByRole('option', { name: /Getting started/ }).click();
  await picker.getByRole('combobox', { name: 'Search Featurable' }).fill('');

  // The type filter narrows to one member type.
  await picker.getByRole('combobox', { name: 'Type' }).click();
  await page.getByRole('option', { name: 'Blog posts' }).click();
  await expect(picker.getByRole('option', { name: /Spring roadmap/ })).toBeVisible();
  await expect(picker.getByRole('option', { name: /About the studio/ })).toHaveCount(0);
  await picker.getByRole('option', { name: /Launch notes/ }).click();
  await picker.getByRole('combobox', { name: 'Type' }).click();
  await page.getByRole('option', { name: 'About', exact: true }).click();
  await picker.getByRole('option', { name: /About the studio/ }).click();
  await picker.getByRole('button', { name: 'Done' }).click();

  // Each linked entry names its own type.
  const rows = featured().locator('[data-linked-entry]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Getting started');
  await expect(rows.nth(0)).toContainText('Guides');
  await expect(rows.nth(1)).toContainText('Launch notes');
  await expect(rows.nth(1)).toContainText('Blog posts');
  await expect(rows.nth(2)).toContainText('About the studio');
  await expect(rows.nth(2)).toContainText('About');
  await captureScreen(page, 'interfaces-relation-linked');

  // Saved and read back: the labels come from one lookup by IDs.
  const put = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().includes(`/content/ifcShowcase/${showcaseId}`) &&
      !response.request().postData()?.includes('"autosave":true'),
  );
  await page.keyboard.press('ControlOrMeta+s');
  expect((await put).ok()).toBe(true);
  await page.reload();
  await expect(featured().locator('[data-linked-entry]')).toHaveCount(3);
  await expect(featured().locator('[data-linked-entry]').nth(2)).toContainText('About the studio');
});

test('inline create offers the member types and links the new entry', async () => {
  await page.goto(`${ADMIN_URL}content/ifcShowcase/${showcaseId}`);
  await featured().getByRole('button', { name: 'Add Featurable' }).click();
  await page
    .getByRole('dialog', { name: 'Choose Featurable' })
    .getByRole('button', { name: 'Create a new entry' })
    .click();
  const sheet = page.getByRole('dialog', { name: 'New entry' });
  // The member collections, by label; the About singleton is never created inline.
  await sheet.getByRole('combobox', { name: 'Type' }).click();
  await expect(page.getByRole('option')).toHaveText(['Blog posts', 'Guides']);
  await page.getByRole('option', { name: 'Guides' }).click();
  await sheet.getByRole('textbox', { name: /^Title/ }).fill('Writing guide');
  const created = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/content/ifcGuide'),
  );
  await sheet.getByRole('button', { name: 'Create and link' }).click();
  expect((await created).status()).toBe(201);
  const rows = featured().locator('[data-linked-entry]');
  await expect(rows.last()).toContainText('Writing guide');
  await expect(rows.last()).toContainText('Guides');
});
