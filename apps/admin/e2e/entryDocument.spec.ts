import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { captureScreen, type ViewportName } from './support/capture';
import { ADMIN_URL, E2E_BASE_PATH, E2E_ORIGIN } from './support/constants';
import { entryDocument } from './support/entryDocument';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * The entry document (editor experience E1, acceptance §8): a non-developer writes an article (title,
 * body, an image dropped straight into the text, a component block), publishes it through the pre-flight
 * (which catches the image's missing alt text and takes them to it), and the delivery API serves it. An
 * Author, which has no canvas fields, opens as a document with a properties grid. Captured at 1440 and
 * 390 in both themes with axe.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const BOTH: { viewports: ViewportName[] } = { viewports: ['desktop', 'phone'] };
const id = () => randomUUID();

const ids = {
  featureGrid: id(),
  author: id(),
  article: id(),
  title: id(),
  authorName: id(),
};

let page: Page;
let token = '';
let storyUrl = '';
/** Files this spec put in the library (the shared server's media spec expects an empty library). */
const uploadedAssets: string[] = [];
const pageErrors: string[] = [];

const getJson = async <T>(path: string): Promise<T> => {
  const response = await page.request.get(`${ADMIN_API}${path}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
};

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  await adminRequest(page.request, 'POST', '/components', {
    definition: {
      id: ids.featureGrid,
      kind: 'component',
      apiKey: 'featureGrid',
      label: 'Feature grid',
      fields: [
        { id: id(), apiKey: 'heading', label: 'Heading', type: 'string' },
        { id: id(), apiKey: 'text', label: 'Text', type: 'text' },
      ],
    },
  });
  await adminRequest(page.request, 'POST', '/models', {
    definition: {
      id: ids.author,
      kind: 'collection',
      apiKey: 'writer',
      label: 'Writer',
      display: { titleFieldId: ids.authorName },
      fields: [
        { id: ids.authorName, apiKey: 'name', label: 'Name', type: 'string', required: true },
        {
          id: id(),
          apiKey: 'portrait',
          label: 'Portrait',
          type: 'media',
          settings: { allowedKinds: ['image'] },
        },
        { id: id(), apiKey: 'role', label: 'Role', type: 'string' },
        { id: id(), apiKey: 'bio', label: 'Bio', type: 'text' },
        { id: id(), apiKey: 'website', label: 'Website', type: 'url' },
      ],
    },
  });
  await adminRequest(page.request, 'POST', '/models', {
    definition: {
      id: ids.article,
      kind: 'collection',
      apiKey: 'story',
      label: 'Story',
      display: { titleFieldId: ids.title },
      fields: [
        { id: ids.title, apiKey: 'title', label: 'Title', type: 'string', required: true },
        { id: id(), apiKey: 'slug', label: 'Slug', type: 'slug', settings: { sourceFieldId: ids.title } },
        { id: id(), apiKey: 'excerpt', label: 'Excerpt', type: 'text' },
        {
          id: id(),
          apiKey: 'writer',
          label: 'Writer',
          type: 'relation',
          settings: { target: ids.author, cardinality: 'one' },
        },
        { id: id(), apiKey: 'body', label: 'Body', type: 'richtext' },
        {
          id: id(),
          apiKey: 'sections',
          label: 'Sections',
          type: 'dynamiczone',
          settings: { components: [ids.featureGrid] },
        },
      ],
    },
  });
  const role = await adminRequest(page.request, 'POST', '/roles', {
    key: 'story-reader',
    name: 'Story reader',
    kind: 'delivery',
    permissions: [{ action: 'read', modelId: ids.article, condition: null, fieldIds: null }],
  });
  const roleId = ((await role.json()) as { id: string }).id;
  const created = await adminRequest(page.request, 'POST', '/tokens', { name: 'Story site', roleId });
  token = ((await created.json()) as { token: string }).token;
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  // Content still uses the image, so only a forced delete (the owner's) removes it.
  for (const assetId of uploadedAssets.filter(Boolean)) {
    await adminRequest(page.request, 'DELETE', `/media/assets/${assetId}?force=true`);
  }
  await page?.context().close();
});

test('write an article: title, body, a dropped image, a component block; publish through the pre-flight', async () => {
  const doc = entryDocument(page);
  await page.goto(`${ADMIN_URL}content/story/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'New Story' })).toBeVisible();
  // A document, not a form: the title is typed into the page and the body is the writing surface.
  await page.getByRole('textbox', { name: 'Title' }).fill('A brighter kind of play');
  const body = page.getByRole('textbox', { name: 'Body' });
  await body.click();
  await page.keyboard.type('Made for curious minds. Small adventures, big discoveries.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('The collection opens on Friday.');
  await captureScreen(page, 'editor-01-new-story', BOTH);

  // The `/` menu offers the rich-text blocks, filtered as you type.
  await page.keyboard.press('Enter');
  await page.keyboard.type('/head');
  const slash = page.getByRole('listbox', { name: 'Blocks' });
  await expect(slash.getByRole('option', { name: 'Heading', exact: true })).toBeVisible();
  await captureScreen(page, 'editor-02-slash-menu', { viewports: ['desktop'] });
  await page.keyboard.press('Enter');
  await page.keyboard.type("What's in it");
  await expect(body.locator('h2')).toHaveText("What's in it");

  // An image dropped straight into the text uploads to the library and becomes an image block.
  await doc.dropImage(body, 'dawn.png');
  const image = doc.field('/body').locator('figure[data-media-id]');
  await expect(image).toHaveCount(1, { timeout: 20_000 });
  await expect(image.locator('img')).toBeVisible();
  uploadedAssets.push((await image.getAttribute('data-media-id')) ?? '');

  // A component block from the `+` after the canvas offers only what Sections can hold.
  await doc.addBlock('Feature grid');
  await doc.field('/sections/0/heading').getByRole('textbox').fill('Twelve stories');
  await doc.field('/sections/0/text').getByRole('textbox').fill('Three of them longform.');
  await captureScreen(page, 'editor-03-blocks', BOTH);

  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/content\/story\/[0-9a-f-]{36}$/);
  storyUrl = page.url();
  await expect(page.getByRole('heading', { level: 1, name: 'A brighter kind of play' })).toBeVisible();

  // The pre-flight says, in a sentence, that the image has no alt text, and Fix goes to it.
  const preflight = await doc.openPreflight();
  const altCheck = preflight.getByRole('listitem').filter({ hasText: 'has no alt text' });
  await expect(altCheck).toContainText('An image in Body has no alt text');
  // A warning informs; it doesn't block.
  await expect(preflight.getByRole('button', { name: 'Publish now' })).toBeEnabled();
  await captureScreen(page, 'editor-04-preflight', BOTH);
  await altCheck.getByRole('button', { name: 'Fix' }).click();
  await expect(preflight).toBeHidden();
  const alt = doc.field('/body').getByLabel('Alt text');
  await expect(alt).toBeFocused();
  await alt.fill('Children running across a meadow at dawn');

  const again = await doc.openPreflight();
  await expect(again.getByText('Everything is ready.')).toBeVisible();
  await again.getByRole('button', { name: 'Publish now' }).click();
  await expect(again).toBeHidden();
  await expect(page.getByText('Published.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Published', exact: true })).toBeDisabled();
  await captureScreen(page, 'editor-05-published', BOTH);

  // The settings drawer sits beside the document: properties as rows that open to their editor.
  const excerpt = await doc.property('excerpt');
  await excerpt.getByRole('textbox').fill('A weekend of small adventures.');
  await expect(page.getByRole('textbox', { name: 'Title' })).toBeEditable();
  await captureScreen(page, 'editor-06-settings', BOTH);
  await page.keyboard.press('Escape');
  await expect(doc.drawer()).toBeHidden();

  // The delivery API serves what was published: the body with the uploaded image and its alt text.
  const delivered = await page.request.get(`${E2E_ORIGIN}${E2E_BASE_PATH}/api/content/stories`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(delivered.ok(), await delivered.text()).toBe(true);
  const items = ((await delivered.json()) as { data: { title: string; body: unknown; sections: unknown }[] })
    .data;
  expect(items[0]?.title).toBe('A brighter kind of play');
  const json = JSON.stringify(items[0]?.body);
  expect(json).toContain('Children running across a meadow at dawn');
  expect(json).toContain('"text":"What\'s in it"');
  expect(JSON.stringify(items[0]?.sections)).toContain('Twelve stories');
});

