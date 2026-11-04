import { expect, request, test, type Locator, type Page } from '@playwright/test';
import { startFakeLlm, type FakeLlm } from '../../api/test/fixtures/fakeLlm';
import type { AdminApi } from './content/api';
import type { ProjectServer } from './content/projectServer';
import { ASSIST_ANSWERS, assistResponder, suggestionFor } from './support/assistResponder';
import { captureScreen } from './support/capture';
import { E2E_BASE_PATH } from './support/constants';
import { openKeyboardSuite } from './support/keyboardSuite';

/**
 * Assist fills empty fields across entries (plan write-and-fill, Fill), on its own server with assist on and
 * the loopback fake model: from the Inbox's "Required fields left empty" and from a content type's "Fill
 * in…". Proposals are reviewed per entry; Accept saves the draft and adds a published entry to the run's
 * change set, a never-published one stays a draft, Reject leaves the field empty, and nothing goes live:
 * the delivery API still serves what was published.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const EDITED = 'A short tip about harbour walks';

let llm: FakeLlm;
let server: ProjectServer;
let page: Page;
let api: AdminApi;
const pageErrors: string[] = [];
const entries: Record<'published' | 'draft' | 'rejected', string> = {
  published: '',
  draft: '',
  rejected: '',
};

type ModelBody = {
  definition: { id: string; fields: { apiKey: string; required?: boolean }[] };
  version: number;
};
type EntryBody = { id: string; status: string; data: Record<string, unknown> };

const modelOf = async () => {
  const models = await api.get<{ items: ModelBody[] }>('/models');
  const tip = models.items.find((item) => (item.definition as { apiKey?: string }).apiKey === 'tip');
  if (!tip) {
    throw new Error('no tip model');
  }
  return api.get<ModelBody>(`/models/${tip.definition.id}`);
};

/** A PATCH through the admin API (the fixture helper sends POST, PUT and DELETE only). */
const patch = async (path: string, data: unknown) => {
  const csrf = (
    (await (await page.request.get(`${server.adminApi}/auth/csrf`)).json()) as { csrfToken: string }
  ).csrfToken;
  const response = await page.request.fetch(`${server.adminApi}${path}`, {
    method: 'PATCH',
    headers: { 'x-csrf-token': csrf },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
};

test.beforeAll(async ({ browser }) => {
  llm = await startFakeLlm(assistResponder);
  ({ server, page, api } = await openKeyboardSuite(browser, 'assistFill', pageErrors, {
    AI_PROVIDER: 'openai-compatible',
    AI_MODEL: ASSIST_ANSWERS.model,
    AI_BASE_URL: llm.baseUrl,
    AI_RATE_LIMIT_MAX: '1000',
  }));
  await api.createDefinition('models', {
    kind: 'collection',
    apiKey: 'tip',
    label: 'Tip',
    fields: [
      { apiKey: 'title', label: 'Title', type: 'string' },
      { apiKey: 'summary', label: 'Summary', type: 'text' },
      {
        apiKey: 'category',
        label: 'Category',
        type: 'enum',
        settings: {
          values: [
            { value: 'news', label: 'News' },
            { value: 'guide', label: 'Guide' },
          ],
        },
      },
    ],
  });
  const create = async (title: string) =>
    (await api.send<{ id: string }>('POST', '/content/tip', { data: { title } })).id;
  entries.published = await create('Harbour walk');
  entries.draft = await create('Lighthouse visit');
  entries.rejected = await create('Ferry times');
  await api.send('POST', `/content/tip/${entries.published}/publish`, {});

  // Summary made required while every entry lacks it: the change goes live and the Inbox lists them.
  const tip = await modelOf();
  await api.send('PUT', `/models/${tip.definition.id}`, {
    definition: {
      ...tip.definition,
      fields: tip.definition.fields.map((field) =>
        field.apiKey === 'summary' ? { ...field, required: true } : field,
      ),
    },
    expectedVersion: tip.version,
  });
  await expect
    .poll(
      async () => (await modelOf()).definition.fields.find((field) => field.apiKey === 'summary')?.required,
    )
    .toBe(true);

  // Delivery open to anonymous callers, to check that nothing filled goes live.
  const roles = await api.get<{ id: string; name: string; version: number }[]>('/app-roles');
  const publicRole = roles.find((role) => role.name === 'Public');
  expect(publicRole).toBeDefined();
  await patch(`/app-roles/${publicRole?.id ?? ''}`, {
    expectedVersion: publicRole?.version,
    permissions: [{ action: 'read', modelId: null, condition: null, fieldIds: null }],
  });
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page?.context().close();
  await server?.stop();
  await llm?.close();
});

const entry = (id: string) => api.get<EntryBody>(`/content/tip/${id}`);
/** What anonymous delivery serves (a fresh context: no admin session). */
const delivered = async () => {
  const anonymous = await request.newContext();
  try {
    const response = await anonymous.get(`${server.origin}${E2E_BASE_PATH}/api/content/tips`);
    expect(response.ok(), await response.text()).toBe(true);
    return await response.text();
  } finally {
    await anonymous.dispose();
  }
};

/** One entry's group in the review sheet (its title is the link at its top). */
const groupOf = (sheet: Locator, title: string) =>
  sheet
    .getByRole('list', { name: 'Proposed values' })
    .locator(':scope > li')
    .filter({ has: page.getByRole('link', { name: title }) });

test('Inbox: required fields left empty get proposed values; Accept saves drafts into one change set', async () => {
  await page.goto(server.adminUrl);
  const group = page.getByRole('region', { name: 'Required fields left empty' });
  await expect(async () => {
    await page.reload();
    await expect(group).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 3_000] });
  await group.getByRole('button', { name: 'Propose fixes' }).click();
  await group.getByRole('button', { name: 'Review 3 proposals' }).click({ timeout: 60_000 });
  const sheet = page.getByRole('dialog', { name: 'Proposed values' });
  expect(llm.calls.at(-1)?.system).toMatch(/^You suggest a value for a field/);

  // The published entry: edited, then accepted into the change set.
  const published = groupOf(sheet, 'Harbour walk');
  const summary = published.getByRole('textbox', { name: 'Summary' });
  await expect(summary).toHaveValue(suggestionFor('Summary'));
  await summary.fill(EDITED);
  await captureScreen(page, 'assist-fill-01-review', { viewports: ['desktop', 'phone'] });
  await published.getByRole('button', { name: 'Accept values for Harbour walk' }).click();
  await expect(published.getByText('In change set')).toBeVisible();

  // Never published: saved as a draft, left out of the set (shipping it would publish the whole entry).
  const draft = groupOf(sheet, 'Lighthouse visit');
  await draft.getByRole('button', { name: 'Accept values for Lighthouse visit' }).click();
  await expect(draft.getByText('Saved as draft')).toBeVisible();

  // Rejected: nothing to accept, the field stays empty.
  const rejected = groupOf(sheet, 'Ferry times');
  await rejected.getByRole('button', { name: 'Reject Summary' }).click();
  await expect(rejected.getByText('Rejected')).toBeVisible();
  await expect(rejected.getByRole('button', { name: 'Accept values for Ferry times' })).toBeDisabled();
  await captureScreen(page, 'assist-fill-02-outcomes', { viewports: ['desktop'] });

  expect((await entry(entries.published)).data.summary).toBe(EDITED);
  expect((await entry(entries.draft)).data.summary).toBe(suggestionFor('Summary'));
  expect((await entry(entries.rejected)).data.summary ?? null).toBeNull();
  // Nothing went live: delivery still serves the published version, without the filled summary.
  const live = await delivered();
  expect(live).toContain('Harbour walk');
  expect(live).not.toContain(EDITED);

  await sheet.getByRole('link', { name: 'Open change set' }).click();
  await expect(page).toHaveURL(/\/changes\/[0-9a-f-]+/);
  const changeSetId = /\/changes\/([0-9a-f-]+)/.exec(page.url())?.[1] ?? '';
  const set = await api.get<{ items: { entryId?: string }[] }>(`/change-sets/${changeSetId}`);
  const inSet = set.items.map((item) => item.entryId);
  expect(inSet).toContain(entries.published);
  expect(inSet).not.toContain(entries.draft);
});

test('a content type\'s "Fill in…" proposes values for an optional field', async () => {
  await page.goto(`${server.adminUrl}content/tip`);
  await page.getByRole('button', { name: 'Fill in…' }).click();
  const popover = page.getByRole('dialog', { name: 'Fill in a field' });
  await popover.getByRole('combobox', { name: 'Field' }).click();
  await page.getByRole('option', { name: 'Category' }).click();
  await captureScreen(page, 'assist-fill-03-fill-in', { viewports: ['desktop'] });
  await popover.getByRole('button', { name: 'Propose values' }).click();
  // "Ferry times" still lacks its required summary, which this run can't fill: it is left as it is.
  await page.getByRole('button', { name: 'Review 2 proposals' }).click({ timeout: 60_000 });
  const sheet = page.getByRole('dialog', { name: 'Proposed values' });
  await expect(sheet.getByText('1 left as it is')).toBeVisible();
  const draft = groupOf(sheet, 'Lighthouse visit');
  await expect(draft.getByRole('combobox', { name: 'Category' })).toHaveText('News');
  await draft.getByRole('button', { name: 'Accept values for Lighthouse visit' }).click();
  await expect(draft.getByText('Saved as draft')).toBeVisible();
  expect((await entry(entries.draft)).data.category).toBe('news');
  await sheet.getByRole('button', { name: 'Close' }).first().click();
  await expect(sheet).toBeHidden();
});
