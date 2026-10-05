import { expect, test, type Page } from '@playwright/test';
import { SEO_COMPONENT_ID } from '@shapio/schema';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { entryDocument } from './support/entryDocument';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * SEO fields (plan seo-fields) against the real API, as the owner: per-site defaults in Settings → SEO
 * (template validated inline), "Add field → SEO fields" on a content type (enabling the shared component
 * after an inline confirmation), shipped through the normal review, then the SEO group on an entry with its
 * counter and search-result preview. Every screen is captured in Shapio and Snowed and checked with axe.
 */
test.describe.configure({ mode: 'serial' });

const MODEL_KEY = 'seoArticle';
const MODEL_LABEL = 'SEO article';
const UPDATED = 'Model updated — no restart needed';

let page: Page;
const pageErrors: string[] = [];
let modelId: string | undefined;

const getJson = async <T>(path: string) =>
  (await (await page.request.get(`${ADMIN_API}${path}`)).json()) as T;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  const created = await adminRequest(page.request, 'POST', '/models', {
    definition: {
      kind: 'collection',
      apiKey: MODEL_KEY,
      label: MODEL_LABEL,
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'body', label: 'Body', type: 'richtext' },
      ],
    },
  });
  modelId = ((await created.json()) as { definitionId: string }).definitionId;
  await expect
    .poll(async () => (await page.request.get(`${ADMIN_API}/models/${modelId}`)).status())
    .toBe(200);
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  // Later specs expect an empty model list and no shared components.
  if (modelId) {
    const { version } = await getJson<{ version: number }>(`/models/${modelId}`);
    await adminRequest(page.request, 'DELETE', `/models/${modelId}?expectedVersion=${version}`);
  }
  const component = await page.request.get(`${ADMIN_API}/components/${SEO_COMPONENT_ID}`);
  if (component.ok()) {
    const { version } = (await component.json()) as { version: number };
    await adminRequest(page.request, 'DELETE', `/components/${SEO_COMPONENT_ID}?expectedVersion=${version}`);
  }
  await page.context().close();
});

test('Settings → SEO: per-locale texts, a validated template and a Twitter handle', async () => {
  await page.goto(`${ADMIN_URL}settings/seo`);
  await expect(page.getByRole('heading', { level: 1, name: 'SEO' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'SEO' }),
  ).toBeVisible();

  await page.getByRole('textbox', { name: 'Site name' }).fill('Acme');
  const template = page.getByRole('textbox', { name: 'Title template' });
  await template.fill('Acme');
  await page.getByRole('textbox', { name: 'Twitter handle' }).fill('@acme');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Use %s exactly once where the page title goes')).toBeVisible();
  await expect(template).toHaveAttribute('aria-invalid', 'true');
  await captureScreen(page, 'seo-01-settings-invalid', { viewports: ['desktop', 'phone'] });

  await template.fill('%s · Acme');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('SEO settings saved.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();

  const saved = await getJson<{ seo: { locales: Record<string, unknown>; twitterHandle: string } }>(
    '/site/seo',
  );
  expect(saved.seo.locales.en).toEqual({ siteName: 'Acme', titleTemplate: '%s · Acme' });
  expect(saved.seo.twitterHandle).toBe('@acme');
});

test('Add field → SEO fields enables the shared component and ships through the review', async () => {
  await page.goto(`${ADMIN_URL}models/${modelId}`);
  await expect(page.getByRole('heading', { level: 1, name: MODEL_LABEL })).toBeVisible();

  const menuButton = page.getByRole('button', { name: 'More ways to add' });
  await menuButton.click();
  await expect(page.getByRole('menuitem', { name: 'Field', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'SEO fields' }).click();

  const confirm = page.getByRole('alertdialog', { name: 'Enable SEO for every site?' });
  await expect(confirm).toBeVisible();
  await captureScreen(page, 'seo-02-enable-confirm', { viewports: ['desktop'] });
  await confirm.getByRole('button', { name: 'Enable SEO' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText('SEO fields added. Review to ship them.').first()).toBeVisible();
  const fields = page.getByRole('list', { name: /^\d+ fields?$/ });
  await expect(fields.getByRole('button', { name: /^SEO\b/ })).toBeVisible();

  // Already added: the menu says so instead of adding a second one.
  await menuButton.click();
  await expect(page.getByRole('menuitem', { name: 'SEO fields' })).toBeDisabled();
  await expect(page.getByText('This content type already has SEO fields.')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const plan = page.getByRole('dialog', { name: /^Review changes to / });
  await expect(plan).toBeVisible();
  await plan.getByRole('button', { name: 'Ship now' }).click();
  await expect(plan).toBeHidden();
  await expect(page.getByText(UPDATED).first()).toBeVisible({ timeout: 30_000 });

  const model = await getJson<{
    definition: { fields: { apiKey: string; settings: { component?: string } }[] };
  }>(`/models/${modelId}`);
  expect(model.definition.fields.find((field) => field.apiKey === 'seo')?.settings.component).toBe(
    SEO_COMPONENT_ID,
  );
});

test('the SEO group on an entry: counter and search-result preview', async () => {
  const doc = entryDocument(page);
  await page.goto(`${ADMIN_URL}content/${MODEL_KEY}/new`);
  await page.getByRole('textbox', { name: 'Title' }).first().fill('Spring launch');
  // Empty, the SEO group still has its chip under the title (not only behind "+N more").
  await expect(
    page.getByRole('group', { name: 'Properties' }).getByRole('button', { name: /^SEO/ }),
  ).toBeVisible();
  const seo = await doc.property('seo');
  const preview = seo.getByRole('region', { name: 'Search result preview' });
  // The entry's own title through the site's template until the SEO title is set.
  await expect(preview).toContainText('Spring launch · Acme');

  await seo.getByRole('textbox', { name: 'Description', exact: true }).fill('Everything new this spring.');
  await expect(preview).toContainText('Everything new this spring.');
  const longTitle = 'A spring launch with a title long enough to reach the counter mark';
  await seo.getByRole('textbox', { name: 'Title', exact: true }).fill(longTitle);
  await expect(seo.getByText(`${longTitle.length} of 70 characters`)).toBeVisible();
  await expect(preview).toContainText(`${longTitle} · Acme`);
  await captureScreen(page, 'seo-03-entry-group', { viewports: ['desktop'] });

  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/content/${MODEL_KEY}/[0-9a-f-]{36}`));
  const entryId = new RegExp(`/content/${MODEL_KEY}/([0-9a-f-]{36})`).exec(page.url())?.[1] ?? '';
  const entry = await getJson<{ data: { seo: { title: string; description: string } } }>(
    `/content/${MODEL_KEY}/${entryId}`,
  );
  expect(entry.data.seo).toMatchObject({ title: longTitle, description: 'Everything new this spring.' });
});
