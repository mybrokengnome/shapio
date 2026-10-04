import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';
import { siteApi } from './support/sites';

/**
 * Content types against the real API: create them live from "+ New content type", edit them in the
 * Structure tab of their place (classified plans: metadata-only, live, prerequisites, breaking), conflicts
 * between two sessions, components under Develop, the old /models URLs and the read-only lock. Locale
 * management is in locales.spec.ts. Every screen is captured in light and dark and checked with axe.
 */
test.describe.configure({ mode: 'serial' });

const UPDATED = 'Model updated — no restart needed';

let page: Page;
const pageErrors: string[] = [];

const openSession = async (browser: Browser) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const opened = await context.newPage();
  opened.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(opened);
  return opened;
};

test.beforeAll(async ({ browser }) => {
  page = await openSession(browser);
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page.context().close();
});

const fieldList = (on: Page = page) => on.getByRole('list', { name: /^\d+ fields?$/ });
const fieldRow = (label: string, on: Page = page) =>
  fieldList(on).getByRole('button', { name: new RegExp(`^${label}\\b`) });
const planDialog = (on: Page = page) => on.getByRole('dialog', { name: /^Review changes to / });
/** The selected field's properties panel ("Title properties"). */
const properties = (on: Page = page) => on.getByRole('region', { name: / properties$/ });
const toast = (text: string, on: Page = page) => on.getByText(text).first();
/** The plan's changes applied one way ("Live", "Breaking"...), listed under that chip. */
const planGroup = (plan: Locator, bucket: string) => plan.getByRole('list', { name: bucket, exact: true });

const nav = (on: Page = page) => on.getByRole('navigation', { name: 'Main navigation' });

