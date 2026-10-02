import { expect, test, type Browser, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL, E2E_BASE_PATH, E2E_ORIGIN } from './support/constants';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * The developer pages against the real API (plan developer-face): Changes (open sets, unassigned drafts,
 * "Add to…"), a change set reviewed like a pull request (diffs, checks with a breaking acknowledgement,
 * consumers from real delivery traffic, timeline) and shipped strictly (a draft that moved after the review
 * is refused with "changed since you looked"), the model builder's "Review in a change set", Snapshots
 * (ledger, diff, time scrubber, restore) and Live. Captured at 1440 and 390 in light and dark with axe.
 */
test.describe.configure({ mode: 'serial' });

const MODEL_KEY = 'devArticle';
const ROUTE_KEY = 'devArticles';
const TOKEN_NAME = 'Next.js site';
const SET_TITLE = 'Launch: rich text body';
const BOTH = { viewports: ['desktop', 'phone'] } as const;
/** Usage counters are flushed every 30s (USAGE_FLUSH_INTERVAL_MS default). */
const USAGE_FLUSH_WAIT_MS = 45_000;

let page: Page;
const pageErrors: string[] = [];
let modelId = '';
let token = '';
const entries: { id: string; title: string }[] = [];

const openSession = async (browser: Browser) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const opened = await context.newPage();
  opened.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(opened);
  return opened;
};

