import { expect, test, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL, E2E_BASE_PATH, E2E_ORIGIN } from './support/constants';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * Older clients in reviews (plan schema-lenses): a token built against an older schema version keeps
 * naming it; a change set that renames, retypes and removes fields says per breaking line what such clients
 * see, the Consumers tab lists the token with its version, the acknowledgement says who is protected, API
 * tokens shows the version a token sends, and the API explorer reads as an older client. Captured at 1440
 * and 390 in light and dark with axe.
 */
test.describe.configure({ mode: 'serial' });

const MODEL_KEY = 'lensArticle';
const ROUTE_KEY = 'lensArticles';
const TOKEN_NAME = 'Old mobile app';
const SET_TITLE = 'Trim the article';
const BOTH = { viewports: ['desktop', 'phone'] } as const;
/** Usage counters are flushed every 30s (USAGE_FLUSH_INTERVAL_MS default). */
const USAGE_FLUSH_WAIT_MS = 45_000;

type Definition = { fields: Array<Record<string, unknown> & { apiKey: string }> } & Record<string, unknown>;

let page: Page;
const pageErrors: string[] = [];
let modelId = '';
let token = '';
/** The schema version the old client was built against: the token it sends and its number. */
let schemaVersionToken = '';
let schemaVersion = 0;

const getJson = async <T>(path: string): Promise<T> => {
  const response = await page.request.get(`${ADMIN_API}${path}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
};

const delivery = (path: string) =>
  page.request.get(`${E2E_ORIGIN}${E2E_BASE_PATH}/api/${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });

const activeModel = () => getJson<{ definition: Definition; version: number }>(`/models/${modelId}`);

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  const model = await adminRequest(page.request, 'POST', '/models', {
    definition: {
      kind: 'collection',
      apiKey: MODEL_KEY,
      pluralApiKey: ROUTE_KEY,
      label: 'Lens article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'count', label: 'Count', type: 'integer' },
        { apiKey: 'body', label: 'Body', type: 'text' },
      ],
    },
  });
  modelId = ((await model.json()) as { definitionId: string }).definitionId;
  await adminRequest(page.request, 'POST', `/content/${MODEL_KEY}`, {
    data: { title: 'Hello lenses', count: 3, body: 'Body text.' },
    publish: true,
  });
  const role = await adminRequest(page.request, 'POST', '/roles', {
    key: 'lens-app-reader',
    name: 'App reader',
    kind: 'delivery',
    permissions: [{ action: 'read', modelId, condition: null, fieldIds: null }],
  });
  const roleId = ((await role.json()) as { id: string }).id;
  const created = await adminRequest(page.request, 'POST', '/tokens', { name: TOKEN_NAME, roleId });
  token = ((await created.json()) as { token: string }).token;
  // The app is built against today's schema version and names it with every read.
  const current = await delivery('snapshots/current');
  schemaVersionToken = ((await current.json()) as { schemaVersionToken: string }).schemaVersionToken;
  schemaVersion = Number(schemaVersionToken.split(':')[1]);
  for (let count = 0; count < 2; count += 1) {
    const read = await delivery(
      `content/${ROUTE_KEY}?schemaVersion=${encodeURIComponent(schemaVersionToken)}`,
    );
    expect(read.ok(), await read.text()).toBe(true);
  }
  // Then the schema moves on, live: title becomes headline (old clients keep reading it as title).
  const active = await activeModel();
  await adminRequest(page.request, 'PUT', `/models/${modelId}`, {
    expectedVersion: active.version,
    acknowledgeBreaking: true,
    definition: {
      ...active.definition,
      fields: active.definition.fields.map((field) =>
        field.apiKey === 'title' ? { ...field, apiKey: 'headline' } : field,
      ),
    },
  });
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page.context().close();
});

const tab = (name: string) => page.getByRole('tab', { name, exact: true });

