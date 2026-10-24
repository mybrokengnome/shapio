import { expect, test, type Locator, type Page } from '@playwright/test';
import { adminApiFor, id, type AdminApi } from './content/api';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * Interfaces on the schema side (plan interfaces D11, part 1 of the interfaces e2e): an interface is created
 * in Develop → Interfaces with a contract field; a type implements it from its builder and its matching
 * field is badged; renaming that field is refused with the interface named; adding a contract field that
 * the members lack offers to add it to them in one change set, which ships; a relation targets the
 * interface, then any entry, and the field list and the settings summary say what each points at or
 * implements; the Target select lists a kind under its type. Fixtures that aren't under test go through the
 * admin API. API IDs carry an
 * `ifs` prefix so they never meet another spec's. Captured light and dark with axe.
 */
test.describe.configure({ mode: 'serial' });

type ListItem = { definition: { id: string; apiKey: string; fields: { apiKey: string }[] }; version: number };

const FLAGS = { localized: false, draftAndPublish: true } as const;

/** A collection with a plain `title`: it satisfies a contract that asks for a `title` string. */
const titled = (apiKey: string, label: string, extra: Record<string, unknown> = {}) => {
  const title = id();
  return {
    id: id(),
    kind: 'collection',
    apiKey,
    label,
    ...FLAGS,
    display: { titleFieldId: title },
    fields: [{ id: title, apiKey: 'title', label: 'Title', type: 'string' }],
    ...extra,
  };
};

const article = titled('ifsArticle', 'Ifs articles');

let page: Page;
let api: AdminApi;
const pageErrors: string[] = [];
/** Created here, removed in `afterAll`: members before the interface. */
const created = { spotlight: '', note: '', feature: '', changeSet: '' };

const properties = () => page.getByRole('region', { name: / properties$/ });
const reviewButton = () => page.getByRole('button', { name: 'Review', exact: true });

const definitions = async (category: 'models' | 'interfaces') =>
  (await api.get<{ items: ListItem[] }>(`/${category}`)).items;

/** The collapsed settings panel, where the summary shows. */
const closeModelSettings = async () => {
  const toggle = page.getByRole('button', { name: 'Model settings' });
  if ((await toggle.getAttribute('aria-expanded')) === 'true') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
};

const openModelSettings = async (control: Locator) => {
  if (!(await control.isVisible())) {
    await page.getByRole('button', { name: 'Model settings' }).click();
  }
  await expect(control).toBeVisible();
};

const shipReview = async () => {
  await reviewButton().click();
  const plan = page.getByRole('dialog', { name: /^Review changes to / });
  const acknowledge = plan.getByRole('checkbox');
  for (const box of await acknowledge.all()) {
    await box.check();
  }
  await plan.getByRole('button', { name: 'Ship now' }).click();
  await expect(plan).toBeHidden({ timeout: 30_000 });
};

