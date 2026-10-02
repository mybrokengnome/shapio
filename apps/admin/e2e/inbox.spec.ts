import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { adminApiFor, type AdminApi } from './content/api';
import { OWNER } from './support/accounts';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { openKeyboardSuite } from './support/keyboardSuite';
import { logOffset, waitForEmailedLink } from './support/serverLog';
import { ADMIN_API, signInAsOwner } from './support/session';

/**
 * The Inbox (home for everyone) and the sidebar as each kind of admin sees it: content health findings
 * grouped by rule with a fix that opens the entry at the value, scheduled and recently published entries,
 * the dashboard for admins only, entries in the ⌘K palette, and an editor's sidebar without Develop or
 * Workspace management. Findings come from the server's health job, so the first check polls.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const EDITOR = { name: 'Edith Editor', email: 'edith.inbox@example.com', password: 'proof-reader-2026' };

let owner: Page;
let api: AdminApi;
let coverId = '';
const entries = { harbour: '', unfinished: '' };
const pageErrors: string[] = [];

const openPage = async (browser: Browser) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const opened = await context.newPage();
  opened.on('pageerror', (error) => pageErrors.push(error.message));
  return opened;
};

/** A place with a required summary and a cover image; one entry lacks alt text, another its summary. */
const seedContent = async () => {
  await api.createDefinition('models', {
    kind: 'collection',
    apiKey: 'fieldNote',
    label: 'Field note',
    fields: [
      { apiKey: 'title', label: 'Title', type: 'string' },
      { apiKey: 'summary', label: 'Summary', type: 'string', required: true },
      { apiKey: 'cover', label: 'Cover', type: 'media', settings: { allowedKinds: ['image'] } },
    ],
  });
  const cover = await api.uploadPng('inbox-cover.png', 40, 30);
  coverId = cover.id;
  const harbour = await api.send<{ id: string }>('POST', '/content/fieldNote', {
    data: { title: 'Harbour lights', summary: 'A night walk', cover: cover.id },
  });
  await api.send('POST', `/content/fieldNote/${harbour.id}/publish`, {});
  const unfinished = await api.send<{ id: string; version: number }>('POST', '/content/fieldNote', {
    data: { title: 'Unfinished thoughts', summary: 'To be written' },
  });
  // Autosave keeps a draft without its required summary.
  await api.send('PUT', `/content/fieldNote/${unfinished.id}`, {
    expectedVersion: unfinished.version,
    autosave: true,
    data: { summary: null },
  });
  entries.harbour = harbour.id;
  entries.unfinished = unfinished.id;
};

