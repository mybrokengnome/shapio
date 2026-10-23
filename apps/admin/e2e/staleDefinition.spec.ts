import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_URL } from './support/constants';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * A builder reopened in the same visit shows the definition as it is now, not the copy the admin cached when
 * it first opened it (0.6.3: a component's relation moved to an interface through the schema API still showed
 * its old collection target and empty help text in the builder until a reload). The change goes through the
 * admin API, as the schema API or another session would make it; every step in the browser stays inside the
 * app, since a reload would empty the cache and hide the bug. API IDs carry an `sd` prefix.
 */
test.describe.configure({ mode: 'serial' });

const ids = {
  note: randomUUID(),
  noteTitle: randomUUID(),
  spotlight: randomUUID(),
  card: randomUUID(),
  opens: randomUUID(),
};

let page: Page;
const pageErrors: string[] = [];

type Detail = {
  version: number;
  definition: Record<string, unknown> & { fields: Record<string, unknown>[] };
};

const readCard = async () =>
  (await (await page.request.get(`${ADMIN_API}/components/${ids.card}`)).json()) as Detail;

const removeDefinition = async (category: 'models' | 'components' | 'interfaces', definitionId: string) => {
  const response = await page.request.get(`${ADMIN_API}/${category}/${definitionId}`);
  if (response.ok()) {
    const { version } = (await response.json()) as { version: number };
    await adminRequest(
      page.request,
      'DELETE',
      `/${category}/${definitionId}?expectedVersion=${version}&acknowledgeBreaking=true`,
    );
  }
};

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  await adminRequest(page.request, 'POST', '/models', {
    definition: {
      id: ids.note,
      kind: 'collection',
      apiKey: 'sdNote',
      label: 'Stale notes',
      display: { titleFieldId: ids.noteTitle },
      fields: [{ id: ids.noteTitle, apiKey: 'title', label: 'Title', type: 'string', required: true }],
    },
  });
  await adminRequest(page.request, 'POST', '/components', {
    definition: {
      id: ids.card,
      kind: 'component',
      apiKey: 'sdLinkCard',
      label: 'Stale link card',
      fields: [
        {
          id: ids.opens,
          apiKey: 'opens',
          label: 'Opens',
          type: 'relation',
          settings: { target: ids.note, cardinality: 'one' },
        },
      ],
    },
  });
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  // Component first (its relation targets the interface), then the targets: other specs share this server.
  await removeDefinition('components', ids.card);
  await removeDefinition('interfaces', ids.spotlight);
  await removeDefinition('models', ids.note);
  await page?.context().close();
});

const properties = () => page.getByRole('region', { name: / properties$/ });
const target = () => properties().getByRole('combobox', { name: 'Target model', exact: true });

const selectOpens = async () => {
  await page
    .getByRole('list', { name: /^\d+ fields?$/ })
    .getByText('Opens', { exact: true })
    .click();
  await expect(properties().getByLabel('Label', { exact: true })).toHaveValue('Opens');
};

test('a relation retargeted through the API shows its new target and help text when the builder reopens', async () => {
  await page.goto(`${ADMIN_URL}develop/components/${ids.card}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Stale link card' })).toBeVisible();
  await selectOpens();
  await expect(target()).toHaveText('Stale notes');
  // Marks this document: a full reload would drop it (and the cache with it).
  await page.evaluate(() => Object.assign(window, { sdNoReload: true }));

  // Elsewhere, an interface is created and `opens` moves to it, with a description.
  await adminRequest(page.request, 'POST', '/interfaces', {
    definition: {
      id: ids.spotlight,
      kind: 'interface',
      apiKey: 'sdSpotlight',
      label: 'Stale spotlight',
      fields: [],
    },
  });
  const before = await readCard();
  const [opens] = before.definition.fields;
  await adminRequest(page.request, 'PUT', `/components/${ids.card}`, {
    expectedVersion: before.version,
    acknowledgeBreaking: true,
    acknowledgeDestructive: true,
    definition: {
      ...before.definition,
      fields: [
        {
          ...opens,
          description: 'Where the card opens',
          settings: { target: ids.spotlight, cardinality: 'one' },
        },
      ],
    },
  });
  await expect.poll(async () => (await readCard()).version).toBe(before.version + 1);

  // Away to the inbox and back, inside the app.
  await page.getByRole('navigation').getByRole('link', { name: 'Inbox', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Stale link card' })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Stale link card' })).toBeVisible();
  expect(await page.evaluate(() => 'sdNoReload' in window)).toBe(true);

  await selectOpens();
  await expect(target()).toHaveText('Stale spotlight');
  await expect(properties().getByLabel('Help text', { exact: true })).toHaveValue('Where the card opens');
  await expect(page.getByText(`version ${before.version + 1}`).first()).toBeVisible();
  await expect(page.getByText('This component changed in another session')).toHaveCount(0);
  await target().click();
  await expect(
    page.getByRole('group', { name: 'Interfaces' }).getByRole('option', { name: 'Stale spotlight' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Review', exact: true })).toBeDisabled();
});
