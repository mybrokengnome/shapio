import { expect, test, type Locator, type Page } from '@playwright/test';
import { adminApiFor, type AdminApi } from './content/api';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * Types that extend a type, on the schema side (plan polymorphic-types D13, D8): a Gear type is created in
 * the UI with a field, then Camera as a kind of it. The create form says Shape and offers Extends, which
 * locks the flags and nests the endpoint; Camera's builder lists Gear's field locked above its own; moving
 * Camera under another type is reviewed as a breaking change with the parents named; Gear can't be deleted
 * while it has a kind; the roles matrix puts Camera under Gear with what it inherits. Fixtures that aren't
 * under test go through the admin API. Captured light and dark with axe.
 */
test.describe.configure({ mode: 'serial' });

type ModelListItem = { definition: { id: string; apiKey: string }; version: number };

let page: Page;
let api: AdminApi;
const pageErrors: string[] = [];
/** Created here, removed in `afterAll`: kinds before the types they extend. */
const created = { gear: '', camera: '', tool: '', role: '' };

const nav = () => page.getByRole('navigation', { name: 'Main navigation' });
const properties = () => page.getByRole('region', { name: / properties$/ });
const ownFields = () => page.getByRole('list', { name: /^\d+ fields?$/ });
const inheritedFields = (from: string) => page.getByRole('list', { name: `Inherited from ${from}` });

const modelIdOf = async (apiKey: string) => {
  const { items } = await api.get<{ items: ModelListItem[] }>('/models');
  return items.find((item) => item.definition.apiKey === apiKey)?.definition.id ?? '';
};

/** Picks an option of a select (a Radix combobox) by its label. */
const choose = async (scope: Locator | Page, label: string, option: string) => {
  await scope.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(scope.getByRole('combobox', { name: label, exact: true })).toHaveText(option);
};

const openNewContentType = async () => {
  await page.goto(ADMIN_URL);
  await nav().getByRole('link', { name: 'New content type' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New content type' })).toBeVisible();
  return page.getByRole('main');
};

/** Opens a type's builder (the Structure tab of its place) by stable ID. */
const openBuilder = async (modelId: string, label: string) => {
  await page.goto(`${ADMIN_URL}models/${modelId}`);
  await expect(page).toHaveURL(/[?&]tab=structure/);
  await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible();
};

const openModelSettings = async () => {
  const extendsSelect = page.getByRole('combobox', { name: 'Extends', exact: true });
  if (!(await extendsSelect.isVisible())) {
    await page.getByRole('button', { name: 'Model settings' }).click();
  }
  await expect(extendsSelect).toBeVisible();
};

const removeModel = async (modelId: string) => {
  if (!modelId) {
    return;
  }
  const model = await page.request.get(`${ADMIN_API}/models/${modelId}`);
  if (model.ok()) {
    const { version } = (await model.json()) as { version: number };
    await adminRequest(
      page.request,
      'DELETE',
      `/models/${modelId}?expectedVersion=${version}&acknowledgeBreaking=true`,
    );
  }
};

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  api = adminApiFor(page.request, ADMIN_API);
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  // Later specs expect an empty model list; a type can't go while a kind extends it.
  if (created.role) {
    await adminRequest(page.request, 'DELETE', `/roles/${created.role}`);
  }
  for (const modelId of [created.camera, created.tool, created.gear]) {
    await removeModel(modelId);
  }
  await page.context().close();
});

test('a type with a field, created in the UI', async () => {
  const form = await openNewContentType();
  // The collection/single type choice is the type's Shape; "kind" means a member of a family.
  await expect(form.getByRole('group', { name: 'Shape' })).toBeVisible();
  await form.getByLabel('Label', { exact: true }).fill('Gear');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Gear' })).toBeVisible();
  created.gear = await modelIdOf('gear');

  await page.getByRole('button', { name: 'Add field' }).click();
  await expect(properties().getByLabel('Label', { exact: true })).toBeFocused();
  await page.keyboard.type('Name');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const plan = page.getByRole('dialog', { name: /^Review changes to / });
  await plan.getByRole('button', { name: 'Ship now' }).click();
  await expect(plan).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText('· version 2')).toBeVisible({ timeout: 30_000 });
});

test('a kind is created from the form: Extends locks the flags and nests the endpoint', async () => {
  const form = await openNewContentType();
  await form.getByLabel('Label', { exact: true }).fill('Camera');
  await expect(form.getByText('/api/content/cameras', { exact: true })).toBeVisible();
  await choose(form, 'Extends', 'Gear');
  await expect(form.getByText('/api/content/gears/cameras', { exact: true })).toBeVisible();
  await expect(form.getByRole('switch', { name: 'Localized' })).toBeDisabled();
  await expect(form.getByRole('switch', { name: 'Drafts and publishing' })).toBeDisabled();
  await expect(form.getByText('Same as Gear: a kind follows the type it extends.').first()).toBeVisible();
  await captureScreen(page, 'inheritance-01-new-kind', { viewports: ['desktop'] });
  // A single type can't extend anything.
  await form.getByRole('radio', { name: /^Singleton/ }).check();
  await expect(form.getByRole('combobox', { name: 'Extends', exact: true })).toHaveCount(0);
  await form.getByRole('radio', { name: /^Collection/ }).check();
  await choose(form, 'Extends', 'Gear');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Created — no restart needed.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Camera' })).toBeVisible();
  created.camera = await modelIdOf('camera');
});

