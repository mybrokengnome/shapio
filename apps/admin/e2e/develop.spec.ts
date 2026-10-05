import { expect, test, type Locator, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * The developer pages of package D3 against the real API: Schema as code (the files `shapio schema pull`
 * writes, edited with the server's validation, previewed, applied as change-set drafts behind the
 * three-way guard) and the API explorer (delivery endpoints from the live OpenAPI document, a request sent
 * as a site would send it); the GraphQL page and the explorer's GraphQL tab are in graphql.spec.ts. Every
 * screen is captured at 1440 and 390 in light and dark with axe.
 */
test.describe.configure({ mode: 'serial' });

const MODEL_KEY = 'schemaNote';
const ROUTE_KEY = 'schemaNotes';
const ARTICLE_FILE = `schema/models/${MODEL_KEY}.json`;

let page: Page;
let modelId = '';
let tokenId = '';
let token = '';
const pageErrors: string[] = [];

type Detail = {
  definition: Record<string, unknown> & { fields: Array<Record<string, unknown>> };
  version: number;
};

const readModel = async () =>
  (await (await page.request.get(`${ADMIN_API}/models/${modelId}`)).json()) as Detail;

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
        label: 'Schema note',
        fields: [
          { apiKey: 'title', label: 'Title', type: 'string', required: true, filterable: true },
          { apiKey: 'summary', label: 'Summary', type: 'text' },
        ],
      },
    })
  ).json()) as { definitionId: string };
  modelId = created.definitionId;
  const entry = (await (
    await adminRequest(page.request, 'POST', `/content/${MODEL_KEY}`, {
      data: { title: 'Hello explorer', summary: 'Read through the delivery API' },
    })
  ).json()) as { id: string };
  await adminRequest(page.request, 'POST', `/content/${MODEL_KEY}/${entry.id}/publish`, {});
  const roles = (await (await page.request.get(`${ADMIN_API}/roles`)).json()) as Array<{
    id: string;
    key: string;
  }>;
  const readOnly = roles.find((role) => role.key === 'read-only');
  const issued = (await (
    await adminRequest(page.request, 'POST', '/tokens', { name: 'Explorer e2e', roleId: readOnly?.id })
  ).json()) as { token: string; apiToken: { id: string } };
  token = issued.token;
  tokenId = issued.apiToken.id;
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  // Later specs expect no models and no tokens.
  if (tokenId) {
    await adminRequest(page.request, 'DELETE', `/tokens/${tokenId}`);
  }
  if (modelId) {
    const { version } = await readModel();
    await adminRequest(page.request, 'DELETE', `/models/${modelId}?expectedVersion=${version}`);
  }
  await page.context().close();
});

const editor = (on: Page = page) => on.getByRole('textbox', { name: `${ARTICLE_FILE} (JSON)` });

/** Replaces the open file's text (inserted as one edit: no auto-closed brackets). */
const replaceText = async (target: Locator, text: string) => {
  await target.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
  // The blinking caret is an endless CSS animation; screenshots wait for animations to finish.
  await target.blur();
};

