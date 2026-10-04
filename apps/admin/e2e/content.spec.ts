import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { adminApiFor, id, type AdminApi } from './content/api';
import { startProjectServer, type ProjectServer } from './content/projectServer';
import { author, feature, hero, page as pageModel, siteSettings } from './content/schema';
import { OWNER } from './support/accounts';
import { captureRendered, captureScreen, type ViewportName } from './support/capture';
import { entryDocument } from './support/entryDocument';

/**
 * Package F: editors and content, against a create-shapio project's server with the example star-rating
 * editor installed at runtime (see content/projectServer.ts). Builds the brief's page in English and
 * French: hero, feature grid, gallery, rich text with a table and an image, a relation; autosave and Save,
 * per-locale publishing and the "publish other locales too" notice, the conflict banner, history and
 * restore, the list's search/filters/sort/bulk publish, delete protection, and the custom editor getting
 * exactly the server's validation. Every screen is captured in light and dark and checked with axe.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

type Entry = { id: string; version: number; status: string; locale: string; data: Record<string, unknown> };

let server: ProjectServer;
let page: Page;
let api: AdminApi;
let entryId = '';
const assets: Record<string, string> = {};
const pageErrors: string[] = [];

const openSignedIn = async (browser: Browser) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const opened = await context.newPage();
  opened.on('pageerror', (error) => pageErrors.push(error.message));
  const response = await opened.request.post(`${server.adminApi}/auth/login`, {
    data: { email: OWNER.email, password: OWNER.password },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return opened;
};

test.beforeAll(async ({ browser }) => {
  server = await startProjectServer();
  const setupContext = await browser.newContext();
  const setup = await setupContext.request.post(`${server.adminApi}/setup`, {
    data: { name: OWNER.name, email: OWNER.email, password: OWNER.password },
  });
  expect(setup.ok(), await setup.text()).toBe(true);
  await setupContext.close();
  page = await openSignedIn(browser);
  api = adminApiFor(page.request, server.adminApi);
  await api.createLocale('fr', 'French');
  await api.createDefinition('components', hero);
  await api.createDefinition('components', feature);
  await api.createDefinition('models', author);
  await api.createDefinition('models', pageModel);
  await api.createDefinition('models', siteSettings);
  assets.meadow = (await api.uploadPng('meadow.png', 1600, 900)).id;
  assets.castle = (await api.uploadPng('castle.png', 1200, 800)).id;
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page?.context().close();
  await server?.stop();
});

/** Redesign captures: every screen at 1440×900; the list and the editor at 390×844 too. */
const DESKTOP: { viewports: ViewportName[] } = { viewports: ['desktop'] };
const BOTH: { viewports: ViewportName[] } = { viewports: ['desktop', 'phone'] };