test('the kind’s builder lists the inherited field locked, above its own', async () => {
  await openBuilder(created.camera, 'Camera');
  const inherited = inheritedFields('Gear');
  await expect(inherited.getByRole('button', { name: /^Name\b/ })).toBeVisible();
  // Locked: no drag handle and no move buttons.
  await expect(page.getByRole('button', { name: /^(Reorder Name|Move Name)/ })).toHaveCount(0);
  await expect(page.getByText('No fields of its own yet.')).toBeVisible();
  await expect(page.getByText('Kind of Gear')).toBeVisible();

  await inherited.getByRole('button', { name: /^Name\b/ }).click();
  await expect(properties().getByText('Change it there', { exact: false })).toBeVisible();
  await expect(properties().getByLabel('Label', { exact: true })).toBeDisabled();
  await expect(properties().getByRole('button', { name: 'Remove field' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Add field' }).click();
  await page.keyboard.type('Sensor');
  await expect(ownFields().getByRole('button', { name: /^Sensor\b/ })).toBeVisible();
  await openModelSettings();
  await expect(page.getByRole('switch', { name: 'Localized' })).toBeDisabled();
  await captureScreen(page, 'inheritance-02-kind-builder', { viewports: ['desktop'] });
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const plan = page.getByRole('dialog', { name: /^Review changes to / });
  await expect(plan.getByText('Add the field Sensor (Short text)')).toBeVisible();
  await plan.getByRole('button', { name: 'Ship now' }).click();
  await expect(plan).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText('· version 2')).toBeVisible({ timeout: 30_000 });
});

test('moving a kind under another type is reviewed as a breaking change, by name', async () => {
  const tool = await api.createDefinition('models', {
    kind: 'collection',
    apiKey: 'tool',
    label: 'Tool',
    localized: false,
    fields: [],
  });
  expect(tool.status).toBeTruthy();
  created.tool = await modelIdOf('tool');

  await openBuilder(created.camera, 'Camera');
  await openModelSettings();
  await choose(page, 'Extends', 'Tool');
  await expect(page.getByText('Moving it under another type changes its API')).toBeVisible();
  await expect(inheritedFields('Tool')).toHaveCount(0);
  await expect(inheritedFields('Gear')).toHaveCount(0);
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const plan = page.getByRole('dialog', { name: /^Review changes to / });
  await expect(plan.getByText('Move this from Gear to Tool')).toBeVisible();
  await expect(plan.getByRole('checkbox', { name: /changes the API contract/ })).toBeVisible();
  await captureScreen(page, 'inheritance-03-reparent-review', { viewports: ['desktop'] });
  await plan.getByRole('button', { name: 'Cancel' }).click();
  await expect(plan).toBeHidden();
  await page.getByRole('button', { name: 'Discard changes' }).first().click();
  await page
    .getByRole('alertdialog', { name: 'Discard your changes?' })
    .getByRole('button', { name: 'Discard changes' })
    .click();
  await expect(inheritedFields('Gear')).toBeVisible();
});

test('a type with a kind can’t be deleted', async () => {
  await openBuilder(created.gear, 'Gear');
  await page.getByRole('button', { name: 'More actions' }).click();
  const item = page.getByRole('menuitem', { name: /Delete model/ });
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await expect(item).toContainText('Has 1 kind');
  await page.keyboard.press('Escape');
});

test('the roles matrix puts the kind under its parent with what it inherits', async () => {
  const role = await adminRequest(page.request, 'POST', '/roles', {
    key: 'gear-reader',
    name: 'Gear reader',
    kind: 'admin',
    permissions: [{ action: 'read', modelId: created.gear, condition: null, fieldIds: null }],
  });
  created.role = ((await role.json()) as { id: string }).id;
  await page.goto(`${ADMIN_URL}network/roles/${created.role}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Gear reader' })).toBeVisible();
  await expect(page.getByText(/camera · Inherited from Gear/)).toBeVisible();
  await expect(page.getByText('Read inherited from Gear')).toBeAttached();
  await expect(page.getByRole('checkbox', { name: 'Read: Camera' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Options: Camera' }).click();
  await expect(page.getByText('Inherited from Gear: All fields')).toBeVisible();
  await captureScreen(page, 'inheritance-04-roles-tree', { viewports: ['desktop'] });
});
