import { expect, test, type Page } from '@playwright/test';
import { captureRendered, captureScreen, VIEWPORTS } from './support/capture';
import { ADMIN_URL, E2E_BASE_PATH } from './support/constants';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';
import { siteApi } from './support/sites';

/**
 * The GraphQL playground in the admin: Develop → GraphQL frames the vendored GraphiQL on the shell's site in
 * the admin's light or dark look, and the API explorer's GraphQL tab turns the REST request into the same
 * query and opens it there. The page is captured at 1440 and 390 in Snowed and Shapio with axe (GraphiQL's
 * own markup, inside the frame, is third-party and left out).
 */
test.describe.configure({ mode: 'serial' });

const MODEL_KEY = 'graphqlNote';
const ROUTE_KEY = 'graphqlNotes';
const SITE = { key: 'graphqlsite', name: 'GraphQL site' };
const PLAYGROUND_PATH = `${E2E_BASE_PATH}/api/graphql/playground`;
const FRAME = 'iframe[title="GraphiQL playground"]';
/** The looks screens are captured in (support/schemes.ts): GraphiQL follows the saved look, so it is saved. */
const LOOKS = [
  { scheme: 'light', theme: 'snowed' },
  { scheme: 'dark', theme: 'shapio' },
] as const;

let page: Page;
let modelId = '';
let siteId = '';
const pageErrors: string[] = [];

const playground = (on: Page = page) => on.frameLocator(FRAME);

const expectGraphiql = async (on: Page = page) => {
  await expect(playground(on).locator('.graphiql-container')).toBeVisible({ timeout: 20_000 });
};

/** Saves a look the way the theme store does and reloads (the pre-paint script and the frame's URL follow it). */
const saveLook = async (theme: string, scheme: 'light' | 'dark') => {
  await page.evaluate((stored) => window.localStorage.setItem('shapio.theme', JSON.stringify(stored)), {
    state: { theme, appearance: scheme, variants: [scheme] },
    version: 3,
  });
  await page.reload();
};

/** The page with GraphiQL in each look and at each size, with axe on everything outside the frame. */
const captureWithPlayground = async (name: string) => {
  for (const viewport of ['desktop', 'phone'] as const) {
    await page.setViewportSize(VIEWPORTS[viewport]);
    for (const { scheme, theme } of LOOKS) {
      await saveLook(theme, scheme);
      await expectGraphiql();
      await expect(playground().locator('body')).toHaveClass(new RegExp(`graphiql-${scheme}`));
      await page.mouse.move(0, 0);
      await captureRendered(page, `${name}-${viewport}-${scheme}`, { exclude: [FRAME] });
    }
  }
  await page.evaluate(() => window.localStorage.removeItem('shapio.theme'));
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.reload();
};

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  const created = (await (
    await adminRequest(page.request, 'POST', '/models', {
      definition: {
        kind: 'collection',
        apiKey: MODEL_KEY,
        pluralApiKey: ROUTE_KEY,
        label: 'GraphQL note',
        fields: [
          { apiKey: 'title', label: 'Title', type: 'string', required: true, filterable: true },
          { apiKey: 'summary', label: 'Summary', type: 'text', description: 'Shown in lists' },
        ],
      },
    })
  ).json()) as { definitionId: string };
  modelId = created.definitionId;
  const entry = (await (
    await adminRequest(page.request, 'POST', `/content/${MODEL_KEY}`, {
      data: { title: 'Hello GraphQL explorer', summary: 'Read through GraphQL' },
    })
  ).json()) as { id: string };
  await adminRequest(page.request, 'POST', `/content/${MODEL_KEY}/${entry.id}/publish`, {});
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  // Later specs expect one site and no models.
  if (siteId) {
    await siteApi(page.request).send('DELETE', `/sites/${siteId}`);
  }
  if (modelId) {
    const { version } = (await (await page.request.get(`${ADMIN_API}/models/${modelId}`)).json()) as {
      version: number;
    };
    await adminRequest(page.request, 'DELETE', `/models/${modelId}?expectedVersion=${version}`);
  }
  await page.context().close();
});

test('Develop → GraphQL frames GraphiQL on the current site in the admin’s look', async () => {
  await page.goto(ADMIN_URL);
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await navigation.getByRole('link', { name: 'GraphQL', exact: true }).click();
  await expect(page).toHaveURL(/\/develop\/graphql$/);
  await expect(page.getByRole('heading', { level: 1, name: 'GraphQL' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'More about GraphQL' })).toBeVisible();
  // The primary site needs no ?site=; the default look (Shapio) is dark.
  await expect(page.locator(FRAME)).toHaveAttribute('src', new RegExp(`${PLAYGROUND_PATH}\\?theme=dark$`));
  await expectGraphiql();
  await captureWithPlayground('graphql-01-playground');
});

test('the explorer’s GraphQL tab shows the REST request as a query and opens it in the playground', async () => {
  await page.goto(`${ADMIN_URL}api-explorer`);
  const endpoints = page.getByRole('navigation', { name: 'Delivery endpoints' });
  await endpoints.getByRole('link', { name: `GET /${ROUTE_KEY}`, exact: true }).click();
  await page.getByRole('button', { name: 'Add filter' }).click();
  await page.getByLabel('Filter 1 key').fill('title[$contains]');
  await page.getByLabel('Filter 1 value').fill('explorer');

  // Switching tabs keeps the endpoint: the list's GraphQL query, with the same filter.
  await page.getByRole('tab', { name: 'GraphQL' }).click();
  await expect(page).toHaveURL(new RegExp(`op=graphql%3A${ROUTE_KEY}`));
  const query = page.getByRole('region', { name: 'Query' });
  await expect(query).toContainText(`${ROUTE_KEY}(filter: { title: { contains: "explorer" } }) {`);
  await expect(page.getByText("The same request as the REST tab's for this endpoint.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
  await captureScreen(page, 'graphql-02-explorer-tab', { viewports: ['desktop', 'phone'] });

  await page.getByRole('link', { name: 'Open in playground' }).click();
  await expect(page).toHaveURL(/\/develop\/graphql\?query=/);
  await expect(page.locator(FRAME)).toHaveAttribute('src', /[?&]query=query/);
  await expectGraphiql();
  const editor = playground().locator('.graphiql-query-editor');
  await expect(editor).toContainText(`${ROUTE_KEY}(filter: { title: { contains: "explorer" } })`);
  // Run it with the admin session (the bootstrap's CSRF token): the published entry comes back.
  await playground().locator('.graphiql-execute-button').click();
  await expect(playground().locator('.graphiql-response')).toContainText('Hello GraphQL explorer', {
    timeout: 20_000,
  });
});

test('on another site the frame names that site', async () => {
  const created = await siteApi(page.request).send<{ id: string }>('POST', '/sites', SITE);
  siteId = created.id;
  await page.goto(`${ADMIN_URL}s/${SITE.key}/develop/graphql`);
  await expect(page.getByRole('heading', { level: 1, name: 'GraphQL' })).toBeVisible();
  await expect(page.locator(FRAME)).toHaveAttribute(
    'src',
    new RegExp(`${PLAYGROUND_PATH}\\?site=${SITE.key}&theme=dark$`),
  );
  await expectGraphiql();
});
