import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { adminApiFor, type AdminApi } from './content/api';
import { ADMIN_URL } from './support/constants';
import { ADMIN_API, signInAsOwner } from './support/session';

/**
 * Component item IDs through the admin editor (docs/plans/item-ids.md): every item the API returns carries
 * a stable `id`, and the editor sends it back. Reordering keeps each item's ID, a duplicate is a new item
 * (nested items included), and saving twice changes nothing: the IDs the first save gave new items are the
 * ones the second save sends. Checked through the admin API after each save.
 */
test.describe.configure({ mode: 'serial' });

const suffix = randomUUID().slice(0, 8);
const ids = { link: randomUUID(), card: randomUUID(), model: randomUUID(), title: randomUUID() };
const MODEL_KEY = `itemIdPage${suffix}`;

type Item = { id: string; [key: string]: unknown };
type Card = Item & { title: string; links: Item[] | null };
type Stored = { data: { cards: Card[]; hero: Item; sections: Item[] } };

let page: Page;
let api: AdminApi;
let entryId = '';
const pageErrors: string[] = [];

const read = () => api.get<Stored>(`/content/${MODEL_KEY}/${entryId}`);

const field = (path: string): Locator => page.locator(`[data-field-path="${path}"]`);

/** Saves with the Save button and waits for that (non-autosave) PUT to succeed. */
const save = async () => {
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().includes(`/content/${MODEL_KEY}/${entryId}`) &&
      !(response.request().postData() ?? '').includes('"autosave":true'),
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const response = await saved;
  expect(response.status(), await response.text()).toBe(200);
};

const isId = (value: unknown) => typeof value === 'string' && value.length > 0;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  api = adminApiFor(page.request, ADMIN_API);
  await api.createDefinition('components', {
    id: ids.link,
    kind: 'component',
    apiKey: `itemLink${suffix}`,
    label: 'Link',
    fields: [{ id: randomUUID(), apiKey: 'label', label: 'Label', type: 'string' }],
  });
  await api.createDefinition('components', {
    id: ids.card,
    kind: 'component',
    apiKey: `itemCard${suffix}`,
    label: 'Card',
    fields: [
      { id: randomUUID(), apiKey: 'title', label: 'Title', type: 'string' },
      {
        id: randomUUID(),
        apiKey: 'links',
        label: 'Links',
        type: 'component',
        settings: { component: ids.link, repeatable: true },
      },
    ],
  });
  await api.createDefinition('models', {
    id: ids.model,
    kind: 'collection',
    apiKey: MODEL_KEY,
    label: 'Item ID page',
    display: { layout: 'form', titleFieldId: ids.title },
    fields: [
      { id: ids.title, apiKey: 'name', label: 'Name', type: 'string' },
      {
        id: randomUUID(),
        apiKey: 'cards',
        label: 'Cards',
        type: 'component',
        settings: { component: ids.card, repeatable: true },
      },
      {
        id: randomUUID(),
        apiKey: 'hero',
        label: 'Hero',
        type: 'component',
        settings: { component: ids.link },
      },
      {
        id: randomUUID(),
        apiKey: 'sections',
        label: 'Sections',
        type: 'dynamiczone',
        settings: { components: [ids.card, ids.link] },
      },
    ],
  });
  await expect
    .poll(async () => (await page.request.get(`${ADMIN_API}/models/${ids.model}`)).status())
    .toBe(200);
  const created = await api.send<{ id: string }>('POST', `/content/${MODEL_KEY}`, {
    data: {
      name: 'Harbor guide',
      cards: [
        { title: 'Alpha', links: [{ label: 'a1' }, { label: 'a2' }] },
        { title: 'Bravo', links: null },
        { title: 'Charlie', links: null },
      ],
      hero: { label: 'Welcome' },
      sections: [{ __component: `itemLink${suffix}`, label: 'Zone link' }],
    },
  });
  entryId = created.id;
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  // Later specs expect no leftover models or shared components.
  const model = await page.request.get(`${ADMIN_API}/models/${ids.model}`);
  if (model.ok()) {
    const { version } = (await model.json()) as { version: number };
    await api.send('DELETE', `/models/${ids.model}?expectedVersion=${version}&acknowledgeBreaking=true`);
  }
  for (const componentId of [ids.card, ids.link]) {
    const { version } = await api.get<{ version: number }>(`/components/${componentId}`);
    await api.send(
      'DELETE',
      `/components/${componentId}?expectedVersion=${version}&acknowledgeBreaking=true`,
    );
  }
  await page.context().close();
});