test('a breaking change set says what older clients see, who sends which version, and who is protected', async () => {
  await expect
    .poll(
      async () =>
        (
          await getJson<{ principals: { tokenName?: string; schemaVersion: number }[] }>(
            '/usage/schema-versions',
          )
        ).principals.find((principal) => principal.tokenName === TOKEN_NAME)?.schemaVersion,
      { timeout: USAGE_FLUSH_WAIT_MS, intervals: [2_000] },
    )
    .toBe(schemaVersion);

  const set = await adminRequest(page.request, 'POST', '/change-sets', { title: SET_TITLE });
  const setId = ((await set.json()) as { id: string }).id;
  const active = await activeModel();
  // Count becomes text (old clients read the numbers that still fit), body is removed (reads empty).
  await adminRequest(page.request, 'PUT', `/change-sets/${setId}/schema/${modelId}`, {
    category: 'model',
    baseVersion: active.version,
    definition: {
      ...active.definition,
      fields: active.definition.fields
        .filter((field) => field.apiKey !== 'body')
        .map(({ editor, ...field }) =>
          field.apiKey === 'count' ? { ...field, type: 'string', settings: {} } : { ...field, editor },
        ),
    },
  });

  await page.goto(`${ADMIN_URL}changes/${setId}`);
  await expect(page.getByRole('heading', { level: 1, name: SET_TITLE })).toBeVisible();
  const schemaChanges = page.getByRole('list', { name: 'Schema changes to Lens article' });
  await expect(
    schemaChanges.getByText('Clients naming an older schema version get this field empty'),
  ).toBeVisible();
  await expect(
    schemaChanges.getByText('Clients naming an older schema version get some values empty'),
  ).toBeVisible();
  await captureScreen(page, 'lenses-01-review', BOTH);

  await tab('Checks').click();
  await expect(page.locator('[data-older-clients-ack]')).toContainText(
    `Not protected: readers naming schema version ${schemaVersion}, and readers that name no schema version.`,
  );
  await page.locator('[data-older-clients-ack]').scrollIntoViewIfNeeded();
  await captureScreen(page, 'lenses-02-checks', BOTH);

  await tab('Consumers').click();
  const older = page.getByRole('region', { name: 'Readers on older schema versions' });
  const row = older.getByRole('row', { name: new RegExp(TOKEN_NAME) });
  await expect(row.getByRole('cell', { name: String(schemaVersion), exact: true })).toBeVisible();
  await expect(row.getByText('Fields empty')).toBeVisible();
  await captureScreen(page, 'lenses-03-consumers', BOTH);
});

test('API tokens shows the schema version a token sends', async () => {
  await page.goto(`${ADMIN_URL}settings/api-tokens`);
  const row = page.getByRole('row', { name: new RegExp(TOKEN_NAME) });
  await expect(row.getByText(`Sends schema version ${schemaVersion}`)).toBeVisible();
  await captureScreen(page, 'lenses-04-api-tokens', BOTH);
});

test('the API explorer reads as a client built against an older schema version', async () => {
  await page.goto(`${ADMIN_URL}api-explorer`);
  await expect(page.getByRole('heading', { level: 1, name: 'API explorer' })).toBeVisible();
  const endpoints = page.getByRole('navigation', { name: 'Delivery endpoints' });
  await endpoints.getByRole('link', { name: `GET /${ROUTE_KEY}`, exact: true }).click();
  await page.getByRole('textbox', { name: 'API token' }).fill(token);
  const control = page.getByRole('textbox', { name: 'Schema version' });
  await expect(control).toHaveAttribute('placeholder', /\(current\)$/);
  await control.fill(String(schemaVersion));
  await expect(page.getByRole('region', { name: 'curl' })).toContainText(
    `schemaVersion=${encodeURIComponent(schemaVersionToken)}`,
  );
  const sent = page.waitForRequest((request) => request.url().includes(`/api/content/${ROUTE_KEY}?`));
  await page.getByRole('button', { name: 'Send' }).click();
  expect((await sent).url()).toContain(`schemaVersion=${encodeURIComponent(schemaVersionToken)}`);
  const responsePanel = page.getByRole('region', { name: 'Response' });
  await expect(responsePanel.getByText(/^200 /)).toBeVisible();
  // The old client's name for the field renamed since.
  await expect(responsePanel).toContainText('"title": "Hello lenses"');
  await captureScreen(page, 'lenses-05-api-explorer', BOTH);
});
