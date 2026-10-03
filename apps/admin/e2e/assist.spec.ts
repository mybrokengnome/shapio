import { expect, test, type Page } from '@playwright/test';
import { startFakeLlm, type FakeLlm } from '../../api/test/fixtures/fakeLlm';
import type { AdminApi } from './content/api';
import type { ProjectServer } from './content/projectServer';
import { ASSIST_ANSWERS, FAIL_TRIGGER, assistResponder } from './support/assistResponder';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { entryDocument } from './support/entryDocument';
import { openKeyboardSuite } from './support/keyboardSuite';
import { signInAsOwner } from './support/session';

/**
 * Editor assists (agentic plan §A2) on their own server, with assist on and a loopback fake model (the
 * responses are fixed, see support/assistResponder.ts): every assist lands as something the person reviews
 * (a proposal in a popover, a filled field, a locale draft with a banner, schema drafts in a change set, an
 * accept/reject list), and nothing publishes. With assist off every control is gone, and Settings → Assist
 * says so. Captured in both themes with axe.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const BODY_TEXT = 'The harbour lights came on one by one as the fog rolled in from the sea.';
const TITLE = 'Harbour at night';

let llm: FakeLlm;
let server: ProjectServer;
let page: Page;
let api: AdminApi;
let entryId = '';
const pageErrors: string[] = [];

const richText = (text: string) => ({
  format: 'shapio-richtext',
  version: 1,
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
});

test.beforeAll(async ({ browser }) => {
  llm = await startFakeLlm(assistResponder);
  ({ server, page, api } = await openKeyboardSuite(browser, 'assist', pageErrors, {
    AI_PROVIDER: 'openai-compatible',
    AI_MODEL: ASSIST_ANSWERS.model,
    AI_BASE_URL: llm.baseUrl,
    AI_RATE_LIMIT_MAX: '1000',
  }));
  await api.createLocale('fr', 'French');
  await api.createDefinition('models', {
    kind: 'collection',
    apiKey: 'story',
    label: 'Story',
    localized: true,
    fields: [
      { apiKey: 'title', label: 'Title', type: 'string', localized: true },
      { apiKey: 'excerpt', label: 'Excerpt', type: 'text', localized: true, required: true },
      { apiKey: 'cover', label: 'Cover', type: 'media', settings: { allowedKinds: ['image'] } },
      { apiKey: 'body', label: 'Body', type: 'richtext', localized: true },
    ],
  });
  const cover = await api.uploadPng('harbour.png', 64, 48);
  const story = await api.send<{ id: string }>('POST', '/content/story', {
    locale: 'en',
    data: { title: TITLE, excerpt: 'Draft excerpt', cover: cover.id, body: richText(BODY_TEXT) },
  });
  entryId = story.id;
  // A file in the library only, for the media details' suggestion.
  await api.uploadPng('meadow.png', 64, 48);
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page?.context().close();
  await server?.stop();
  await llm?.close();
});

const storyUrl = (locale = 'en') => `${server.adminUrl}content/story/${entryId}?locale=${locale}`;
const doc = () => entryDocument(page);
const body = () => page.locator('[data-field-path="/body"] .ProseMirror');

test('with assist off, no assist control is shown anywhere', async ({ browser }) => {
  // This server has assist on; the admin's answer is replaced to see every screen as an instance without it.
  await page.route('**/api/admin/assist/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false}' }),
  );
  try {
    await page.goto(storyUrl());
    await body().getByText(BODY_TEXT).click({ clickCount: 3 });
    await expect(page.getByRole('toolbar', { name: 'Text formatting' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rewrite…' })).toHaveCount(0);
    await page.locator('[data-property="excerpt"]').click();
    await expect(page.getByLabel('Excerpt')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Summarize from body', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    const drawer = await doc().openSettings();
    await expect(drawer.getByRole('button', { name: 'Start French' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: /^Translate/ })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: 'Suggest alt text' })).toHaveCount(0);

    await page.goto(`${server.adminUrl}content/new`);
    await expect(page.getByRole('heading', { level: 1, name: 'New content type' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Describe it' })).toHaveCount(0);

    await page.goto(`${server.adminUrl}media`);
    await page.getByRole('button', { name: 'Open meadow.png' }).click();
    await expect(page.getByRole('dialog', { name: 'meadow.png' }).getByLabel('Alt text')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Suggest alt text' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.goto(server.adminUrl);
    await expect(page.getByRole('region', { name: 'Images without alt text' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Propose fixes' })).toHaveCount(0);

    await page.goto(`${server.adminUrl}settings/assist`);
    await expect(page.getByText('Off', { exact: true })).toBeVisible();
  } finally {
    await page.unroute('**/api/admin/assist/status');
  }

  // An instance started without AI_PROVIDER (the shared e2e server) says so on Settings → Assist.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const shared = await context.newPage();
  await signInAsOwner(shared);
  await shared.goto(`${ADMIN_URL}settings/assist`);
  await expect(shared.getByRole('heading', { level: 1, name: 'Assist' })).toBeVisible();
  await expect(shared.getByText('Off', { exact: true })).toBeVisible();
  await expect(shared.getByRole('link', { name: /How to set up assist/ })).toBeVisible();
  await expect(shared.getByRole('region', { name: 'Try it' })).toHaveCount(0);
  await captureScreen(shared, 'assist-01-settings-off', { viewports: ['desktop'] });
  await context.close();
});

test('rewrite the selection from the bubble toolbar: a proposal to edit, then Replace', async () => {
  await page.goto(storyUrl());
  await body().getByText(BODY_TEXT).click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Rewrite…' }).click();
  const popover = page.getByRole('dialog', { name: 'Rewrite the selection' });
  await expect(popover.getByRole('textbox', { name: 'Instruction' })).toBeFocused();

  // The provider fails: the reason shows in place, and the selection is untouched.
  await popover.getByRole('textbox', { name: 'Instruction' }).fill(`Make it moodier ${FAIL_TRIGGER}`);
  await popover.getByRole('button', { name: 'Rewrite', exact: true }).click();
  await expect(popover.getByRole('alert')).toContainText('The model provider returned an error');

  await popover.getByRole('textbox', { name: 'Instruction' }).fill('Make it moodier');
  await popover.getByRole('button', { name: 'Rewrite', exact: true }).click();
  const proposal = popover.getByRole('textbox', { name: `Proposed by ${ASSIST_ANSWERS.model}` });
  await expect(proposal).toHaveValue(ASSIST_ANSWERS.rewrite);
  await captureScreen(page, 'assist-02-rewrite', { viewports: ['desktop'] });
  await popover.getByRole('button', { name: 'Replace selection' }).click();
  await expect(popover).toBeHidden();
  await expect(body()).toContainText(ASSIST_ANSWERS.rewrite);
  await expect(body()).not.toContainText(BODY_TEXT);
  expect(llm.calls.at(-1)?.system).toContain('Make it moodier');
  // Autosave keeps the edit as a draft.
  await expect
    .poll(async () =>
      JSON.stringify((await api.get<{ data: unknown }>(`/content/story/${entryId}?locale=en`)).data),
    )
    .toContain(ASSIST_ANSWERS.rewrite);
});

test('summarize from body fills the property, saving the document first', async () => {
  await page.goto(storyUrl());
  await page.locator('[data-property="excerpt"]').click();
  await page.getByRole('button', { name: 'Summarize from body', exact: true }).click();
  await expect(page.getByLabel('Excerpt')).toHaveValue(ASSIST_ANSWERS.summary);
  // The summary was made from the saved body, which is the rewritten one.
  expect(llm.calls.at(-1)?.firstUserText).toContain(ASSIST_ANSWERS.rewrite);
  await captureScreen(page, 'assist-03-summarize', { viewports: ['desktop'] });
  await page.keyboard.press('Escape');
});

test('translate creates the French draft and opens it with the proposal banner', async () => {
  await page.goto(storyUrl());
  const drawer = await doc().openSettings();
  await drawer.getByRole('button', { name: 'Translate French from English' }).click();
  await expect(page).toHaveURL(/locale=fr/);
  const banner = page.getByRole('status').filter({ hasText: `Proposed by ${ASSIST_ANSWERS.model}` });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Translated from English as a draft. Review it before publishing.');
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
    `${ASSIST_ANSWERS.translatePrefix}${TITLE}`,
  );
  await captureScreen(page, 'assist-04-translate-banner', { viewports: ['desktop', 'phone'] });
  // The draft is French and unpublished.
  const french = await api.get<{ status: string; data: { title: string } }>(
    `/content/story/${entryId}?locale=fr`,
  );
  expect(french.data.title).toBe(`${ASSIST_ANSWERS.translatePrefix}${TITLE}`);
  expect(french.status).toBe('draft');
  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner).toBeHidden();
});

test('Describe it proposes content types and writes them as drafts into a change set', async () => {
  await page.goto(`${server.adminUrl}content/new`);
  const describe = page.getByRole('region', { name: 'Describe it' });
  await describe
    .getByRole('textbox', { name: 'What will editors write here?' })
    .fill('Recipes with a name, a cooking time and steps');
  await describe.getByRole('button', { name: 'Propose content types' }).click();
  await expect(describe.getByRole('list', { name: 'Proposed content types' })).toContainText('Recipe');
  await expect(describe).toContainText('Cooking time');
  await captureScreen(page, 'assist-05-describe', { viewports: ['desktop'] });
  await describe.getByRole('button', { name: 'Add to change set' }).click();
  await expect(page).toHaveURL(/\/changes\/[0-9a-f-]+/);
  await expect(page.getByText('Recipe').first()).toBeVisible();
  // Nothing shipped: the live schema has no recipe yet.
  const models = await api.get<{ items: { definition: { apiKey: string } }[] }>('/models');
  expect(models.items.map((item) => item.definition.apiKey)).not.toContain('recipe');
});

test('Inbox: propose fixes for missing alt text, then accept from the review list', async () => {
  await page.goto(server.adminUrl);
  const group = page.getByRole('region', { name: 'Images without alt text' });
  await expect(async () => {
    await page.reload();
    await expect(group).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 3_000] });
  await group.getByRole('button', { name: 'Propose fixes' }).click();
  await group.getByRole('button', { name: 'Review 1 proposal' }).click({ timeout: 60_000 });
  const sheet = page.getByRole('dialog', { name: 'Proposed alt text' });
  await expect(sheet.getByRole('textbox', { name: 'Alt text', exact: true })).toHaveValue(ASSIST_ANSWERS.alt);
  await captureScreen(page, 'assist-06-alt-review', { viewports: ['desktop', 'phone'] });
  await sheet.getByRole('button', { name: 'Accept' }).click();
  await expect(sheet.getByText('Accepted')).toBeVisible();
  const assets = await api.get<{ items: { filename: string; alt: string }[] }>(
    '/media/assets?search=harbour',
  );
  expect(assets.items.find((asset) => asset.filename === 'harbour.png')?.alt).toBe(ASSIST_ANSWERS.alt);
  await sheet.getByRole('button', { name: 'Close' }).first().click();
  await expect(sheet).toBeHidden();
});

test('media details: suggest alt text fills the field, the person saves', async () => {
  await page.goto(`${server.adminUrl}media`);
  await page.getByRole('button', { name: 'Open meadow.png' }).click();
  const sheet = page.getByRole('dialog', { name: 'meadow.png' });
  await sheet.getByRole('button', { name: 'Suggest alt text' }).click();
  await expect(sheet.getByRole('textbox', { name: 'Alt text', exact: true })).toHaveValue(ASSIST_ANSWERS.alt);
  await captureScreen(page, 'assist-07-media-alt', { viewports: ['desktop'] });
  await sheet.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Details saved').first()).toBeVisible();
});

test('Settings → Assist: provider, model, this month’s usage and a rewrite to try', async () => {
  await page.goto(`${server.adminUrl}settings/assist`);
  await expect(page.getByRole('heading', { level: 1, name: 'Assist' })).toBeVisible();
  await expect(page.getByText('On', { exact: true })).toBeVisible();
  await expect(page.getByText('openai-compatible')).toBeVisible();
  await expect(page.getByText(ASSIST_ANSWERS.model, { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: /^Usage in / })).toBeVisible();
  const tryIt = page.getByRole('region', { name: 'Try it' });
  await tryIt.getByLabel('Text').fill(BODY_TEXT);
  await tryIt.getByLabel('Instruction').fill('Shorter');
  await tryIt.getByRole('button', { name: 'Rewrite' }).click();
  await expect(tryIt.getByText(ASSIST_ANSWERS.rewrite)).toBeVisible();
  await captureScreen(page, 'assist-08-settings', { viewports: ['desktop', 'phone'] });
});