test('reorder, duplicate and nested edits keep item IDs, and a second save keeps the new ones', async () => {
  const before = await read();
  const [alpha, bravo, charlie] = before.data.cards;
  // Every item the API returns carries an ID: list items, nested items, single instances and zone items.
  expect([alpha, bravo, charlie].every((card) => isId(card?.id))).toBe(true);
  expect(alpha?.links?.every((link) => isId(link.id))).toBe(true);
  expect(isId(before.data.hero.id)).toBe(true);
  expect(isId(before.data.sections[0]?.id)).toBe(true);
  const [a1, a2] = alpha?.links ?? [];

  await page.goto(`${ADMIN_URL}content/${MODEL_KEY}/${entryId}`);
  await expect(field('/cards/0/title').getByRole('textbox')).toHaveValue('Alpha');
  // The ID is not a field: nothing in the editor shows it.
  await expect(page.getByText(alpha?.id ?? '')).toHaveCount(0);

  await test.step('first save: move, duplicate (with nested items) and a nested reorder', async () => {
    const cards = field('/cards');
    // Charlie moves above Bravo: Alpha, Charlie, Bravo.
    await cards.getByRole('button', { name: 'Move Card (item 3) up' }).click();
    await expect(field('/cards/1/title').getByRole('textbox')).toHaveValue('Charlie');
    // Alpha is duplicated: Alpha, Alpha (copy), Charlie, Bravo. The copy is renamed.
    await cards.getByRole('button', { name: 'Duplicate Card (item 1)' }).click();
    await expect(field('/cards/1/title').getByRole('textbox')).toHaveValue('Alpha');
    await field('/cards/1/title').getByRole('textbox').fill('Alpha copy');
    // In the original Alpha, a2 moves above a1.
    await field('/cards/0/links').getByRole('button', { name: 'Move Link (item 2) up' }).click();
    await expect(field('/cards/0/links/0/label').getByRole('textbox')).toHaveValue('a2');
    await save();

    const after = await read();
    const titles = after.data.cards.map((card) => card.title);
    expect(titles).toEqual(['Alpha', 'Alpha copy', 'Charlie', 'Bravo']);
    const [kept, copy, movedCharlie, movedBravo] = after.data.cards;
    expect(kept?.id).toBe(alpha?.id);
    expect(movedCharlie?.id).toBe(charlie?.id);
    expect(movedBravo?.id).toBe(bravo?.id);
    // The nested reorder kept each link's ID.
    expect(kept?.links?.map((link) => [link.label, link.id])).toEqual([
      ['a2', a2?.id],
      ['a1', a1?.id],
    ]);
    // The duplicate and its nested links are new items with IDs of their own.
    const known = new Set([alpha?.id, bravo?.id, charlie?.id, a1?.id, a2?.id]);
    expect(isId(copy?.id) && !known.has(copy?.id)).toBe(true);
    expect(copy?.links?.map((link) => link.label)).toEqual(['a1', 'a2']);
    expect(copy?.links?.every((link) => isId(link.id) && !known.has(link.id))).toBe(true);
    // Untouched single and zone items keep theirs.
    expect(after.data.hero.id).toBe(before.data.hero.id);
    expect(after.data.sections[0]?.id).toBe(before.data.sections[0]?.id);
  });

  await test.step('second save: the IDs the first save assigned are the ones sent back', async () => {
    const first = await read();
    // Bravo moves to the top and is renamed; the copy's links swap.
    const cards = field('/cards');
    for (const position of [4, 3, 2]) {
      await cards.getByRole('button', { name: `Move Card (item ${position}) up` }).click();
    }
    await expect(field('/cards/0/title').getByRole('textbox')).toHaveValue('Bravo');
    await field('/cards/0/title').getByRole('textbox').fill('Bravo renamed');
    await field('/cards/2/links').getByRole('button', { name: 'Move Link (item 2) up' }).click();
    await expect(field('/cards/2/links/0/label').getByRole('textbox')).toHaveValue('a2');
    await save();

    const second = await read();
    const byTitle = (stored: Stored, title: string) => stored.data.cards.find((card) => card.title === title);
    expect(second.data.cards.map((card) => card.title)).toEqual([
      'Bravo renamed',
      'Alpha',
      'Alpha copy',
      'Charlie',
    ]);
    expect(byTitle(second, 'Bravo renamed')?.id).toBe(byTitle(first, 'Bravo')?.id);
    expect(byTitle(second, 'Alpha')?.id).toBe(byTitle(first, 'Alpha')?.id);
    expect(byTitle(second, 'Charlie')?.id).toBe(byTitle(first, 'Charlie')?.id);
    // The copy (new in the first save) kept the ID it was given then, and so did its links.
    const copyBefore = byTitle(first, 'Alpha copy');
    const copyAfter = byTitle(second, 'Alpha copy');
    expect(copyAfter?.id).toBe(copyBefore?.id);
    const linkIds = (card: Card | undefined) =>
      Object.fromEntries((card?.links ?? []).map((link) => [String(link.label), link.id]));
    expect(copyAfter?.links?.map((link) => link.label)).toEqual(['a2', 'a1']);
    expect(linkIds(copyAfter)).toEqual(linkIds(copyBefore));
    expect(second.data.hero.id).toBe(first.data.hero.id);
    expect(second.data.sections[0]?.id).toBe(first.data.sections[0]?.id);
  });

  await test.step('a reload shows the saved order and values', async () => {
    await page.reload();
    await expect(field('/cards/0/title').getByRole('textbox')).toHaveValue('Bravo renamed');
    await expect(field('/cards/2/title').getByRole('textbox')).toHaveValue('Alpha copy');
    await expect(field('/cards/2/links/0/label').getByRole('textbox')).toHaveValue('a2');
  });
});