const field = (path: string): Locator => page.locator(`[data-field-path="${path}"]`);
const doc = () => entryDocument(page);
const status = () =>
  page.getByRole('status').filter({ hasText: /saved|Saving|Unsaved|Couldn't save|autosaved/i });
const entryUrl = (locale: string) => `${server.adminUrl}content/page/${entryId}?locale=${locale}`;
const getEntry = (locale: string) => api.get<Entry>(`/content/page/${entryId}?locale=${locale}`);
const chooseMedia = async (names: string[], confirm: RegExp, screenshot?: string) => {
  const dialog = page.getByRole('dialog', { name: /Choose (a file|files)/ });
  await expect(dialog).toBeVisible();
  for (const name of names) {
    await dialog.getByRole('checkbox', { name: `Select ${name}` }).check();
  }
  if (screenshot) {
    // The picker is a large sheet: full width on phones.
    await captureScreen(page, screenshot, BOTH);
  }
  await dialog.getByRole('button', { name: confirm }).click();
  await expect(dialog).toBeHidden();
};
const saveAndWait = async () => {
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().includes('/content/page/') &&
      !response.request().postData()?.includes('"autosave":true'),
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  return saved;
};

test('a place: its name, New, an empty state, and Structure and API tabs for schema managers', async () => {
  await page.goto(`${server.adminUrl}content`);
  await expect(page.getByRole('heading', { level: 1, name: 'Author' })).toBeVisible();
  await page.goto(`${server.adminUrl}content/page`);
  await expect(page.getByRole('heading', { level: 1, name: 'Page' })).toBeVisible();
  await expect(page.getByText('No Page entries yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'New', exact: true }).first()).toBeVisible();
  await captureScreen(page, 'content-01-list-empty', DESKTOP);

  // The owner manages the schema: the place's builder and API summary are tabs, kept in the URL.
  const tabs = page.getByRole('tablist', { name: 'Page sections' });
  await expect(tabs.getByRole('tab', { name: 'Entries' })).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', { name: 'API' }).click();
  await expect(page).toHaveURL(/tab=api/);
  await expect(page.getByText('/api/content/pages', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'GraphQL' })).toContainText('type Page {');
  await captureScreen(page, 'place-01-api', BOTH);
  await tabs.getByRole('tab', { name: 'Structure' }).click();
  await expect(page).toHaveURL(/tab=structure/);
  await expect(page.getByRole('region', { name: 'Fields' })).toBeVisible();
  await captureScreen(page, 'place-02-structure', DESKTOP);
  await tabs.getByRole('tab', { name: 'Entries' }).click();
  await expect(page.getByText('No Page entries yet')).toBeVisible();
});

test("the project's colour theme is in the theme menu on sign-in and applies before first paint", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const signedOut = await context.newPage();
  signedOut.on('pageerror', (error) => pageErrors.push(error.message));
  await signedOut.emulateMedia({ colorScheme: 'dark' });
  await signedOut.goto(server.adminUrl);
  await expect(signedOut.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await signedOut.getByRole('button', { name: 'Change theme' }).click();
  await signedOut.getByRole('menuitemradio', { name: 'Sepia' }).click();
  await signedOut.keyboard.press('Escape');
  const html = signedOut.locator('html');
  // Light only: the OS's dark preference does not apply.
  await expect(html).toHaveAttribute('data-theme', 'sepia');
  await expect(html).not.toHaveClass(/\bdark\b/);
  const background = () => signedOut.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await background()).toBe('rgb(246, 239, 227)');
  // The pre-paint script and the render-blocking stylesheet apply it before the admin's script runs.
  await signedOut.reload({ waitUntil: 'commit' });
  await signedOut.waitForFunction(() => document.body !== null);
  expect(await signedOut.evaluate(() => document.documentElement.dataset.theme)).toBe('sepia');
  await expect(signedOut.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(await background()).toBe('rgb(246, 239, 227)');
  await captureRendered(signedOut, 'theme-sepia-light-sign-in');
  await context.close();
});

test("the project's custom editor is served from the create-shapio project and loads at runtime", async () => {
  const manifest = await api.get<{ items: { file: string; path: string }[] }>('/extensions/editors');
  expect(manifest.items.map((item) => item.file)).toEqual(['star-rating.js']);
  await page.getByRole('link', { name: 'New', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'New Page' })).toBeVisible();
  // The star rating is the example editor from examples/custom-editor, not part of the admin bundle. The
  // rating is a property, edited in the settings drawer beside the document.
  const rating = await doc().property('rating');
  await expect(rating.getByRole('radiogroup', { name: 'Rating' })).toBeVisible();
  await expect(rating.getByRole('radio')).toHaveCount(8);
});

test("creates the brief's page: hero, feature grid, gallery, rich text with a table and an image, a relation", async () => {
  await field('/title').getByRole('textbox').fill('Home');
  await expect((await doc().property('slug')).getByRole('textbox')).toHaveValue('home');
  await (await doc().property('rating')).getByRole('radio', { name: '4 stars' }).click();

  const heroField = await doc().property('hero');
  await heroField.getByRole('button', { name: 'Add Hero' }).click();
  await field('/hero/heading').getByRole('textbox').fill('Made for curious minds');
  await field('/hero/subheading').getByRole('textbox').fill('Small adventures. Big discoveries.');
  await field('/hero/image').getByRole('button', { name: 'Choose a file' }).click();
  await chooseMedia(['meadow.png'], /^Choose file$/);
  await expect(field('/hero/image').getByText('meadow.png')).toBeVisible();

  // The relation is a property too; inline create keeps the person in the document.
  await (await doc().property('author')).getByRole('button', { name: 'Choose Author' }).click();
  await page
    .getByRole('dialog', { name: 'Choose Author' })
    .getByRole('button', { name: 'Create a new Author' })
    .click();
  const sheet = page.getByRole('dialog', { name: 'New Author' });
  await sheet.getByRole('textbox', { name: /^Name/ }).fill('Ada Lovelace');
  await captureScreen(page, 'content-02-relation-inline-create', DESKTOP);
  await sheet.getByRole('button', { name: 'Create and link' }).click();
  await expect(sheet).toBeHidden();
  await expect(field('/author').getByText('Ada Lovelace')).toBeVisible();
  // The picker is a popover anchored to the field on desktop and a bottom sheet on phones; the linked entry
  // is the selected option.
  await field('/author').getByRole('button', { name: 'Change' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose Author' });
  await expect(picker.getByRole('option', { name: 'Ada Lovelace', selected: true })).toBeVisible();
  await captureScreen(page, 'content-02-relation-picker', BOTH);
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await doc().closeSettings();

  // The canvas: the feature grid's items are blocks, added from the `+` after the field.
  await doc().addBlock('Feature', { after: 'Feature grid' });
  await field('/features/0/title').getByRole('textbox').fill('Maps');
  await doc().addBlock('Feature', { after: 'Feature grid' });
  await field('/features/1/title').getByRole('textbox').fill('Quests');

  await field('/gallery').getByRole('button', { name: 'Add files' }).click();
  await chooseMedia(['meadow.png', 'castle.png'], /^Choose 2 files$/, 'content-02-media-picker');
  await expect(field('/gallery').getByRole('listitem')).toHaveCount(2);

  // Rich text is the writing surface: `/` turns the line into a block (here, an image from the library).
  const body = page.getByRole('textbox', { name: 'Body' });
  await body.click();
  await page.keyboard.type('Plan your trip.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/image');
  await page.keyboard.press('Enter');
  await chooseMedia(['castle.png'], /^Choose file$/);
  await field('/body').getByLabel('Alt text').fill('A castle by the lake');
  await doc().addBlock('Table', { after: 'Body' });
  await expect(body).toBeFocused();
  await page.keyboard.type('Plan');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Price');

  await doc().addBlock('Feature');
  await field('/sections/0/title').getByRole('textbox').fill('Call to action');
  await captureScreen(page, 'content-03-new-page', DESKTOP);

  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/content\/page\/[0-9a-f-]{36}\?locale=en$/);
  entryId = /\/content\/page\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();
  // Unpublish is only offered while the entry is live.
  await doc().openSettings();
  await expect(page.getByRole('button', { name: 'Unpublish' })).toHaveCount(0);
  await doc().closeSettings();

  const saved = await getEntry('en');
  const richText = JSON.stringify((saved.data.body as { doc: unknown }).doc);
  expect(richText).toContain('"type":"tableHeader"');
  expect(richText).toContain('"text":"Plan"');
  expect(richText).toContain('"text":"Price"');
  expect(richText).toContain(`"mediaId":"${assets.castle}"`);
  expect(richText).toContain('"alt":"A castle by the lake"');
  expect((saved.data.sections as { __component: string }[])[0]?.__component).toBe('feature');
  expect((saved.data.gallery as { id: string }[]).map((asset) => asset.id)).toEqual([
    assets.meadow,
    assets.castle,
  ]);
  await captureScreen(page, 'content-04-entry', DESKTOP);
});

test('autosave keeps the draft without a revision; Save creates one', async () => {
  const autosave = page.waitForResponse(
    (response) => response.request().postData()?.includes('"autosave":true') ?? false,
  );
  await field('/title').getByRole('textbox').fill('Home page');
  expect((await autosave).status()).toBe(200);
  await expect(status()).toContainText('Draft autosaved');
  expect(await api.get<{ items: unknown[] }>(`/content/page/${entryId}/revisions?locale=en`)).toMatchObject({
    items: [{ reason: 'create' }],
  });
  await page.reload();
  await expect(field('/title').getByRole('textbox')).toHaveValue('Home page');
  await expect(status()).toContainText('Draft has autosaved changes');
  expect((await saveAndWait()).status()).toBe(200);
  await expect(status()).toContainText('Saved');
  const revisions = await api.get<{ items: { reason: string }[] }>(
    `/content/page/${entryId}/revisions?locale=en`,
  );
  expect(revisions.items.map((item) => item.reason)).toEqual(['save', 'create']);
  await captureScreen(page, 'content-05-saved', DESKTOP);
});

test('publishing is per locale: English goes live, then a French version is created and published', async () => {
  await doc().publish();
  expect((await getEntry('en')).status).toBe('published');
  await doc().openSettings();
  await expect(doc().drawer().getByRole('button', { name: 'Unpublish' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Locale' }).click();
  await page.getByRole('option', { name: /French/ }).click();
  await expect(page).toHaveURL(/locale=fr$/);
  await expect(page.getByText('This entry has no French version yet.', { exact: false })).toBeVisible();
  // Shared fields come from English (the slug followed the English title); localized ones start empty.
  await expect((await doc().property('slug')).getByRole('textbox')).toHaveValue('home-page');
  await expect((await doc().property('rating')).getByRole('radio', { name: '4 stars' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(field('/title').getByRole('textbox')).toHaveValue('');
  await captureScreen(page, 'content-06-new-locale', DESKTOP);
  await page.getByRole('button', { name: 'Copy from English' }).click();
  await expect(field('/title').getByRole('textbox')).toHaveValue('Home page');
  await field('/title').getByRole('textbox').fill('Accueil');
  await page.getByRole('button', { name: 'Create French version' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Accueil' })).toBeVisible();
  await doc().publish();

  // Change a localized field in English and publish English only: French stays exactly as published.
  await page.goto(entryUrl('en'));
  await doc().property('hero');
  await field('/hero/heading').getByRole('textbox').fill('Made for curious explorers');
  await doc().publish();
  await expect.poll(async () => (await getEntry('en')).status).toBe('published');
  expect((await getEntry('en')).data).toMatchObject({ hero: { heading: 'Made for curious explorers' } });
  expect(await getEntry('fr')).toMatchObject({
    status: 'published',
    data: { title: 'Accueil', hero: { heading: 'Made for curious minds' } },
  });
});

test('changing a shared field prompts to publish the other published locales too', async () => {
  await (await doc().property('rating')).getByRole('radio', { name: '5 stars' }).click();
  await doc().publish();
  // A notice at the top of the document, not a dialog: "Not now" hides it until the next publish.
  const prompt = page.getByRole('alert').filter({ hasText: 'still serves older shared values' });
  await expect(prompt).toContainText('1 other published locale (French) still serves older shared values.');
  await captureScreen(page, 'content-07-publish-others', BOTH);
  await prompt.getByRole('button', { name: 'Publish it' }).click();
  await expect(page.getByText('Published 1 more locale.')).toBeVisible();
  await expect(prompt).toBeHidden();
  const french = await api.get<Entry & { locales: { locale: string; sharedOutdated: boolean }[] }>(
    `/content/page/${entryId}?locale=fr`,
  );
  expect(french).toMatchObject({ status: 'published', data: { rating: 5, title: 'Accueil' } });
  expect(french.locales.every((state) => !state.sharedOutdated)).toBe(true);
});

test('the custom editor gets exactly the server validation of its field', async () => {
  const rejected = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.status() === 422,
  );
  await (await doc().property('rating')).getByRole('radio', { name: '8 stars' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const body = (await (await rejected).json()) as {
    error: { code: string; details: { issues: { path: string; code: string }[] } };
  };
  expect(body.error.code).toBe('CONTENT_INVALID');
  expect(body.error.details.issues).toContainEqual(
    expect.objectContaining({ path: '/rating', code: 'TOO_LARGE' }),
  );
  await expect(field('/rating')).toContainText('Must be at most 5.');
  await captureScreen(page, 'content-08-custom-editor-invalid', DESKTOP);
  // The same value from any other client is refused the same way: validation never depends on the editor.
  const { version } = await getEntry('en');
  const direct = await api.put(`/content/page/${entryId}`, {
    locale: 'en',
    expectedVersion: version,
    data: { rating: 8 },
  });
  expect(direct.status()).toBe(422);
  // Back to the saved value: the error goes with the change, and there is nothing left to save.
  await field('/rating').getByRole('radio', { name: '5 stars' }).click();
  await expect(field('/rating')).not.toContainText('Must be at most 5.');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
});

test('a save from another session shows the conflict banner; reloading keeps my changes', async ({
  browser,
}) => {
  const other = await openSignedIn(browser);
  const otherApi = adminApiFor(other.request, server.adminApi);
  const current = await getEntry('en');
  await otherApi.send('PUT', `/content/page/${entryId}`, {
    locale: 'en',
    expectedVersion: current.version,
    data: { title: 'Changed elsewhere' },
  });
  await other.context().close();

  await doc().property('hero');
  await field('/hero/subheading').getByRole('textbox').fill('Mine, typed meanwhile');
  const banner = page.getByRole('alert').filter({ hasText: 'Someone else saved this entry' });
  const reload = banner.getByRole('button', { name: 'Reload and keep my changes' });
  await expect(reload).toBeFocused();
  // The form is read-only and can't be saved until the conflict is resolved.
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await captureScreen(page, 'content-09-conflict', BOTH);
  // Discarding asks first, in place.
  await banner.getByRole('button', { name: 'Discard my changes' }).click();
  const discard = page.getByRole('alertdialog', { name: 'Discard your changes?' });
  await expect(discard.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await captureScreen(page, 'content-09-conflict-discard-confirm', BOTH);
  await page.keyboard.press('Escape');
  await expect(discard).toBeHidden();
  await reload.click();
  await expect(field('/title').getByRole('textbox')).toHaveValue('Changed elsewhere');
  await doc().property('hero');
  await expect(field('/hero/subheading').getByRole('textbox')).toHaveValue('Mine, typed meanwhile');
  expect((await saveAndWait()).status()).toBe(200);
  expect((await getEntry('en')).data).toMatchObject({
    title: 'Changed elsewhere',
    hero: { subheading: 'Mine, typed meanwhile' },
  });
});

test('history lists revisions with what restoring would change, and restores one', async () => {
  await (await doc().openSettings()).getByRole('button', { name: 'All versions and compare' }).click();
  const history = page.getByRole('dialog', { name: 'History' });
  const revisions = history.getByRole('list', { name: 'Revisions' }).getByRole('button');
  await expect(revisions.last()).toContainText('Created');
  await revisions.last().click();
  await expect(history).toContainText('Title');
  await expect(history).toContainText('would change');
  await captureScreen(page, 'content-10-history', DESKTOP);
  await history.getByRole('button', { name: 'Restore this version' }).click();
  await expect(page.getByText('Version restored as a new revision.')).toBeVisible();
  await expect(field('/title').getByRole('textbox')).toHaveValue('Home');
  expect((await getEntry('en')).data).toMatchObject({ title: 'Home' });
});

test('the list searches, filters with chips, sorts and publishes in bulk', async () => {
  const grace = await api.send<Entry>('POST', '/content/author', { data: { name: 'Grace Hopper' } });
  for (const [title, author] of [
    ['About us', grace.id],
    ['Contact', undefined],
  ] as const) {
    await api.send('POST', '/content/page', {
      locale: 'en',
      data: { title, slug: title.toLowerCase().replace(' ', '-'), ...(author ? { author } : {}) },
    });
  }
  const total = (await api.get<{ pagination: { total: number } }>('/content/page?locale=en')).pagination
    .total;
  await page.goto(`${server.adminUrl}content/page`);
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(total + 1);
  await page.getByRole('searchbox', { name: 'Search entries' }).fill('Abo');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('About us');
  await page.getByRole('searchbox', { name: 'Search entries' }).fill('');
  await expect(rows).toHaveCount(total + 1);
  await captureScreen(page, 'content-11-list', BOTH);

  // The column chooser hides and shows field columns; the choice outlives a reload.
  const header = page.getByRole('table').getByRole('row').first();
  await expect(header).toContainText('Slug');
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Slug' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Slug' })).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(header).not.toContainText('Slug');
  await captureScreen(page, 'content-11-list-columns', DESKTOP);
  await page.reload();
  await expect(header).not.toContainText('Slug');
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('menuitem', { name: 'Reset to default' }).click();
  await expect(header).toContainText('Slug');

  // The sort menu sorts by system dates too: the newest entry first.
  await page.getByRole('button', { name: 'Sort', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Created' }).click();
  await page.getByRole('button', { name: 'Sort', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Descending' }).click();
  await expect(page).toHaveURL(/sort=createdAt%3Adesc|sort=createdAt:desc/);
  await expect(rows.nth(1)).toContainText('Contact');

  // A condition from the Filters builder shows as a chip that removes it.
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('button', { name: 'Add filter' }).click();
  await page.getByRole('combobox', { name: 'Condition for Title' }).click();
  await page.getByRole('option', { name: 'starts with' }).click();
  await page.getByRole('textbox', { name: 'Value for Title' }).fill('Co');
  await captureScreen(page, 'content-11-list-filters', DESKTOP);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Contact');
  const chips = page.getByRole('list', { name: 'Active filters' });
  await expect(chips.getByRole('listitem').filter({ hasText: 'Title starts with Co' })).toBeVisible();
  await chips.getByRole('button', { name: 'Remove filter: Title starts with Co' }).click();
  await expect(rows).toHaveCount(total + 1);

  // A relation chip filters by one related entry, picked by its title.
  await chips.getByRole('button', { name: 'Author' }).click();
  await page.getByRole('searchbox', { name: 'Find Author…' }).fill('Grace');
  await page
    .getByRole('list', { name: 'Author entries' })
    .getByRole('button', { name: 'Grace Hopper' })
    .click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('About us');
  await expect(chips).toContainText('Author is Grace Hopper');
  await captureScreen(page, 'place-03-filter-chips', BOTH);
  await chips.getByRole('button', { name: 'Remove filter: Author is Grace Hopper' }).click();
  await expect(rows).toHaveCount(total + 1);

  await page.getByRole('button', { name: 'Sort by Title' }).click();
  await expect(rows.nth(1)).toContainText('About us');
  await page.getByRole('checkbox', { name: 'Select all entries on this page' }).check();
  await expect(page.getByText(`${total} entries selected`)).toBeVisible();
  await captureScreen(page, 'content-11-list-bulk-selection', BOTH);
  await page
    .getByRole('region', { name: 'Bulk actions' })
    .getByRole('button', { name: 'Publish', exact: true })
    .click();
  await expect(page.getByText(`Published ${total} entries.`)).toBeVisible();
  await expect(page.getByRole('table').getByText('Published', { exact: true })).toHaveCount(total);
  // Who created each entry, and its locales tinted by state (named for screen readers).
  const about = rows.filter({ hasText: 'About us' });
  await expect(about).toContainText(OWNER.name);
  await expect(about.getByRole('list', { name: 'Locales' })).toContainText('English: Published');

  // At phone width each entry is one stacked row; nothing scrolls sideways and actions are in "…".
  await page.setViewportSize({ width: 390, height: 844 });
  const stacked = page.getByRole('list', { name: 'Page entries' });
  await expect(stacked.getByRole('listitem').filter({ hasText: 'About us' })).toContainText('Published');
  await expect(page.getByRole('table')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await stacked.getByRole('button', { name: 'More actions for About us' }).click();
  await expect(page.getByRole('menuitem', { name: 'Unpublish' })).toBeVisible();
  await page.keyboard.press('Escape');
  await captureScreen(page, 'place-08-phone-rows', { viewports: ['phone'] });
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('row quick actions: quick edit in place; unpublish and delete ask inline; duplicate copies a draft', async () => {
  await page.goto(`${server.adminUrl}content/page?sort=title:asc`);
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows.filter({ hasText: 'About us' })).toHaveCount(1);
  const count = await rows.count();
  // Quick edit opens the row's properties in place; the document stays closed.
  const about = rows.filter({ hasText: 'About us' });
  await about.hover();
  await about.getByRole('button', { name: 'More actions for About us' }).click();
  await page.getByRole('menuitem', { name: 'Quick edit' }).click();
  const quickEdit = page.getByRole('form', { name: 'Quick edit About us' });
  const title = quickEdit.getByRole('textbox', { name: 'Title' });
  await expect(title).toBeFocused();
  await title.fill('About our team');
  await captureScreen(page, 'place-04-quick-edit', BOTH);
  await quickEdit.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved “About us”.')).toBeVisible();
  await expect(quickEdit).toBeHidden();
  await expect(rows.filter({ hasText: 'About our team' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'More actions for About our team' })).toBeFocused();

  const contact = rows.filter({ hasText: 'Contact' });
  await contact.hover();
  await contact.getByRole('button', { name: 'Unpublish Contact' }).click();
  const unpublish = page.getByRole('alertdialog', { name: 'Unpublish “Contact”?' });
  await expect(unpublish).toContainText('The English version leaves the API');
  await captureScreen(page, 'place-05-row-unpublish', DESKTOP);
  await unpublish.getByRole('button', { name: 'Unpublish' }).click();
  await expect(page.getByText('“Contact” was unpublished.')).toBeVisible();
  await expect(contact.getByText('Draft', { exact: true })).toBeVisible();

  await contact.getByRole('button', { name: 'More actions for Contact' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByText('Copied “Contact” as a new draft.')).toBeVisible();
  await expect(rows).toHaveCount(count + 1);

  const copy = rows.filter({ hasText: 'Contact' }).last();
  await copy.getByRole('button', { name: 'More actions for Contact' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const remove = page.getByRole('alertdialog', { name: 'Delete “Contact”?' });
  await captureScreen(page, 'place-06-row-delete', DESKTOP);
  await remove.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('“Contact” was deleted.')).toBeVisible();
  await expect(rows).toHaveCount(count);

  // Quick filters: status (in this locale) and who created the entry.
  const chips = page.getByRole('list', { name: 'Active filters' });
  await chips.getByRole('button', { name: 'Status' }).click();
  await page.getByRole('menuitem', { name: 'Draft' }).click();
  await expect(page).toHaveURL(/status=draft/);
  await expect(rows.filter({ hasText: 'Contact' })).toHaveCount(1);
  await expect(page.getByRole('table').getByText('Published', { exact: true })).toHaveCount(0);
  await chips.getByRole('button', { name: 'Remove filter: Status is Draft' }).click();
  await chips.getByRole('button', { name: 'Created by' }).click();
  await page
    .getByRole('list', { name: 'People' })
    .getByRole('button', { name: `${OWNER.name} (you)` })
    .click();
  await expect(chips).toContainText(`Created by ${OWNER.name}`);
  await expect(rows).toHaveCount(count);
  await captureScreen(page, 'place-09-quick-filters', DESKTOP);
  await chips.getByRole('button', { name: `Remove filter: Created by ${OWNER.name}` }).click();
});

test('a model with a cover can show its entries as cards, remembered per model', async () => {
  const titleId = id();
  await api.createDefinition('models', {
    id: id(),
    kind: 'collection',
    apiKey: 'story',
    label: 'Story',
    display: { titleFieldId: titleId },
    fields: [
      { id: titleId, apiKey: 'title', label: 'Title', type: 'string' },
      { id: id(), apiKey: 'cover', label: 'Cover', type: 'media', settings: { allowedKinds: ['image'] } },
      { id: id(), apiKey: 'body', label: 'Body', type: 'richtext' },
    ],
  });
  for (const [title, cover] of [
    ['Into the meadow', assets.meadow],
    ['The castle', assets.castle],
    ['No picture yet', undefined],
  ] as const) {
    await api.send('POST', '/content/story', { locale: 'en', data: { title, ...(cover ? { cover } : {}) } });
  }
  await page.goto(`${server.adminUrl}content/story`);
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('button', { name: 'Cards view' }).click();
  const cards = page.getByRole('list', { name: 'Story entries' });
  await expect(cards.getByRole('listitem')).toHaveCount(3);
  await expect(cards.getByRole('link', { name: 'Into the meadow', exact: true })).toBeVisible();
  await captureScreen(page, 'place-07-cards', BOTH);
  await page.reload();
  await expect(cards.getByRole('listitem')).toHaveCount(3);
  // Other places keep their own view.
  await page.goto(`${server.adminUrl}content/page`);
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cards view' })).toHaveCount(0);
  await page.goto(`${server.adminUrl}content/story`);
  await page.getByRole('button', { name: 'Table view' }).click();
  await expect(page.getByRole('table')).toBeVisible();
});

test('an entry other entries link to cannot be deleted, and the admin says which', async () => {
  await page.goto(`${server.adminUrl}content/author`);
  await page.getByRole('link', { name: 'Ada Lovelace', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ada Lovelace' })).toBeVisible();
  await (await doc().openSettings()).getByRole('button', { name: 'Delete entry' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete “Ada Lovelace”?' });
  await captureScreen(page, 'content-12-delete-confirm', BOTH);
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(confirm).toBeHidden();
  const explanation = page.getByRole('alert').filter({ hasText: 'This entry is still linked' });
  await expect(explanation.getByRole('link', { name: /^Page · / })).toBeVisible();
  await captureScreen(page, 'content-12-delete-referenced', BOTH);
  await explanation.getByRole('button', { name: 'Close' }).click();
  await expect(explanation).toBeHidden();
});

test('a single type opens its document directly, with its properties as a grid; colour, date-time, segmented and JSON editors', async () => {
  await page.goto(`${server.adminUrl}content/siteSettings`);
  await expect(page.getByRole('heading', { level: 1, name: 'New Site settings' })).toBeVisible();
  await field('/siteName').getByRole('textbox').fill('ForgeStack');
  await field('/accent')
    .getByRole('textbox', { name: 'Accent colour', exact: true })
    .fill('rgb(37, 99, 235)');
  await field('/launch').locator('input[type="datetime-local"]').fill('2026-11-01T09:30');
  await field('/tone').getByRole('radio', { name: 'Bold' }).click();
  await field('/meta').getByRole('textbox').fill('{ "twitter": ');
  await expect(field('/meta')).toContainText('Not valid JSON');
  await field('/meta').getByRole('textbox').fill('{ "twitter": "@forgestack" }');
  await expect(field('/meta')).not.toContainText('Not valid JSON');
  await captureScreen(page, 'content-13-single-type', DESKTOP);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText('Entry created.')).toBeVisible();
  await expect(page).toHaveURL(/\/content\/siteSettings\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'ForgeStack' })).toBeVisible();
  const list = await api.get<{ items: Entry[] }>('/content/siteSettings');
  expect(list.items[0]?.data).toMatchObject({
    siteName: 'ForgeStack',
    tone: 'bold',
    meta: { twitter: '@forgestack' },
  });
  expect(String(list.items[0]?.data.launch)).toMatch(/^2026-11-01T\d{2}:30:00\.000Z$/);
});

test('the entry document works at phone width', async () => {
  await page.goto(entryUrl('en'));
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await captureScreen(page, 'content-14-entry', BOTH);
});