test('the pre-flight adds the entry to a change set instead of publishing now', async () => {
  const doc = entryDocument(page);
  await page.goto(storyUrl);
  await page.getByRole('textbox', { name: 'Title' }).fill('A brighter kind of play, revisited');
  const preflight = await doc.openPreflight();
  await preflight.getByRole('button', { name: 'Add to change set…' }).click();
  const popover = page.getByRole('dialog', { name: 'Publish when a change set ships' });
  await popover.getByRole('textbox', { name: 'New change set' }).fill('Spring launch');
  await captureScreen(page, 'editor-09-change-set', { viewports: ['desktop'] });
  await popover.getByRole('button', { name: 'Create' }).click();
  await expect(preflight).toBeHidden();
  const toast = page.getByText('Added to “Spring launch”. It goes live when the set ships.');
  await expect(toast).toBeVisible();
  const storyId = /\/content\/story\/([0-9a-f-]{36})/.exec(storyUrl)?.[1] ?? '';
  const sets = await getJson<{ items: { id: string; title: string }[] }>('/change-sets?status=open');
  const set = sets.items.find((item) => item.title === 'Spring launch');
  expect(set).toBeDefined();
  const detail = await getJson<{ items: { entryId?: string; action?: string }[] }>(
    `/change-sets/${set?.id ?? ''}`,
  );
  expect(detail.items).toContainEqual(expect.objectContaining({ entryId: storyId, action: 'publish' }));
  // The toast links to the set.
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(new RegExp(`/changes/${set?.id ?? ''}`));
});

