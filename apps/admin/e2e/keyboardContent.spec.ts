import { expect, test, type Locator, type Page } from '@playwright/test';
import { id, type AdminApi } from './content/api';
import type { ProjectServer } from './content/projectServer';
import {
  expectFocusTrappedIn,
  expectFullTabCycle,
  expectVisibleFocus,
  inBothSchemes,
  resetFocusToTop,
  tabTo,
  waitForAnimations,
} from './support/keyboard';
import { createKeyboardHelpers, openKeyboardSuite } from './support/keyboardSuite';

/**
 * Keyboard-only use of the entry document: every field type (properties in the settings drawer), the
 * relation and media pickers, the cover, rich text with a shortcut, a component block from the canvas's
 * `+`, Mod+S. After the first page.goto nothing is clicked: only Tab, arrows,
 * Enter, Space and Escape. Every focus stop must show a visible indicator in light and dark, Tab must cycle
 * through the page without a trap, modal overlays must hold focus until Escape, and focus must return to the
 * control that opened them. Runs on its own server (a fresh database).
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

type Entry = { id: string; data: Record<string, unknown> };

let server: ProjectServer;
let page: Page;
let api: AdminApi;
const authors: Record<string, string> = {};
let coverId = '';
const pageErrors: string[] = [];

const FEATURE_ID = id();
const AUTHOR_ID = id();
const authorName = id();
const articleTitle = id();

const feature = {
  id: FEATURE_ID,
  kind: 'component',
  apiKey: 'feature',
  label: 'Feature',
  fields: [{ id: id(), apiKey: 'title', label: 'Feature title', type: 'string' }],
};
const author = {
  id: AUTHOR_ID,
  kind: 'collection',
  apiKey: 'author',
  label: 'Author',
  display: { titleFieldId: authorName },
  fields: [{ id: authorName, apiKey: 'name', label: 'Name', type: 'string', filterable: true }],
};
const article = {
  id: id(),
  kind: 'collection',
  apiKey: 'article',
  label: 'Article',
  display: { titleFieldId: articleTitle },
  fields: [
    { id: articleTitle, apiKey: 'title', label: 'Title', type: 'string' },
    { id: id(), apiKey: 'summary', label: 'Summary', type: 'text' },
    { id: id(), apiKey: 'featured', label: 'Featured', type: 'boolean' },
    {
      id: id(),
      apiKey: 'tone',
      label: 'Tone',
      type: 'enum',
      settings: {
        values: [
          { value: 'calm', label: 'Calm' },
          { value: 'bold', label: 'Bold' },
          { value: 'playful', label: 'Playful' },
        ],
      },
    },
    { id: id(), apiKey: 'publishOn', label: 'Publish on', type: 'date' },
    { id: id(), apiKey: 'body', label: 'Body', type: 'richtext' },
    {
      id: id(),
      apiKey: 'author',
      label: 'Author',
      type: 'relation',
      settings: { target: AUTHOR_ID, cardinality: 'one' },
    },
    { id: id(), apiKey: 'cover', label: 'Cover', type: 'media', settings: { multiple: false } },
    {
      id: id(),
      apiKey: 'features',
      label: 'Features',
      type: 'component',
      settings: { component: FEATURE_ID, repeatable: true },
    },
  ],
};

test.beforeAll(async ({ browser }) => {
  ({ server, page, api } = await openKeyboardSuite(browser, 'keyboard', pageErrors));
  await api.createDefinition('components', feature);
  await api.createDefinition('models', author);
  await api.createDefinition('models', article);
  for (const name of ['Ada Lovelace', 'Grace Hopper']) {
    authors[name] = (await api.send<Entry>('POST', '/content/author', { data: { name } })).id;
  }
  coverId = (await api.uploadPng('kb-cover.png', 800, 600)).id;
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page?.context().close();
  await server?.stop();
});

const { arrowTo, escapeBackTo } = createKeyboardHelpers(() => page);

const field = (path: string): Locator => page.locator(`[data-field-path="${path}"]`);

test('entry document: every stop has a visible focus ring in light and dark, and Tab never gets stuck', async () => {
  await page.goto(`${server.adminUrl}content/article/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'New Article' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Body' })).toBeVisible();
  await inBothSchemes(page, () => expectFullTabCycle(page));
});

test('entry document: every field type is filled, picked and saved with the keyboard only', async () => {
  await resetFocusToTop(page);
  const title = page.getByRole('textbox', { name: 'Title' });
  await tabTo(page, title, { max: 40 });
  await page.keyboard.type('Keyboard only');

  // ⌘/ opens the settings drawer beside the document with focus in it; each property row opens with Enter
  // and its editor is the next stop.
  await page.keyboard.press('ControlOrMeta+/');
  const drawer = page.locator('#entry-settings');
  await expect(drawer).toBeVisible();
  await waitForAnimations(page);
  const openRow = async (apiKey: string) => {
    const toggle = drawer.locator(`[data-property-row="${apiKey}"] > button`);
    await tabTo(page, toggle, { max: 12 });
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  };

  await openRow('summary');
  const summary = field('/summary').getByRole('textbox');
  await tabTo(page, summary, { max: 1 });
  await page.keyboard.type('Written without a mouse.');

  await openRow('featured');
  const featured = field('/featured').getByRole('switch');
  await tabTo(page, featured, { max: 1 });
  await page.keyboard.press('Space');
  await expect(featured).toHaveAttribute('aria-checked', 'true');

  await openRow('tone');
  const tone = field('/tone').getByRole('combobox');
  await tabTo(page, tone, { max: 1 });
  await page.keyboard.press('Enter');
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await expectVisibleFocus(page, '(select option)');
  await escapeBackTo(listbox, tone);
  await page.keyboard.press('Enter');
  await expect(listbox).toBeVisible();
  await arrowTo(listbox.getByRole('option', { name: 'Bold' }));
  await page.keyboard.press('Enter');
  await expect(listbox).toBeHidden();
  await expect(tone).toBeFocused();
  await expect(tone).toHaveText(/Bold/);

  await openRow('publishOn');
  const publishOn = field('/publishOn').locator('input[type="date"]');
  await tabTo(page, publishOn, { max: 2 });
  await page.keyboard.type('03152026');
  await expect(publishOn).toHaveValue('2026-03-15');

  await openRow('author');
  const chooseAuthor = field('/author').getByRole('button', { name: 'Choose Author' });
  await tabTo(page, chooseAuthor, { max: 2 });
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Choose Author' });
  const search = picker.getByRole('combobox', { name: 'Search Author' });
  const options = picker.getByRole('listbox', { name: 'Entries' }).getByRole('option');
  await expect(picker.getByRole('option', { name: 'Grace Hopper' })).toBeVisible();
  await expect(search).toBeFocused();
  await inBothSchemes(page, () => expectFocusTrappedIn(page, picker));
  await escapeBackTo(picker, chooseAuthor);
  await page.keyboard.press('Enter');
  await expect(search).toBeFocused();
  await expect(options).toHaveCount(2);
  await expectVisibleFocus(page, '(relation search)');
  // Focus stays in the search box: ↑/↓ move the highlighted option (aria-activedescendant), Enter picks it.
  const activeOption = () =>
    search.evaluate(
      (input) =>
        document.getElementById(input.getAttribute('aria-activedescendant') ?? '')?.textContent ?? '',
    );
  const [first = '', second = ''] = await options.allTextContents();
  await expect.poll(activeOption).toBe('');
  await page.keyboard.press('ArrowDown');
  await expect.poll(activeOption).toBe(first);
  await page.keyboard.press('ArrowDown');
  await expect.poll(activeOption).toBe(second);
  await page.keyboard.press('ArrowUp');
  await expect.poll(activeOption).toBe(first);
  await page.keyboard.type('Grace');
  await expect(options).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect.poll(activeOption).toBe('Grace Hopper');
  await page.keyboard.press('Enter');
  await expect(picker).toBeHidden();
  await expect(field('/author').getByText('Grace Hopper')).toBeVisible();
  await expect(field('/author').getByRole('button', { name: 'Change' })).toBeFocused();

  // Escape closes the drawer; focus goes back to where it was opened from (the title).
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(title).toBeFocused();

  // The cover band sits above the title: choosing a file from it moves focus to Replace.
  const chooseCover = page.getByRole('button', { name: /^Add Cover/ });
  await tabTo(page, chooseCover, { max: 2, backwards: true });
  await page.keyboard.press('Enter');
  const library = page.getByRole('dialog', { name: 'Choose a file' });
  await expect(library).toBeVisible();
  const coverCheckbox = library.getByRole('checkbox', { name: 'Select kb-cover.png' });
  await expect(coverCheckbox).toBeVisible();
  await inBothSchemes(page, () => expectFocusTrappedIn(page, library));
  await escapeBackTo(library, chooseCover);
  await page.keyboard.press('Enter');
  await expect(coverCheckbox).toBeVisible();
  // The picker is a sheet: let it finish sliding in before tabbing through it.
  await waitForAnimations(page);
  await tabTo(page, coverCheckbox, { max: 20 });
  await page.keyboard.press('Space');
  await expect(coverCheckbox).toBeChecked();
  await tabTo(page, library.getByRole('button', { name: 'Choose file' }), { max: 10 });
  await page.keyboard.press('Enter');
  await expect(library).toBeHidden();
  await expect(field('/cover').getByRole('button', { name: 'Replace' })).toBeFocused();

  const body = page.getByRole('textbox', { name: 'Body' });
  await tabTo(page, body, { max: 15 });
  await page.keyboard.type('Plain then ');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('bold');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type(' text.');
  await expect(body.locator('strong')).toHaveText('bold');

  // The `+` after Body offers what fits there: Body's blocks and the Features list's component.
  const addHere = page.getByRole('button', { name: /^Add a block here \(Body, Features\)/ });
  await tabTo(page, addHere, { max: 2 });
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  // Body's ten block types come first, then the components.
  await arrowTo(menu.getByRole('menuitem', { name: 'Feature', exact: true }), 12);
  await page.keyboard.press('Enter');
  // Focus moves to the new block's header, then on to its first field.
  await expect(field('/features').getByRole('button', { expanded: true })).toBeFocused();
  const featureTitle = field('/features/0/title').getByRole('textbox');
  await tabTo(page, featureTitle, { max: 8 });
  await page.keyboard.type('Fast');

  // Mod+S saves (creates) from anywhere in the document.
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page).toHaveURL(/\/content\/article\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1, name: 'Keyboard only' })).toBeVisible();
  // History from the drawer: a modal sheet over it; Escape closes it and focus goes back to its button.
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await resetFocusToTop(page);
  await tabTo(page, settings, { max: 40 });
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  await waitForAnimations(page);
  const allVersions = drawer.getByRole('button', { name: 'All versions and compare' });
  await tabTo(page, allVersions, { max: 40 });
  await page.keyboard.press('Enter');
  const history = page.getByRole('dialog', { name: 'History' });
  await expect(history).toBeVisible();
  await inBothSchemes(page, () => expectFocusTrappedIn(page, history));
  await escapeBackTo(history, allVersions);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // The saved entry (author, cover, the feature block) has no trap or hidden ring.
  await inBothSchemes(page, () => expectFullTabCycle(page));
  const entryId = /\/content\/article\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  const saved = await api.get<Entry>(`/content/article/${entryId}`);
  expect(saved.data).toMatchObject({
    title: 'Keyboard only',
    summary: 'Written without a mouse.',
    featured: true,
    tone: 'bold',
    publishOn: '2026-03-15',
    author: authors['Grace Hopper'],
    cover: expect.objectContaining({ id: coverId }),
    features: [{ title: 'Fast' }],
  });
  type TextNode = { text: string; marks?: { type: string }[] };
  const richText = saved.data.body as { doc: { content: { content: TextNode[] }[] } };
  expect(richText.doc.content[0]?.content).toEqual([
    { type: 'text', text: 'Plain then ' },
    { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
    { type: 'text', text: ' text.' },
  ]);
});

test('place list: row actions, their menu and inline confirmations work with the keyboard only', async () => {
  await page.goto(`${server.adminUrl}content/author`);
  await expect(page.getByRole('heading', { level: 1, name: 'Author' })).toBeVisible();
  await expect(page.getByRole('table').getByRole('row').filter({ hasText: 'Grace Hopper' })).toBeVisible();
  await inBothSchemes(page, () => expectFullTabCycle(page));

  // Row actions are revealed when focus reaches them, in reading order: Edit, Publish, More.
  await resetFocusToTop(page);
  const more = page.getByRole('button', { name: 'More actions for Grace Hopper' });
  await tabTo(page, more, { max: 80 });
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await arrowTo(menu.getByRole('menuitem', { name: 'Delete' }));
  await page.keyboard.press('Enter');
  const remove = page.getByRole('alertdialog', { name: 'Delete “Grace Hopper”?' });
  await expect(remove.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expectFocusTrappedIn(page, remove);
  await escapeBackTo(remove, more);

  const publish = page.getByRole('button', { name: 'Publish Grace Hopper' });
  await tabTo(page, publish, { max: 2, backwards: true });
  await page.keyboard.press('Enter');
  const ask = page.getByRole('alertdialog', { name: 'Publish “Grace Hopper”?' });
  await expect(ask.getByRole('button', { name: 'Publish' })).toBeFocused();
  await expectVisibleFocus(page, '(publish confirmation)');
  await page.keyboard.press('Enter');
  await expect(page.getByText('“Grace Hopper” is live.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unpublish Grace Hopper' })).toBeFocused();
});