const getJson = async <T>(path: string): Promise<T> => {
  const response = await page.request.get(`${ADMIN_API}${path}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
};

const deliveryRead = (query: string) =>
  page.request.get(`${E2E_ORIGIN}${E2E_BASE_PATH}/api/content/${ROUTE_KEY}${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

/** Saves a new draft value for an entry's title (the draft moves on; the live version stays). */
const editTitle = async (id: string, title: string) => {
  const entry = await getJson<{ version: number }>(`/content/${MODEL_KEY}/${id}`);
  await adminRequest(page.request, 'PUT', `/content/${MODEL_KEY}/${id}`, {
    expectedVersion: entry.version,
    data: { title },
  });
};

test.beforeAll(async ({ browser }) => {
  page = await openSession(browser);
  const model = await adminRequest(page.request, 'POST', '/models', {
    definition: {
      kind: 'collection',
      apiKey: MODEL_KEY,
      pluralApiKey: ROUTE_KEY,
      label: 'Dev article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', required: true },
        { apiKey: 'body', label: 'Body', type: 'text' },
      ],
    },
  });
  modelId = ((await model.json()) as { definitionId: string }).definitionId;
  for (const title of ['Hello world', 'Release notes', 'About us']) {
    const created = await adminRequest(page.request, 'POST', `/content/${MODEL_KEY}`, {
      data: { title, body: `${title} body.` },
      publish: true,
    });
    entries.push({ id: ((await created.json()) as { id: string }).id, title });
  }
  // A delivery role and token that reads the model, and a few reads with an explicit field selection.
  const role = await adminRequest(page.request, 'POST', '/roles', {
    key: 'dev-site-reader',
    name: 'Site reader',
    kind: 'delivery',
    permissions: [{ action: 'read', modelId, condition: null, fieldIds: null }],
  });
  const roleId = ((await role.json()) as { id: string }).id;
  const created = await adminRequest(page.request, 'POST', '/tokens', { name: TOKEN_NAME, roleId });
  token = ((await created.json()) as { token: string }).token;
  for (let read = 0; read < 3; read += 1) {
    expect((await deliveryRead('?fields=title,body')).ok()).toBe(true);
  }
  // Drafts that differ from what is live: two edits, which the Changes page lists as unassigned.
  await editTitle(entries[0]?.id ?? '', 'Hello rich text');
  await editTitle(entries[1]?.id ?? '', 'Release notes 1.0');
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page.context().close();
});

const unassigned = () => page.getByRole('region', { name: 'Unassigned' });
const openSets = () => page.getByRole('region', { name: 'Open change sets' });
const toast = (text: string | RegExp) => page.getByText(text).first();
const tab = (name: string) => page.getByRole('tab', { name, exact: true });

test('Changes lists drafts not in a set; a new set is created in a sheet', async () => {
  await page.goto(`${ADMIN_URL}changes`);
  await expect(page.getByRole('heading', { level: 1, name: 'Changes' })).toBeVisible();
  await expect(unassigned().getByRole('link', { name: 'Hello rich text' })).toBeVisible();
  await expect(unassigned().getByRole('link', { name: 'Release notes 1.0' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scheduled publications' })).toBeVisible();
  await captureScreen(page, 'changes-01-list', BOTH);

  await page.getByRole('button', { name: 'New change set' }).click();
  const sheet = page.getByRole('dialog', { name: 'New change set' });
  await sheet.getByLabel('Title', { exact: true }).fill(SET_TITLE);
  await sheet.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name: SET_TITLE })).toBeVisible();
  await expect(page.getByText('Nothing in this change set yet')).toBeVisible();
});

test('"Add to…" puts unassigned drafts into an open set', async () => {
  await page.goto(`${ADMIN_URL}changes`);
  for (const title of ['Hello rich text', 'Release notes 1.0']) {
    await unassigned()
      .getByRole('button', { name: `Add “${title}” to a change set` })
      .click();
    const popover = page.getByRole('dialog', { name: 'Add to a change set' });
    await popover.getByRole('button', { name: SET_TITLE }).click();
    await expect(popover).toBeHidden();
    await expect(toast(`Added to “${SET_TITLE}”`)).toBeVisible();
    await expect(unassigned().getByRole('link', { name: title })).toBeHidden();
  }
  await expect(openSets().getByRole('link', { name: SET_TITLE })).toBeVisible();
  await expect(openSets().getByText('2 items')).toBeVisible();
});

test('the builder\'s "Review in a change set" saves the draft into the open set and opens its review', async () => {
  await page.goto(`${ADMIN_URL}models/${modelId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Dev article' })).toBeVisible();
  const fieldList = page.getByRole('list', { name: /^\d+ fields?$/ });
  await fieldList.getByRole('button', { name: /^Body\b/ }).click();
  await page.getByLabel('Label', { exact: true }).fill('Story');
  await page.keyboard.press('ControlOrMeta+s');
  const plan = page.getByRole('dialog', { name: /^Review changes to / });
  await expect(plan).toBeVisible();
  await plan.getByRole('button', { name: 'Review in a change set' }).click();
  await expect(page).toHaveURL(/\/changes\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1, name: SET_TITLE })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Schema changes to Dev article' })).toContainText(
    'Change the label of Story',
  );
});

test('a breaking schema draft shows its classification, planner checks and consumers', async () => {
  const sets = await getJson<{ items: { id: string; title: string }[] }>('/change-sets?status=open');
  const setId = sets.items.find((set) => set.title === SET_TITLE)?.id ?? '';
  const set = await getJson<{ items: { kind: string; definitionId?: string; draftVersion?: number }[] }>(
    `/change-sets/${setId}`,
  );
  const draftItem = set.items.find((item) => item.kind === 'schema' && item.definitionId === modelId);
  const active = await getJson<{ definition: { fields: Record<string, unknown>[] }; version: number }>(
    `/models/${modelId}`,
  );
  // Body: text → richtext, a conversion that changes the API shape (breaking).
  await adminRequest(page.request, 'PUT', `/change-sets/${setId}/schema/${modelId}`, {
    category: 'model',
    baseVersion: active.version,
    expectedDraftVersion: draftItem?.draftVersion,
    definition: {
      ...active.definition,
      fields: active.definition.fields.map(({ editor, ...field }) =>
        field.apiKey === 'body' ? { ...field, type: 'richtext', settings: {} } : { ...field, editor },
      ),
    },
  });
  // Wait for the delivery reads to be flushed into the usage counters.
  await expect
    .poll(
      async () => {
        const usage = await getJson<{ principals: { tokenName?: string }[] }>(
          `/usage/fields?modelId=${modelId}&days=7`,
        );
        return usage.principals.map((principal) => principal.tokenName);
      },
      { timeout: USAGE_FLUSH_WAIT_MS, intervals: [2_000] },
    )
    .toContain(TOKEN_NAME);

  await page.goto(`${ADMIN_URL}changes/${setId}`);
  await expect(page.getByRole('heading', { level: 1, name: SET_TITLE })).toBeVisible();
  const schemaChanges = page.getByRole('list', { name: 'Schema changes to Dev article' });
  await expect(schemaChanges.getByText('Breaking')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Field changes in Hello rich text' })).toContainText(
    'Hello world',
  );
  await expect(page.getByRole('button', { name: 'Ship', exact: true })).toBeDisabled();
  await captureScreen(page, 'changes-02-review', BOTH);

  await tab('Checks').click();
  await expect(page.getByRole('region', { name: /^Schema plan: / })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Entry validation' })).toBeVisible();
  await captureScreen(page, 'changes-03-checks', BOTH);

  await tab('Consumers').click();
  await expect(page.getByRole('cell', { name: TOKEN_NAME })).toBeVisible();
  await expect(page.getByText('Selects this field')).toBeVisible();
  await captureScreen(page, 'changes-04-consumers', BOTH);

  await tab('Timeline').click();
  await expect(page.getByText('Created', { exact: true })).toBeVisible();
  await captureScreen(page, 'changes-05-timeline', BOTH);
});

test('shipping is strict: a draft that moved after the review is refused until refreshed', async () => {
  await tab('Checks').click();
  await page.getByLabel('I understand this changes the API contract', { exact: false }).check();
  const ship = page.getByRole('button', { name: 'Ship', exact: true });
  await expect(ship).toBeEnabled();
  // Someone edits an entry in the set after this review loaded.
  await editTitle(entries[0]?.id ?? '', 'Hello rich text, again');
  await ship.click();
  const confirm = page.getByRole('alertdialog', { name: `Ship “${SET_TITLE}”?` });
  await confirm.getByRole('button', { name: 'Ship' }).click();
  await expect(page.getByText('Changed since you looked')).toBeVisible();
  await expect(ship).toBeDisabled();

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('Changed since you looked')).toBeHidden();
  await page.getByLabel('I understand this changes the API contract', { exact: false }).check();
  await ship.click();
  await page
    .getByRole('alertdialog', { name: `Ship “${SET_TITLE}”?` })
    .getByRole('button', { name: 'Ship' })
    .click();
  await expect(page.getByText('Shipped. Live as')).toBeVisible({ timeout: 30_000 });
  const live = await deliveryRead(`/${entries[0]?.id ?? ''}?fields=title`);
  expect(((await live.json()) as { data: { title: string } }).data.title).toBe('Hello rich text, again');
});

test('Snapshots lists the ledger; the detail diffs against the previous snapshot and scrubs through time', async () => {
  await page.goto(`${ADMIN_URL}snapshots`);
  await expect(page.getByRole('heading', { level: 1, name: 'Snapshots' })).toBeVisible();
  const latest = page.getByRole('row').filter({ hasText: SET_TITLE });
  await expect(latest).toBeVisible();
  await captureScreen(page, 'snapshots-01-list', BOTH);

  await latest.getByRole('link', { name: /^v\d+$/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^v\d+$/ })).toBeVisible();
  await expect(page.getByText(/entr(y|ies) changed/)).toBeVisible();
  await expect(page.getByRole('link', { name: entries[0]?.id ?? '' })).toBeVisible();
  await captureScreen(page, 'snapshots-02-diff', BOTH);

  await tab('Timeline').click();
  const scrubber = page.getByRole('slider', { name: 'Snapshot' });
  await expect(scrubber).toBeVisible();
  const before = await scrubber.getAttribute('aria-valuetext');
  await scrubber.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(scrubber).not.toHaveAttribute('aria-valuetext', before ?? '');
  await captureScreen(page, 'snapshots-03-timeline', BOTH);
});

test('Restore creates a reviewable change set for an earlier snapshot', async () => {
  await page.goto(`${ADMIN_URL}snapshots`);
  const restore = page.getByRole('button', { name: /^Restore v\d+$/ }).first();
  const label = (await restore.getAttribute('aria-label')) ?? '';
  const seq = label.replace('Restore v', '');
  await restore.click();
  await page
    .getByRole('alertdialog', { name: `Restore v${seq}?` })
    .getByRole('button', { name: 'Restore' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: `Restore snapshot ${seq}` })).toBeVisible();
});

test('Live shows the serving snapshot, who reads what and content health', async () => {
  // A pinned read, so the reader shows the snapshot it pins.
  const current = await getJson<{ current: number }>('/snapshots');
  expect((await deliveryRead(`?fields=title&snapshot=${current.current}`)).ok()).toBe(true);
  await page.goto(`${ADMIN_URL}live`);
  await expect(page.getByRole('heading', { level: 1, name: 'Live' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Serving' })).toContainText(`v${current.current}`);
  const readers = page.getByRole('region', { name: 'Who reads what' });
  await expect(readers.getByRole('cell', { name: TOKEN_NAME })).toBeVisible();
  await expect(readers).toContainText(`${MODEL_KEY}.title`);
  await expect(page.getByRole('region', { name: 'Content health' })).toBeVisible();
  await captureScreen(page, 'live-01', BOTH);
});