const removeDefinition = async (category: 'models' | 'interfaces', definitionId: string) => {
  if (!definitionId) {
    return;
  }
  const found = await page.request.get(`${ADMIN_API}/${category}/${definitionId}`);
  if (found.ok()) {
    const { version } = (await found.json()) as { version: number };
    await adminRequest(
      page.request,
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
  await api.createDefinition('models', article);
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  if (created.changeSet) {
    const set = await page.request.get(`${ADMIN_API}/change-sets/${created.changeSet}`);
    if (set.ok() && ((await set.json()) as { status: string }).status === 'open') {
      await adminRequest(page.request, 'POST', `/change-sets/${created.changeSet}/discard`);
    }
  }
  // Members first: an interface can't be deleted while a type implements it.
  await removeDefinition('models', created.note);
  await removeDefinition('models', created.feature);
  await removeDefinition('models', article.id);
  await removeDefinition('interfaces', created.spotlight);
  await page.context().close();
});

test('an interface is created in Develop → Interfaces with a contract field', async () => {
  await page.goto(`${ADMIN_URL}develop/interfaces`);
  await expect(page.getByRole('heading', { level: 1, name: 'Interfaces' })).toBeVisible();
  await page.getByRole('link', { name: 'New interface' }).first().click();
  const form = page.getByRole('main');
  await expect(page.getByRole('heading', { level: 1, name: 'New interface' })).toBeVisible();
  await form.getByLabel('Label', { exact: true }).fill('Spotlight');
  await form.getByLabel('API ID', { exact: true }).fill('ifsSpotlight');
  await expect(form.getByLabel('Plural API ID', { exact: true })).toHaveValue('ifsSpotlights');
  await expect(form.getByText('/api/content/ifsSpotlights', { exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Spotlight' })).toBeVisible();
  created.spotlight =
    (await definitions('interfaces')).find((item) => item.definition.apiKey === 'ifsSpotlight')?.definition
      .id ?? '';
  expect(created.spotlight).not.toBe('');

  await page.getByRole('button', { name: 'Add field' }).click();
  await expect(properties().getByLabel('Label', { exact: true })).toBeFocused();
  await page.keyboard.type('Title');
  // A contract has no components, no editor, and only the flags members must match.
  await expect(properties().getByRole('radio', { name: /^Component/ })).toHaveCount(0);
  await expect(properties().getByRole('switch', { name: 'Unique' })).toHaveCount(0);
  await expect(properties().getByRole('switch', { name: 'Required' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Members' })).toContainText('No type implements it yet.');
  await shipReview();
  await expect(page.getByText('· version 2')).toBeVisible({ timeout: 30_000 });
  await captureScreen(page, 'interfaces-01-builder', { viewports: ['desktop'] });
});

test('a type implements it from its builder and its title is badged', async () => {
  await page.goto(`${ADMIN_URL}models/${article.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Ifs articles' })).toBeVisible();
  const spotlight = page.getByRole('checkbox', { name: 'Spotlight', exact: true });
  await openModelSettings(spotlight);
  await spotlight.check();
  await expect(page.getByText('Required by Spotlight')).toBeVisible();
  await shipReview();
  await expect(page.getByText('· version 2')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Required by Spotlight')).toBeVisible();
  await captureScreen(page, 'interfaces-02-implements', { viewports: ['desktop'] });
  // Collapsed, the settings say what the type implements.
  await closeModelSettings();
  await expect(page.getByText('Implements Spotlight', { exact: true })).toBeVisible();
});

test('renaming a field the interface requires is refused, naming the interface', async () => {
  await page
    .getByRole('button', { name: /^Title\b/ })
    .first()
    .click();
  await expect(properties().getByText(/^Required by Spotlight: keep its API ID/)).toBeVisible();
  const apiId = properties().getByLabel('API ID', { exact: true });
  await apiId.fill('headline');
  await expect(properties().getByText('"title" is required by Spotlight.')).toBeVisible();
  await expect(reviewButton()).toBeDisabled();
  await page.getByRole('button', { name: 'Discard changes' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click();
  await expect(apiId).toHaveValue('title');
});

test('a contract field the members lack is offered to them in one change set', async () => {
  // A second member, made through the API.
  const note = titled('ifsNote', 'Ifs notes', { implements: [created.spotlight] });
  await api.createDefinition('models', note);
  created.note = note.id;

  await page.goto(`${ADMIN_URL}develop/interfaces/${created.spotlight}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Spotlight' })).toBeVisible();
  const members = page.getByRole('region', { name: 'Members' });
  await expect(members.getByRole('link', { name: 'Ifs articles' })).toBeVisible();
  await expect(members.getByRole('link', { name: 'Ifs notes' })).toBeVisible();

  await page.getByRole('button', { name: 'Add field' }).click();
  await expect(properties().getByLabel('Label', { exact: true })).toBeFocused();
  await page.keyboard.type('Image');
  await properties()
    .getByRole('radio', { name: /^Media/ })
    .check();
  await expect(members.getByText('"image" is required by Spotlight.').first()).toBeVisible();
  await reviewButton().click();
  const sheet = page.getByRole('dialog', { name: 'Some members lack these fields' });
  await expect(sheet.getByRole('link', { name: 'Ifs articles' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Ifs notes' })).toBeVisible();
  await captureScreen(page, 'interfaces-03-offer', { viewports: ['desktop'] });
  await sheet.getByRole('button', { name: 'Add "image" to these 2 types' }).click();
  await expect(page).toHaveURL(/\/changes\/[0-9a-f-]+/);
  created.changeSet = /\/changes\/([0-9a-f-]+)/.exec(page.url())?.[1] ?? '';

  // The set holds the interface and both members; shipped, every member has the field.
  const set = await api.get<{ version: number; items: { kind: string }[] }>(
    `/change-sets/${created.changeSet}`,
  );
  expect(set.items.filter((item) => item.kind === 'schema')).toHaveLength(3);
  await api.send('POST', `/change-sets/${created.changeSet}/ship`, {
    expectedVersion: set.version,
    acknowledgeBreaking: true,
  });
  await expect
    .poll(
      async () => {
        const models = await definitions('models');
        return [article.id, note.id].map(
          (modelId) =>
            models
              .find((item) => item.definition.id === modelId)
              ?.definition.fields.some((field) => field.apiKey === 'image') ?? false,
        );
      },
      { timeout: 30_000 },
    )
    .toEqual([true, true]);
});

test('a relation targets the interface, or any entry, and its row says which', async () => {
  // A kind of Ifs articles: it implements Spotlight through its type, and is listed under it as a target.
  const feature = {
    id: id(),
    kind: 'collection',
    apiKey: 'ifsFeature',
    label: 'Ifs features',
    extends: article.id,
    display: article.display,
    fields: [],
  };
  await api.createDefinition('models', feature);
  created.feature = feature.id;
  await page.goto(`${ADMIN_URL}models/${feature.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Ifs features' })).toBeVisible();
  await expect(page.getByText('Kind of Ifs articles', { exact: true })).toBeVisible();
  await expect(page.getByText('Implements Spotlight (via Ifs articles)', { exact: true })).toBeVisible();

  await page.goto(`${ADMIN_URL}models/${created.note}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Ifs notes' })).toBeVisible();
  await closeModelSettings();
  await expect(page.getByText('Implements Spotlight', { exact: true })).toBeVisible();
  await captureScreen(page, 'interfaces-05-summary', { viewports: ['desktop'] });
  await page.getByRole('button', { name: 'Add field' }).click();
  await expect(properties().getByLabel('Label', { exact: true })).toBeFocused();
  await page.keyboard.type('Featured');
  await properties()
    .getByRole('radio', { name: /^Relation/ })
    .check();
  const target = properties().getByRole('combobox', { name: 'Target model', exact: true });
  const row = page.getByRole('button', { name: /^Featured/ }).first();
  await target.click();
  await expect(page.getByRole('group', { name: 'Interfaces' })).toBeVisible();
  // The kind is listed once, right under its type, indented.
  const types = page.getByRole('group', { name: 'Types' }).getByRole('option');
  const labels = await types.allTextContents();
  const parentAt = labels.indexOf('Ifs articles and 1 kind');
  expect(parentAt).toBeGreaterThanOrEqual(0);
  expect(labels[parentAt + 1]).toBe('Ifs features');
  expect(labels.filter((label) => label === 'Ifs features')).toHaveLength(1);
  await expect(page.getByRole('option', { name: 'Ifs features', exact: true })).toHaveClass(/\bpl-6\b/);
  // Without a viewport change, so the list stays open for the capture; it may still close, so reopen it.
  await captureScreen(page, 'interfaces-06-target-open');
  if ((await target.getAttribute('aria-expanded')) !== 'true') {
    await target.click();
  }
  await page.getByRole('option', { name: 'Spotlight', exact: true }).click();
  await expect(target).toHaveText('Spotlight');
  await expect(row).toContainText('→ Spotlight (interface)');
  await captureScreen(page, 'interfaces-07-relation-row', { viewports: ['desktop'] });
  await target.click();
  await page.getByRole('option', { name: 'Ifs articles and 1 kind', exact: true }).click();
  await expect(row).toContainText('→ Ifs articles and 1 kind');
  await target.click();
  await page.getByRole('option', { name: 'Any entry', exact: true }).click();
  await expect(target).toHaveText('Any entry');
  await expect(row).toContainText('→ Any entry');
  await captureScreen(page, 'interfaces-04-relation-target', { viewports: ['desktop'] });
  await page.getByRole('button', { name: 'Discard changes' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click();
});