test('presence: another session on the same entry shows in the top bar within 20 seconds', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const other = await context.newPage();
  await signInAsOwner(other);
  await page.goto(storyUrl);
  await other.goto(storyUrl);
  // The same person in another tab still counts: presence is per tab, never a lock.
  const avatars = page.getByRole('img', { name: /^Also editing:/ });
  await expect(avatars).toBeVisible({ timeout: 20_000 });
  await expect(avatars).toHaveAccessibleName('Also editing: you, in another tab');
  await captureScreen(page, 'editor-08-presence', { viewports: ['desktop'] });
  // Leaving the page tells the server at once (a keepalive request), so it disappears on the next beat.
  await other.goto('about:blank');
  await expect(avatars).toBeHidden({ timeout: 20_000 });
  await context.close();
});

test('a model without canvas fields opens as a document with a properties grid', async () => {
  const created = await adminRequest(page.request, 'POST', '/content/writer', {
    data: { name: 'Ada Lovelace', role: 'Editor' },
  });
  const entry = (await created.json()) as { id: string };
  await page.goto(`${ADMIN_URL}content/writer/${entry.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Ada Lovelace' })).toBeVisible();
  const grid = page.locator('[data-property-grid]');
  await expect(grid.getByRole('textbox', { name: 'Role' })).toHaveValue('Editor');
  await grid.getByRole('textbox', { name: 'Bio' }).fill('Wrote the first program.');
  // The single image field is the cover: an "Add Portrait" band above the title, not a property.
  await expect(page.getByRole('button', { name: /Add Portrait/ })).toBeVisible();
  await expect(grid.locator('[data-field-path="/portrait"]')).toHaveCount(0);
  await captureScreen(page, 'editor-07-property-only', BOTH);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible();
  const saved = await getJson<{ data: { bio: string } }>(`/content/writer/${entry.id}`);
  expect(saved.data.bio).toBe('Wrote the first program.');
});