const openArticleFile = async () => {
  await page.goto(`${ADMIN_URL}schema?file=${encodeURIComponent(ARTICLE_FILE)}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Schema' })).toBeVisible();
  await expect(editor()).toBeVisible();
};

test('schema as code lists the pulled files and previews the open one', async () => {
  await openArticleFile();
  const files = page.getByRole('navigation', { name: 'Schema files' });
  await expect(files.getByRole('link', { name: `${MODEL_KEY}.json` })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(files.getByRole('link', { name: 'schema-lock.json' })).toBeVisible();
  await expect(editor()).toContainText(`"apiKey": "${MODEL_KEY}"`);
  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview.getByLabel('Title')).toBeVisible();
  await captureScreen(page, 'develop-01-schema', { viewports: ['desktop', 'phone'] });

  await preview.getByRole('tab', { name: 'REST' }).click();
  await expect(preview.getByText(`/api/content/${ROUTE_KEY}/{id}`, { exact: true })).toBeVisible();
  await preview.getByRole('tab', { name: 'GraphQL' }).click();
  await expect(preview.getByText(/type SchemaNote \{/)).toBeVisible();
  await preview.getByRole('tab', { name: 'Types' }).click();
  await expect(preview.getByText(/export type SchemaNote = /)).toBeVisible();
  await captureScreen(page, 'develop-02-schema-types', { viewports: ['desktop'] });

  await files.getByRole('link', { name: 'schema-lock.json' }).click();
  await expect(page.getByRole('textbox', { name: '.shapio/schema-lock.json (JSON)' })).toContainText(modelId);
});

test('the editor checks a file with the server’s validators and plans the change', async () => {
  await openArticleFile();
  const { definition } = await readModel();
  const broken = {
    ...definition,
    fields: definition.fields.map((field, index) => (index === 0 ? { ...field, apiKey: '1title' } : field)),
  };
  await replaceText(editor(), JSON.stringify(broken, null, 2));
  const problems = page.getByRole('status').filter({ hasText: /^1 problem/ });
  await expect(problems).toBeVisible();
  await expect(problems.getByText('/fields/0/apiKey')).toBeVisible();
  await expect(page.locator('.cm-lintRange-error').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply 1 file' })).toBeEnabled();
  await captureScreen(page, 'develop-03-schema-problems', { viewports: ['desktop', 'phone'] });

  // Applying a broken file is refused before anything is sent.
  await page.getByRole('button', { name: 'Apply 1 file' }).click();
  await expect(page.getByText(`Fix the problems in ${ARTICLE_FILE} before applying.`)).toBeVisible();

  await replaceText(editor(), JSON.stringify({ ...definition, label: 'Schema memo' }, null, 2));
  await expect(problems).toBeHidden();
  const preview = page.getByRole('region', { name: 'Preview' });
  await preview.getByRole('tab', { name: 'Plan' }).click();
  await expect(preview.getByText(/^Change the label/i)).toBeVisible();
  await captureScreen(page, 'develop-04-schema-plan', { viewports: ['desktop'] });

  // Revert brings the pulled bytes back and clears the modified state.
  await page.getByRole('button', { name: 'Revert' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revert' }).click();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
});

test('apply refuses like a rejected push when the instance moved, then writes change-set drafts', async () => {
  await openArticleFile();
  const loaded = await readModel();
  await replaceText(editor(), JSON.stringify({ ...loaded.definition, label: 'Schema memo' }, null, 2));
  // Someone else changes the same model meanwhile.
  await adminRequest(page.request, 'PUT', `/models/${modelId}`, {
    definition: { ...loaded.definition, description: 'Changed elsewhere' },
    expectedVersion: loaded.version,
  });
  await page.getByRole('button', { name: 'Apply 1 file' }).click();
  await expect(page.getByText('Not applied: 1 file changed on the instance too')).toBeVisible();
  const conflict = page.getByRole('region', { name: `Conflict in ${ARTICLE_FILE}` });
  await expect(conflict.getByText('Changed here and on the instance since you loaded it.')).toBeVisible();
  await captureScreen(page, 'develop-05-schema-conflict', { viewports: ['desktop', 'phone'] });
  // Nothing was written: the model still has the other session's version only.
  expect((await readModel()).definition.label).toBe('Schema note');

  await conflict.getByRole('button', { name: 'Keep my version' }).click();
  await expect(conflict).toBeHidden();
  const drafted = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' && /\/change-sets\/[^/]+\/schema\//.test(response.url()),
  );
  await page.getByRole('button', { name: 'Apply 1 file' }).click();
  const response = await drafted;
  expect(response.status(), await response.text()).toBe(200);
  const body = response.request().postDataJSON() as { baseVersion: number; definition: { label: string } };
  expect(body.baseVersion).toBe(loaded.version + 1);
  expect(body.definition.label).toBe('Schema memo');
  await expect(page).toHaveURL(/\/changes\/[0-9a-f-]{36}/);
  // Still a draft: the active model is unchanged until the set ships.
  expect((await readModel()).definition.label).toBe('Schema note');
});

test('the API explorer sends a delivery request as a site would', async () => {
  await page.goto(`${ADMIN_URL}api-explorer`);
  await expect(page.getByRole('heading', { level: 1, name: 'API explorer' })).toBeVisible();
  const endpoints = page.getByRole('navigation', { name: 'Delivery endpoints' });
  await endpoints.getByRole('link', { name: `GET /${ROUTE_KEY}`, exact: true }).click();
  await expect(page).toHaveURL(/op=listSchemaNote/);

  // Anonymous: the public app role grants nothing by default.
  await page.getByRole('button', { name: 'Send' }).click();
  const responsePanel = page.getByRole('region', { name: 'Response' });
  await expect(responsePanel.getByText(/^40[13] /)).toBeVisible();

  await page.getByRole('textbox', { name: 'API token' }).fill(token);
  await page.getByRole('button', { name: 'Add filter' }).click();
  await page.getByLabel('Filter 1 key').fill('title[$contains]');
  await page.getByLabel('Filter 1 value').fill('explorer');
  const sent = page.waitForRequest((request) => request.url().includes(`/api/content/${ROUTE_KEY}?`));
  await page.getByRole('button', { name: 'Send' }).click();
  const request = await sent;
  expect(request.url()).toContain('filters%5Btitle%5D%5B%24contains%5D=explorer');
  expect(request.url()).not.toContain(token);
  expect(request.headers().authorization).toBe(`Bearer ${token}`);
  await expect(responsePanel.getByText(/^200 /)).toBeVisible();
  await expect(responsePanel.getByRole('link', { name: 'Edit Hello explorer' })).toBeVisible();
  // The snippets never contain the token itself.
  await expect(page.getByRole('region', { name: 'curl' })).toContainText('$SHAPIO_TOKEN');
  await expect(page.getByRole('region', { name: 'curl' })).not.toContainText(token);
  await expect(page.getByRole('region', { name: 'Shape' }).getByText('title', { exact: true })).toBeVisible();
  await captureScreen(page, 'develop-06-api-explorer', { viewports: ['desktop', 'phone'] });

  await responsePanel.getByRole('link', { name: 'Edit Hello explorer' }).click();
  await expect(page).toHaveURL(new RegExp(`/content/${MODEL_KEY}/[0-9a-f-]{36}`));
});