/** Opens "+ New content type" from the sidebar and fills the label; returns the page's content. */
const createDefinition = async (label: string, kind?: 'Singleton') => {
  await nav().getByRole('link', { name: 'New content type' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New content type' })).toBeVisible();
  const form = page.getByRole('main');
  if (kind) {
    await form.getByRole('radio', { name: kind }).check();
  }
  await form.getByLabel('Label', { exact: true }).fill(label);
  return form;
};

/** "Add field" adds a field at once with its label focused and selected: type the name, pick the type. */
const addField = async (label: string, type: RegExp, on: Page = page) => {
  await on.getByRole('button', { name: 'Add field' }).click();
  await expect(properties(on).getByLabel('Label', { exact: true })).toBeFocused();
  await on.keyboard.type(label);
  await properties(on).getByRole('radio', { name: type }).check();
  await expect(fieldRow(label, on)).toBeVisible();
};

const review = async (on: Page = page): Promise<Locator> => {
  await on.getByRole('button', { name: 'Review', exact: true }).click();
  const dialog = planDialog(on);
  await expect(dialog).toBeVisible();
  return dialog;
};

/** The active version shown under the builder's title. */
const activeVersion = async (on: Page) =>
  Number((await on.getByText(/· version \d+$/).textContent())?.match(/version (\d+)/)?.[1]);

/** Applies the reviewed plan and waits until the new version is active and loaded in the builder. */
const apply = async (dialog: Locator, on: Page = page) => {
  const version = await activeVersion(on);
  await dialog.getByRole('button', { name: 'Ship now' }).click();
  await expect(dialog).toBeHidden();
  await expect(on.getByText(new RegExp(`· version ${version + 1}$`))).toBeVisible({ timeout: 30_000 });
  await expect(toast(UPDATED, on)).toBeVisible();
};

/** Opens a place from the sidebar, then its Structure tab (the builder). */
const openModel = async (label: string, on: Page = page) => {
  await on.goto(ADMIN_URL);
  await nav(on).getByRole('link', { name: label, exact: true }).click();
  await on.getByRole('tab', { name: 'Structure' }).click();
  await expect(on).toHaveURL(/[?&]tab=structure/);
  await expect(on.getByRole('heading', { level: 1, name: label })).toBeVisible();
};

test('there is no Models screen: the sidebar offers "+ New content type"', async () => {
  await page.goto(ADMIN_URL);
  await expect(nav().getByRole('link', { name: /models/i })).toHaveCount(0);
  await nav().getByRole('link', { name: 'New content type' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New content type' })).toBeVisible();
  // Components are created under Develop, not here.
  await expect(page.getByRole('radio')).toHaveCount(2);
  await captureScreen(page, 'models-01-new-content-type', { viewports: ['desktop'] });
});

test('creating a model derives its API ID, validates it inline and activates it live', async () => {
  const dialog = await createDefinition('Author');
  await expect(dialog.getByLabel('API ID', { exact: true })).toHaveValue('author');
  await dialog.getByLabel('API ID', { exact: true }).fill('1author');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.getByText('Use letters, digits and _, not starting with a digit.')).toBeVisible();
  await captureScreen(page, 'models-02-new-model-page', { viewports: ['desktop', 'phone'] });
  await dialog.getByLabel('API ID', { exact: true }).fill('author');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(toast('Created — no restart needed.')).toBeVisible();
  // A new type opens in the Structure tab of its place, which is in the sidebar at once.
  await expect(page).toHaveURL(/\/content\/author\?tab=structure$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Author' })).toBeVisible();
  await expect(nav().getByRole('link', { name: 'Author', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByText('API IDs author · authors · version 1')).toBeVisible();
  await expect(page.getByText('No fields yet.')).toBeVisible();
  await captureScreen(page, 'models-03-builder-empty', { viewports: ['desktop'] });

  await addField('Name', /^Short text/);
  const plan = await review();
  await expect(plan.getByText('Add the field Name (Short text)')).toBeVisible();
  await apply(plan);
});

test('the plural API ID of a collection follows the API ID until edited, and must differ from it', async () => {
  const dialog = await createDefinition('Category');
  const plural = dialog.getByLabel('Plural API ID', { exact: true });
  await expect(plural).toHaveValue('categories');
  await expect(dialog.getByText('/api/content/categories', { exact: true })).toBeVisible();
  await dialog.getByLabel('Label', { exact: true }).fill('News');
  await expect(dialog.getByLabel('API ID', { exact: true })).toHaveValue('news');
  await expect(plural).toHaveValue('newsItems');
  await plural.fill('news');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.getByText('The plural API ID must differ from the API ID.')).toBeVisible();
  await plural.fill('stories');
  await dialog.getByLabel('API ID', { exact: true }).fill('story');
  // Typed by hand, so it no longer follows the API ID.
  await expect(plural).toHaveValue('stories');
  await expect(dialog.getByText('/api/content/stories', { exact: true })).toBeVisible();
  await dialog.getByRole('link', { name: 'Cancel' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard and leave' }).click();
  // Back to the places.
  await expect(page).toHaveURL(/\/content(\/author)?$/);
});

test('a collection with text, boolean, rich-text and relation fields: live plan, applied, kept on reload', async () => {
  const dialog = await createDefinition('Article');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Article' })).toBeVisible();

  // No toast over the panel in the captures (a pointer resting on a toast keeps it open).
  await page.mouse.move(0, 0);
  await expect(toast('Created — no restart needed.')).toBeHidden({ timeout: 15_000 });
  // "Add field" adds a short-text field at once: selected, its label focused with the text selected.
  const addFieldButton = page.getByRole('button', { name: 'Add field' });
  await addFieldButton.click();
  const panel = properties();
  const label = panel.getByLabel('Label', { exact: true });
  await expect(label).toBeFocused();
  await expect(label).toHaveValue('New field');
  await expect(panel.getByLabel('API ID', { exact: true })).toHaveValue('newField');
  await expect(fieldRow('New field')).toBeVisible();
  await expect(panel.getByRole('radio', { name: /^Short text/ })).toBeChecked();
  await captureScreen(page, 'models-04a-new-field', { viewports: ['desktop', 'phone'] });
  // Escape discards a new field nobody touched, and focus goes back to "Add field".
  await label.focus();
  await page.keyboard.press('Escape');
  await expect(fieldRow('New field')).toHaveCount(0);
  await expect(addFieldButton).toBeFocused();

  // Typing replaces the label and the API ID follows it; the type grid sets the type.
  await addFieldButton.click();
  await expect(label).toBeFocused();
  await page.keyboard.type('Title');
  await expect(panel.getByLabel('API ID', { exact: true })).toHaveValue('title');
  await panel.getByRole('radio', { name: /^Relation/ }).check();
  await expect(panel.getByText('Relation · Links to entries of another model.')).toBeVisible();
  await captureScreen(page, 'models-04b-new-field-type', { viewports: ['desktop', 'phone'] });
  await panel.getByRole('radio', { name: /^Short text/ }).check();
  // Once edited, Escape keeps the field.
  await page.keyboard.press('Escape');
  await expect(fieldRow('Title')).toBeVisible();
  await addField('Featured', /^Boolean/);
  await addField('Body', /^Rich text/);
  await expect(fieldRow('Featured')).toBeVisible();
  await expect(fieldRow('Body')).toBeVisible();
  await addField('Author', /^Relation/);
  // The relation needs a target before the draft is valid.
  await expect(page.getByRole('button', { name: 'Review', exact: true })).toBeDisabled();
  await expect(page.getByText('1 problem to fix')).toBeVisible();
  await page.getByRole('combobox', { name: 'Target model' }).click();
  await page.getByRole('option', { name: 'Author' }).click();
  await expect(page.getByText('1 problem to fix')).toBeHidden();
  await captureScreen(page, 'models-05-field-settings-relation', { viewports: ['desktop'] });

  const plan = await review();
  await expect(plan.getByText('These changes go live immediately.', { exact: false })).toBeVisible();
  for (const change of [
    'Add the field Title (Short text)',
    'Add the field Featured (Boolean)',
    'Add the field Body (Rich text)',
    'Add the field Author (Relation)',
  ]) {
    await expect(planGroup(plan, 'Live').getByRole('listitem').filter({ hasText: change })).toBeVisible();
  }
  await captureScreen(page, 'models-06-plan-live', { viewports: ['desktop', 'phone'] });
  await apply(plan);

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Article' })).toBeVisible();
  for (const label of ['Title', 'Featured', 'Body', 'Author']) {
    await expect(fieldRow(label)).toBeVisible();
  }
  await fieldRow('Featured').click();
  await expect(page.getByRole('switch', { name: 'Public' })).toBeChecked();
  await captureScreen(page, 'models-07-builder-fields', { viewports: ['desktop', 'phone'] });
});

test('discarding the draft is confirmed in place', async () => {
  await fieldRow('Title').click();
  await page.getByLabel('Label', { exact: true }).fill('Oops');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Discard your changes?' });
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Discard changes' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText('Unsaved changes')).toBeHidden();
  await expect(fieldRow('Title')).toBeVisible();
});

test('renaming a label is metadata only and applies instantly', async () => {
  await fieldRow('Title').click();
  await page.getByLabel('Label', { exact: true }).fill('Headline');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  // Mod+S opens the review, like the Review button.
  await page.keyboard.press('ControlOrMeta+s');
  const plan = planDialog();
  await expect(plan).toBeVisible();
  await expect(plan.getByText('Only metadata changes', { exact: false })).toBeVisible();
  await expect(
    planGroup(plan, 'Metadata only')
      .getByRole('listitem')
      .filter({ hasText: 'Change the label of Headline' }),
  ).toBeVisible();
  await expect(plan.getByRole('checkbox')).toHaveCount(0);
  await captureScreen(page, 'models-08-plan-metadata', { viewports: ['desktop'] });
  await apply(plan);
  // "Ship now" shipped a one-item change set created by the builder.
  const shipped = await page.request.get(`${ADMIN_API}/change-sets?status=shipped`);
  const sets = ((await shipped.json()) as { items: { source: string; title: string }[] }).items;
  expect(sets.some((set) => set.source === 'builder' && set.title.startsWith('Schema: '))).toBe(true);
  await expect(page.getByText('Unsaved changes')).toBeHidden();
});

test('reordering fields with the keyboard is metadata only', async () => {
  await page.getByRole('button', { name: 'Reorder Body' }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Reorder Body' })).toBeFocused();
  await expect(fieldList().getByRole('listitem').nth(1)).toContainText('Body');
  const plan = await review();
  await expect(
    planGroup(plan, 'Metadata only').getByRole('listitem').filter({ hasText: 'Reorder the fields' }),
  ).toBeVisible();
  await apply(plan);
});

test('changing an API ID is breaking and blocked until acknowledged', async () => {
  await fieldRow('Headline').click();
  await page.getByLabel('API ID', { exact: true }).fill('headline');
  await expect(page.getByText('Changing an API ID is a breaking change', { exact: false })).toBeVisible();
  const plan = await review();
  await expect(
    planGroup(plan, 'Breaking')
      .getByRole('listitem')
      .filter({ hasText: 'Change the API ID of Headline from title to headline' }),
  ).toBeVisible();
  const applyButton = plan.getByRole('button', { name: 'Ship now' });
  await expect(applyButton).toBeDisabled();
  await captureScreen(page, 'models-09-plan-breaking', { viewports: ['desktop'] });
  await plan.getByLabel('I understand this changes the API contract', { exact: false }).check();
  await expect(applyButton).toBeEnabled();
  await apply(plan);
  await expect(fieldRow('Headline')).toContainText('headline');
});

test('adding a required field shows its impact and runs the prerequisite checks first', async () => {
  await addField('Summary', /^Short text/);
  await page.getByRole('switch', { name: 'Required' }).click();
  const plan = await review();
  await expect(plan.getByText('Existing content is checked first.', { exact: false })).toBeVisible();
  await expect(plan.getByText(/\d+ entry versions? affected/)).toBeVisible();
  await expect(plan.getByRole('heading', { name: 'Prerequisites' })).toBeVisible();
  await expect(plan.getByText('Check that every entry has a value for Summary')).toBeVisible();
  await expect(plan.getByText(/\d+ entry versions? to check/)).toBeVisible();
  await expect(
    planGroup(plan, 'Needs checks').getByRole('listitem').filter({ hasText: 'Add the field Summary' }),
  ).toBeVisible();
  await captureScreen(page, 'models-10-plan-prerequisites', { viewports: ['desktop'] });
  // Pending until the prerequisite job activates the new version, then the builder reloads it.
  await apply(plan);
  await expect(fieldRow('Summary')).toContainText('Required');
});

test('the impact counts real content: two entries, then a required field', async () => {
  for (const name of ['Grace Hopper', 'Alan Turing']) {
    await adminRequest(page.request, 'POST', '/content/author', { data: { name } });
  }
  await openModel('Author');
  await fieldRow('Name').click();
  await page.getByRole('switch', { name: 'Required' }).click();
  const plan = await review();
  // Two entries, each with one draft head in the default locale.
  await expect(plan.getByText('2 entry versions affected (all locales and states)')).toBeVisible();
  await expect(plan.getByText('2 entry versions to check')).toBeVisible();
  await captureScreen(page, 'models-10b-plan-real-impact', { viewports: ['desktop'] });
  await apply(plan);
  await expect(fieldRow('Name')).toContainText('Required');
  await openModel('Article');
});

test('two sessions editing the same model: the second gets the conflict banner', async ({ browser }) => {
  const other = await openSession(browser);
  try {
    await openModel('Article', other);
    // This session saves first.
    await fieldRow('Body').click();
    await page.getByLabel('Help text').fill('The article text.');
    await apply(await review());
    // The other session still edits the version it loaded.
    await fieldRow('Featured', other).click();
    await other.getByLabel('Label', { exact: true }).fill('Promoted');
    await other.getByRole('button', { name: 'Review', exact: true }).click();
    const conflict = other.getByRole('alert').filter({ hasText: 'This model changed in another session' });
    await expect(conflict).toBeVisible();
    await expect(planDialog(other)).toBeHidden();
    await captureScreen(other, 'models-11-conflict-banner', { viewports: ['desktop', 'phone'] });
    // Keeping the edits rebases them onto the latest version; the review now succeeds.
    await conflict.getByRole('button', { name: 'Keep my edits' }).click();
    await expect(conflict).toBeHidden();
    const plan = await review(other);
    // Only this session's edit: the other session's help text is kept, not reverted.
    await expect(plan.getByRole('listitem')).toHaveCount(1);
    await expect(plan.getByRole('listitem')).toContainText('Change the label of Promoted');
    await plan.getByRole('button', { name: 'Cancel' }).click();

    // A change activated elsewhere shows a non-blocking banner; edits are kept until the admin decides.
    await fieldRow('Author').click();
    await page.getByLabel('Label', { exact: true }).fill('Writer');
    await apply(await review());
    const banner = other.getByRole('status').filter({ hasText: 'This model changed in another session' });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(fieldRow('Promoted', other)).toBeVisible();
    await captureScreen(other, 'models-12-remote-change-banner', { viewports: ['desktop', 'phone'] });
    // With unsaved edits the banner offers the choice directly.
    await banner.getByRole('button', { name: 'Reload latest (discard my edits)' }).click();
    await expect(fieldRow('Writer', other)).toBeVisible();
    await expect(fieldRow('Featured', other)).toBeVisible();
    await expect(banner).toBeHidden();
  } finally {
    await other.context().close();
  }
});

test('a saved field changes type through a conversion: Long text to Rich text', async () => {
  await openModel('Article');
  await addField('Notes', /^Long text/);
  await apply(await review());
  await fieldRow('Notes').click();
  const panel = properties();
  // Types Shapio can't convert Long text to are disabled, and say why.
  const media = panel.getByRole('radio', { name: /^Media/ });
  await expect(media).toBeDisabled();
  await expect(media).toHaveAccessibleDescription("Shapio can't convert Long text to Media.");
  await expect(panel.getByText("Greyed-out types: Shapio can't convert Long text to them.")).toBeVisible();
  await panel.getByRole('radio', { name: /^Rich text/ }).check();
  await expect(
    panel.getByText(
      'Existing values will be converted when you review and save. This is a breaking API change.',
    ),
  ).toBeVisible();
  await captureScreen(page, 'models-18-saved-field-type', { viewports: ['desktop', 'phone'] });
  const plan = await review();
  await expect(
    planGroup(plan, 'Breaking')
      .getByRole('listitem')
      .filter({ hasText: 'Change the type of Notes from Long text to Rich text' }),
  ).toBeVisible();
  await plan.getByLabel('I understand this changes the API contract', { exact: false }).check();
  await apply(plan);
  await page.reload();
  await fieldRow('Notes').click();
  await expect(properties().getByRole('radio', { name: /^Rich text/ })).toBeChecked();
});

test('components live under Develop with their own builder', async () => {
  await nav().getByRole('link', { name: 'Components', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Components' })).toBeVisible();
  // Other specs on this server may have added components; only Hero matters here.
  await page.getByRole('link', { name: 'New component' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'New component' })).toBeVisible();
  const form = page.getByRole('main');
  await expect(form.getByRole('radio')).toHaveCount(0);
  await expect(form.getByRole('switch', { name: 'Localized' })).toHaveCount(0);
  await form.getByLabel('Label', { exact: true }).fill('Hero');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hero' })).toBeVisible();
  await expect(page).toHaveURL(/\/develop\/components\/[^/]+$/);
  const componentUrl = page.url();
  await addField('Heading', /^Short text/);
  await apply(await review());
  await nav().getByRole('link', { name: 'Components', exact: true }).click();
  await expect(page.getByRole('row', { name: /Hero/ }).getByRole('cell').nth(2)).toHaveText('1');
  await captureScreen(page, 'models-13-develop-components', { viewports: ['desktop', 'phone'] });

  // Old builder URLs still work: /models/components/:id and /models/:id redirect.
  const componentId = componentUrl.split('/').pop() ?? '';
  await page.goto(`${ADMIN_URL}models/components/${componentId}`);
  await expect(page).toHaveURL(componentUrl);
  const models = (await (await page.request.get(`${ADMIN_API}/models`)).json()) as {
    items: { definition: { id: string; apiKey: string } }[];
  };
  const article = models.items.find(({ definition }) => definition.apiKey === 'article');
  await page.goto(`${ADMIN_URL}models/${article?.definition.id}`);
  await expect(page).toHaveURL(/\/content\/article\?tab=structure$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Article' })).toBeVisible();
  await page.goto(`${ADMIN_URL}models`);
  await expect(page).toHaveURL(/\/content(\/[A-Za-z]+)?$/);
});

test('the read-only lock disables editing and says why', async () => {
  await adminRequest(page.request, 'PUT', '/schema/settings', {
    readOnly: true,
    readOnlyReason: 'Changes ship through CI',
  });
  await openModel('Article');
  await expect(page.getByText('Schema editing is locked')).toBeVisible();
  await expect(page.getByText('Reason: Changes ship through CI')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add field' })).toBeDisabled();
  // Fields can still be opened and read.
  await fieldRow('Featured').click();
  await expect(page.getByLabel('Label', { exact: true })).toHaveValue('Featured');
  await expect(page.getByLabel('Label', { exact: true })).toBeDisabled();
  await expect(page.getByRole('switch', { name: 'Public' })).toBeDisabled();
  await captureScreen(page, 'models-15-locked', { viewports: ['desktop'] });
  await page.goto(`${ADMIN_URL}content/new`);
  await expect(page.getByText('Schema editing is locked')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create' })).toBeDisabled();
  await adminRequest(page.request, 'PUT', '/schema/settings', { readOnly: false });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create' })).toBeEnabled();
});

test('the builder works at phone width', async () => {
  await openModel('Article');
  await captureScreen(page, 'models-16-builder-mobile', { viewports: ['phone'] });
  await page.setViewportSize({ width: 390, height: 844 });
  await fieldRow('Featured').click();
  await expect(page.getByRole('switch', { name: 'Public' })).toBeVisible();
  await captureScreen(page, 'models-17-builder-field-mobile', { viewports: ['phone'] });
  await page.setViewportSize({ width: 1360, height: 900 });
});

test('with a second site, a new content type asks where it is available: "All sites" shares it', async () => {
  const api = siteApi(page.request);
  const shop = await api.send<{ id: string }>('POST', '/sites', { key: 'shop', name: 'Shop' });
  let brandId = '';
  try {
    await page.goto(ADMIN_URL);
    const form = await createDefinition('Brand');
    const availableOn = form.getByRole('group', { name: 'Available on' });
    await expect(availableOn.getByRole('radio', { name: 'This site' })).toBeChecked();
    await expect(availableOn.getByRole('radio', { name: 'This site' })).toHaveAccessibleDescription(
      'Only on Default site.',
    );
    await availableOn.getByRole('radio', { name: 'All sites' }).check();
    await captureScreen(page, 'models-18-available-on', { viewports: ['desktop', 'phone'] });
    await form.getByRole('button', { name: 'Create' }).click();
    await expect(toast('Created — no restart needed.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Brand' })).toBeVisible();
    // Shared: marked in the sidebar (its name stays the label) and listed on the other site too.
    await expect(nav().getByRole('link', { name: 'Brand', exact: true })).toHaveAccessibleDescription(
      'Shared with all sites',
    );
    const onShop = await siteApi(page.request, 'shop').get<{
      items: { definition: { id: string; apiKey: string }; scope: string }[];
    }>('/models');
    const brand = onShop.items.find(({ definition }) => definition.apiKey === 'brand');
    expect(brand?.scope).toBe('network');
    brandId = brand?.definition.id ?? '';
  } finally {
    if (brandId) {
      const { version } = await api.get<{ version: number }>(`/models/${brandId}`);
      await api.send('DELETE', `/models/${brandId}?expectedVersion=${version}`);
    }
    await api.send('DELETE', `/sites/${shop.id}`);
  }
});
