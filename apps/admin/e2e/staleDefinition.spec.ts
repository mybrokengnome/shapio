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
// Room for background schema changes (see `settleChange`) on PostgreSQL and MySQL.
test.setTimeout(240_000);

const ids = {
  note: randomUUID(),
  noteTitle: randomUUID(),
  spotlight: randomUUID(),
  card: randomUUID(),
  page: randomUUID(),
  pageTitle: randomUUID(),
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

type Category = 'models' | 'components' | 'interfaces';

const FINAL_STATUSES = new Set(['activated', 'failed', 'canceled']);
/** A change with index work runs in the background on PostgreSQL and MySQL; allow it time to finish. */
const CHANGE_SETTLE_TIMEOUT_MS = 90_000;

/**
 * Waits until the definition's newest schema change has ended (activated, failed or canceled) and returns
 * its status, or undefined when it has none. On SQLite a change activates at once; elsewhere it may run as
 * a background change, and the next write or delete is refused with SCHEMA_CHANGE_IN_PROGRESS until it ends.
 */
const settleChange = async (category: Category, definitionId: string) => {
  let latest: { status: string; error: unknown } | undefined;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${ADMIN_API}/${category}/${definitionId}/changes`);
        if (response.status() === 404) {
          latest = undefined;
          return true;
        }
        const { items } = (await response.json()) as { items: { status: string; error: unknown }[] };
        latest = items[0];
        return latest === undefined || FINAL_STATUSES.has(latest.status);
      },
      {
        message: `the newest schema change of ${category}/${definitionId} did not end within ${CHANGE_SETTLE_TIMEOUT_MS / 1000} s`,
        timeout: CHANGE_SETTLE_TIMEOUT_MS,
      },
    )
    .toBe(true);
  return latest;
};

/**
 * Waits for the definition's newest change and fails, with the change's error, unless it activated. A write
 * that activated at once leaves no change behind, which also passes.
 */
const expectActivated = async (category: Category, definitionId: string) => {
  const latest = await settleChange(category, definitionId);
  expect(latest?.status ?? 'activated', `${category}/${definitionId} change: ${JSON.stringify(latest)}`).toBe(
    'activated',
  );
};

const removeDefinition = async (category: Category, definitionId: string) => {
  await settleChange(category, definitionId);
  const response = await page.request.get(`${ADMIN_API}/${category}/${definitionId}`);
  if (response.ok()) {
    const { version } = (await response.json()) as { version: number };
    await adminRequest(
      page.request,
      'DELETE',
      `/${category}/${definitionId}?expectedVersion=${version}&acknowledgeBreaking=true`,
    );
    // The next delete may depend on this one (an interface goes only once nothing targets it).
    await settleChange(category, definitionId);
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
  await expectActivated('models', ids.note);
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
  await expectActivated('components', ids.card);
  // Placed on a type, as a component is in use: retargeting `opens` then converts that type's entries.
  await adminRequest(page.request, 'POST', '/models', {
    definition: {
      id: ids.page,
      kind: 'collection',
      apiKey: 'sdLanding',
      label: 'Stale landings',
      display: { titleFieldId: ids.pageTitle },
      fields: [
        { id: ids.pageTitle, apiKey: 'title', label: 'Title', type: 'string', required: true },
        {
          id: randomUUID(),
          apiKey: 'cards',
          label: 'Cards',
          type: 'component',
          settings: { component: ids.card, repeatable: true },
        },
      ],
    },
  });
  await expectActivated('models', ids.page);
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  // The type that uses the component first, then the component (its relation targets the interface), then
  // the targets: other specs share this server.
  await removeDefinition('models', ids.page);
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
  await expectActivated('interfaces', ids.spotlight);
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
  await expectActivated('components', ids.card);
  expect((await readCard()).version).toBe(before.version + 1);

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