test.beforeAll(async ({ browser }) => {
  owner = await openPage(browser);
  await signInAsOwner(owner);
  api = adminApiFor(owner.request, ADMIN_API);
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

/**
 * Leave the shared server as it was for later specs: media.spec expects an empty library (the asset is
 * still used, hence `force`). No schedule is seeded: publishing.spec expects none, cancelled ones included.
 */
test.afterAll(async () => {
  if (coverId) {
    await api.send('DELETE', `/media/assets/${coverId}?force=true`);
  }
  await owner.context().close();
});

const needsYou = (on: Page) => on.getByRole('region', { name: 'Needs you' });
const ruleGroup = (on: Page, name: string) => needsYou(on).getByRole('region', { name });

/** The health job runs after each save; reload until its findings are listed. */
const waitForFinding = async (on: Page, group: string) => {
  await expect(async () => {
    await on.reload();
    await expect(ruleGroup(on, group)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 3_000] });
};

const row = (group: Locator, title: string) => group.getByRole('listitem').filter({ hasText: title });

test('before anything is modelled, the shared server shows only the steps to get started', async () => {
  await owner.goto(ADMIN_URL);
  await expect(owner.getByRole('heading', { level: 1, name: `Welcome, ${OWNER.name}` })).toBeVisible();
  // Earlier specs may already have added content types; only an empty workspace is checked here.
  const definitions = await api.get<{ items: unknown[] }>('/models');
  if (definitions.items.length === 0) {
    await expect(owner.getByRole('region', { name: 'Get started' })).toBeVisible();
    await expect(owner.getByRole('region', { name: 'Recently published' })).toHaveCount(0);
  }
  // The rest of this file works on seeded content.
  await seedContent();
});

test('an empty workspace gets a getting-started page and nothing else', async ({ browser }) => {
  // A fresh server: the shared one already has content types by now.
  const fresh = await openKeyboardSuite(browser, 'inboxOnboarding', pageErrors);
  try {
    const { page, api: freshApi, server } = fresh;
    await page.goto(server.adminUrl);
    await expect(page.getByRole('heading', { level: 1, name: `Welcome, ${OWNER.name}` })).toBeVisible();
    const steps = page.getByRole('region', { name: 'Get started' }).getByRole('listitem');
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText('Create a content type');
    await expect(steps.nth(0).getByRole('link', { name: 'New content type' })).toBeVisible();
    await expect(steps.nth(1)).toContainText('Invite your team');
    await expect(steps.nth(2)).toContainText('Create an API token');
    await expect(steps.nth(2).getByRole('link', { name: 'Create a token' })).toBeVisible();
    // The slim numbers row for admins; no content panels while there is no content.
    await expect(page.getByRole('link', { name: /Content types\s*0/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Admins\s*1/ })).toBeVisible();
    for (const name of ['Needs you', 'Scheduled soon', 'Recently published', 'Workspace overview']) {
      await expect(page.getByRole('region', { name })).toHaveCount(0);
    }
    await captureScreen(page, 'inbox-00-get-started', { viewports: ['desktop', 'phone'] });

    // A working token ticks its step.
    const delivery = await freshApi.send<{ id: string }>('POST', '/roles', {
      key: 'site',
      name: 'Site',
      kind: 'delivery',
      permissions: [{ action: 'read', modelId: null, condition: null, fieldIds: null }],
    });
    await freshApi.send('POST', '/tokens', { name: 'Site build', roleId: delivery.id });
    await page.reload();
    await expect(steps.nth(2)).toContainText('Done');
    await expect(steps.nth(2).getByRole('link')).toHaveCount(0);

    // The first content type turns the page into the inbox, with one-row empty states.
    await freshApi.createDefinition('models', {
      kind: 'collection',
      apiKey: 'note',
      label: 'Note',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    await page.reload();
    await expect(page.getByRole('region', { name: 'Get started' })).toHaveCount(0);
    const needsYou = page.getByRole('region', { name: 'Needs you' });
    await expect(needsYou.getByText('You’re all caught up')).toBeVisible();
    for (const name of ['Needs you', 'Scheduled soon', 'Recently published']) {
      const box = await page.getByRole('region', { name }).boundingBox();
      // Header plus one empty row: never a tall empty card.
      expect(box?.height ?? 0, name).toBeLessThan(140);
    }
    await captureScreen(page, 'inbox-04-admin-empty', { viewports: ['desktop', 'phone'] });
  } finally {
    await fresh.page.context().close();
    await fresh.server.stop();
  }
});

test('the Inbox is home: findings grouped by rule, one sentence each, with a fix that opens the entry', async () => {
  await owner.goto(ADMIN_URL);
  await expect(owner.getByRole('heading', { level: 1, name: `Welcome, ${OWNER.name}` })).toBeVisible();
  await waitForFinding(owner, 'Images without alt text');
  await waitForFinding(owner, 'Required fields left empty');
  const alt = ruleGroup(owner, 'Images without alt text');
  await expect(row(alt, 'Harbour lights')).toContainText('Field note · An image in Cover has no alt text');
  const required = ruleGroup(owner, 'Required fields left empty');
  await expect(row(required, 'Unfinished thoughts')).toContainText(
    'Field note · Summary is required and still empty',
  );
  await expect(owner.getByText(/\d+ things? needs? you/)).toBeVisible();

  // Admins with publishing.manage also see what goes live soon, and the dashboard.
  const scheduled = owner.getByRole('region', { name: 'Scheduled soon' });
  await expect(scheduled.getByText('Nothing scheduled')).toBeVisible();
  const published = owner.getByRole('region', { name: 'Recently published' });
  await expect(row(published, 'Harbour lights')).toContainText('Field note · went live');
  // The snapshot diff is read with the admin's session: no permission lock on the panel.
  await expect(published.getByText("You don't have permission to see this.")).toHaveCount(0);
  await expect(owner.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  // Places show their entry count in the sidebar (the server caches counts for up to a minute).
  const storyItem = owner
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('listitem')
    .filter({ has: owner.getByRole('link', { name: 'Field note', exact: true }) });
  await expect(async () => {
    await owner.reload();
    await expect(storyItem).toContainText('2', { timeout: 2_000 });
  }).toPass({ timeout: 80_000, intervals: [2_000, 5_000] });
  await captureScreen(owner, 'inbox-01-admin', { viewports: ['desktop', 'phone'] });

  const fix = row(alt, 'Harbour lights').getByRole('link', { name: 'Add alt text' });
  await expect(fix).toHaveAccessibleDescription('Harbour lights');
  await fix.click();
  await expect(owner).toHaveURL(new RegExp(`/content/fieldNote/${entries.harbour}(\\?[^#]*)?#cover$`));
});

test('the palette finds entries by title and opens them', async () => {
  await owner.goto(ADMIN_URL);
  await expect(owner.getByRole('heading', { level: 1, name: `Welcome, ${OWNER.name}` })).toBeVisible();
  await owner.keyboard.press('ControlOrMeta+k');
  const palette = owner.getByRole('dialog', { name: 'Search and commands' });
  await expect(palette.getByRole('combobox', { name: /Search places/ })).toBeFocused();
  await owner.keyboard.type('unfinished');
  const entriesGroup = palette.getByRole('group', { name: 'Entries' });
  await expect(entriesGroup.getByRole('option', { name: /Unfinished thoughts/ })).toBeVisible();
  await captureScreen(owner, 'inbox-03-palette-entries', { viewports: ['desktop', 'phone'] });
  await owner.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(owner).toHaveURL(new RegExp(`/content/fieldNote/${entries.unfinished}$`));
});

test('an editor gets the Inbox and places only: no Develop, no workspace management, no dashboard', async ({
  browser,
}) => {
  const roles = await api.get<{ id: string; key: string }[]>('/roles');
  const editorRole = roles.find((role) => role.key === 'editor');
  const offset = logOffset();
  await api.send('POST', '/invitations', { email: EDITOR.email, roleIds: [editorRole?.id] });
  const link = await waitForEmailedLink('accept-invitation', offset);
  const token = decodeURIComponent(link.split('#token=')[1] ?? '');
  const editor = await openPage(browser);
  try {
    const csrf = (await (await editor.request.get(`${ADMIN_API}/auth/csrf`)).json()) as { csrfToken: string };
    const accepted = await editor.request.post(`${ADMIN_API}/invitations/accept`, {
      headers: { 'x-csrf-token': csrf.csrfToken },
      data: { token, name: EDITOR.name, password: EDITOR.password },
    });
    expect(accepted.ok(), await accepted.text()).toBe(true);
    await editor.goto(ADMIN_URL);
    await expect(editor.getByRole('heading', { level: 1, name: `Welcome, ${EDITOR.name}` })).toBeVisible();

    const nav = editor.getByRole('navigation', { name: 'Main navigation' });
    // Editors ship change sets, so Changes sits with Publishing for them too.
    for (const name of ['Inbox', 'Field note', 'Media', 'Publishing', 'Changes', 'Settings']) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
    for (const name of ['New content type', 'Components', 'API tokens', 'Users', 'Roles', 'Locales']) {
      await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(0);
    }
    await expect(nav.getByRole('list', { name: 'Develop' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: /models/i })).toHaveCount(0);

    await waitForFinding(editor, 'Images without alt text');
    await expect(editor.getByRole('region', { name: 'Scheduled soon' })).toHaveCount(0);
    await expect(editor.getByRole('heading', { name: 'Workspace overview' })).toHaveCount(0);
    await expect(editor.getByRole('region', { name: 'Recently published' })).toBeVisible();
    await captureScreen(editor, 'inbox-02-editor', { viewports: ['desktop', 'phone'] });

    // Phone: the sidebar is a sheet.
    await editor.setViewportSize({ width: 390, height: 844 });
    await editor.getByRole('button', { name: 'Toggle sidebar' }).first().click();
    await expect(editor.getByRole('dialog', { name: 'Sidebar' })).toBeVisible();
    await captureScreen(editor, 'shell-05-sidebar-editor-phone');
    await editor.keyboard.press('Escape');
  } finally {
    await editor.context().close();
  }
});
