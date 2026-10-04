import { expect, test, type Browser, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { expectVisibleFocus, inBothSchemes } from './support/keyboard';
import { ADMIN_API, signInAsOwner } from './support/session';
import { siteApi } from './support/sites';

/**
 * Sites in the admin (sites plan §H) against the real API: the site switcher, the network view (sites, a
 * site's app role bindings, admin users with role assignments per site), content, snapshots and change sets
 * kept per site, and an editor with a role on one site only. Everything it creates is removed at the end,
 * so the specs after it see one site again.
 */
test.describe.configure({ mode: 'serial' });

const SITE = { key: 'blog', name: 'Blog' };
const MODEL = { key: 'siteNote', plural: 'siteNotes', label: 'Site note' };
/** The blog's own content type and component (created on the blog: they belong to it). */
const BLOG_MODEL = { key: 'blogPost', plural: 'blogPosts', label: 'Blog post' };
const BLOG_COMPONENT = { key: 'blogQuote', label: 'Blog quote' };
const MAIN_NOTE = 'A note on the main site';
const BLOG_NOTE = 'A note on the blog';
const SET_TITLE = 'Main site only launch';
const EDITOR = { name: 'Bea Blogger', email: 'bea@example.com', password: 'only-the-blog-2026' };
const BOTH = { viewports: ['desktop', 'phone'] } as const;

let page: Page;
let editorPage: Page | undefined;
let modelId = '';
let blogModelId = '';
let blogComponentId = '';
let siteId = '';
let blogEntryId = '';
let changeSetId = '';
let inviteLink = '';
let mainLedgerBefore = 0;
const pageErrors: string[] = [];

const owner = () => siteApi(page.request);
const onBlog = () => siteApi(page.request, SITE.key);

/** Deletes a definition at its active version, through the site whose view has it. */
const deleteDefinition = async (api: ReturnType<typeof siteApi>, path: string) => {
  const { version } = await api.get<{ version: number }>(path);
  await api.send('DELETE', `${path}?expectedVersion=${version}`);
};

const switcher = (on: Page) => on.getByRole('button', { name: /^Switch site/ });

const openSite = async (on: Page, name: string) => {
  await switcher(on).click();
  await on.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click();
};

const openPage = async (browser: Browser) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const opened = await context.newPage();
  opened.on('pageerror', (error) => pageErrors.push(error.message));
  return opened;
};

test.beforeAll(async ({ browser }) => {
  page = await openPage(browser);
  await signInAsOwner(page);
  // Shared with all sites: the blog reads and writes it too.
  const created = await owner().send<{ definitionId: string }>('POST', '/models', {
    scope: 'network',
    definition: {
      kind: 'collection',
      apiKey: MODEL.key,
      pluralApiKey: MODEL.plural,
      label: MODEL.label,
      fields: [{ apiKey: 'title', label: 'Title', type: 'string', required: true }],
    },
  });
  modelId = created.definitionId;
  const entry = await owner().send<{ id: string }>('POST', `/content/${MODEL.key}`, {
    data: { title: MAIN_NOTE },
  });
  await owner().send('POST', `/content/${MODEL.key}/${entry.id}/publish`, {});
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  // Leave one site, no extra admins and no extra models behind (later specs expect that).
  await editorPage?.context().close();
  const users = await owner().get<{ id: string; email: string }[]>('/users');
  const editor = users.find((user) => user.email === EDITOR.email);
  if (editor) {
    await owner().send('DELETE', `/users/${editor.id}`);
  }
  const invitations = await owner().get<{ id: string; email: string }[]>('/invitations');
  for (const invitation of invitations.filter((item) => item.email === EDITOR.email)) {
    await owner().send('DELETE', `/invitations/${invitation.id}`);
  }
  if (changeSetId) {
    const set = await owner().get<{ status: string }>(`/change-sets/${changeSetId}`);
    if (set.status === 'open') {
      await owner().send('POST', `/change-sets/${changeSetId}/discard`, {});
    }
  }
  const sites = await owner().get<{ id: string; key: string }[]>('/sites');
  const blog = sites.find((site) => site.key === SITE.key);
  if (blog) {
    if (blogEntryId) {
      await onBlog().send('DELETE', `/content/${MODEL.key}/${blogEntryId}`);
    }
    // A site with definitions of its own can't be deleted. The blog post may have moved (scope test).
    if (blogComponentId) {
      await deleteDefinition(onBlog(), `/components/${blogComponentId}`);
    }
    if (blogModelId) {
      for (const api of [onBlog(), owner()]) {
        const found = await api.fetch('GET', `/models/${blogModelId}`);
        if (found.ok()) {
          await deleteDefinition(api, `/models/${blogModelId}`);
          break;
        }
      }
    }
    await owner().send('DELETE', `/sites/${blog.id}`);
  }
  if (modelId) {
    const { version } = await owner().get<{ version: number }>(`/models/${modelId}`);
    await owner().send('DELETE', `/models/${modelId}?expectedVersion=${version}`);
  }
  await page.context().close();
});

test('a URL without a site opens the primary site, and the switcher leads to the network view', async () => {
  await page.goto(ADMIN_URL);
  await expect(page).toHaveURL(/\/admin\/s\/default\/$/);
  await expect(switcher(page)).toHaveAccessibleName('Switch site (current: Default site)');
  await switcher(page).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /^Default site/ })).toHaveAttribute('aria-current', 'page');
  await expect(menu.getByRole('menuitem', { name: 'Network' })).toBeVisible();
  await captureScreen(page, 'sites-01-switcher', { viewports: ['desktop'] });
  await menu.getByRole('menuitem', { name: 'Network' }).click();
  await expect(page).toHaveURL(/\/admin\/network\/sites$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sites' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const name of ['Sites', 'Users', 'Roles', 'Audit log']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole('link', { name: 'Inbox' })).toHaveCount(0);
  await expect(switcher(page)).toHaveAccessibleName('Switch site (current: Network)');
});

test('Network → Sites creates a site with a fixed key', async () => {
  await page.getByRole('button', { name: 'New site' }).click();
  const sheet = page.getByRole('dialog', { name: 'Create site' });
  await sheet.getByRole('textbox', { name: 'Name' }).fill(SITE.name);
  await sheet.getByRole('textbox', { name: 'Key' }).fill('Not a key');
  await sheet.getByRole('button', { name: 'Create' }).click();
  await expect(
    sheet.getByText('Use lower-case letters, digits and hyphens, starting with a letter.'),
  ).toBeVisible();
  await sheet.getByRole('textbox', { name: 'Key' }).fill(SITE.key);
  await captureScreen(page, 'sites-02-create-sheet', BOTH);
  await sheet.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(`Site ${SITE.name} created.`)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: SITE.name })).toBeVisible();
  siteId = /\/network\/sites\/([0-9a-f-]{36})$/.exec(page.url())?.[1] ?? '';
  expect(siteId).not.toBe('');
  await page.getByRole('link', { name: 'Sites' }).first().click();
  await expect(page.getByRole('row').filter({ hasText: SITE.name })).toContainText(SITE.key);
  await captureScreen(page, 'sites-03-network-sites', BOTH);
});

test("a site's app role bindings: public and authenticated callers", async () => {
  await page.getByRole('row').filter({ hasText: SITE.name }).getByRole('link', { name: SITE.name }).click();
  const panel = page.getByRole('region', { name: 'App roles' });
  const anonymous = panel.getByRole('group', { name: 'Anonymous callers (public)' });
  // A new site binds nothing: deny by default.
  await expect(anonymous.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await anonymous.getByRole('checkbox', { name: 'Public' }).check();
  await captureScreen(page, 'sites-04-site-bindings', BOTH);
  await panel.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('App roles saved.')).toBeVisible();
  const bindings = await owner().get<{ public: string[]; authenticated: string[] }>(
    `/sites/${siteId}/app-roles`,
  );
  expect(bindings.public).toHaveLength(1);
  expect(bindings.authenticated).toEqual([]);
});

test('the switcher opens another site: the URL carries its key and its content is its own', async () => {
  mainLedgerBefore = (await owner().get<{ current: number }>('/snapshots')).current;
  const blogEntry = await onBlog().send<{ id: string }>('POST', `/content/${MODEL.key}`, {
    data: { title: BLOG_NOTE },
  });
  blogEntryId = blogEntry.id;
  await onBlog().send('POST', `/content/${MODEL.key}/${blogEntryId}/publish`, {});

  await openSite(page, SITE.name);
  await expect(page).toHaveURL(new RegExp(`/admin/s/${SITE.key}/$`));
  await expect(switcher(page)).toHaveAccessibleName(`Switch site (current: ${SITE.name})`);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: MODEL.label, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/s/${SITE.key}/content/${MODEL.key}$`));
  await expect(page.getByRole('row').filter({ hasText: BLOG_NOTE })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: MAIN_NOTE })).toHaveCount(0);

  // Remembered: a URL without a site now opens the blog.
  await page.goto(`${ADMIN_URL}content/${MODEL.key}`);
  await expect(page).toHaveURL(new RegExp(`/admin/s/${SITE.key}/content/${MODEL.key}$`));

  await openSite(page, 'Default site');
  await expect(page).toHaveURL(/\/admin\/s\/default\/$/);
  await page.goto(`${ADMIN_URL}s/default/content/${MODEL.key}`);
  await expect(page.getByRole('row').filter({ hasText: MAIN_NOTE })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: BLOG_NOTE })).toHaveCount(0);
});

test("a site's own content types stay on it; shared ones are on every site", async () => {
  const post = await onBlog().send<{ definitionId: string }>('POST', '/models', {
    definition: {
      kind: 'collection',
      apiKey: BLOG_MODEL.key,
      pluralApiKey: BLOG_MODEL.plural,
      label: BLOG_MODEL.label,
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    },
  });
  blogModelId = post.definitionId;
  const quote = await onBlog().send<{ definitionId: string }>('POST', '/components', {
    definition: {
      kind: 'component',
      apiKey: BLOG_COMPONENT.key,
      label: BLOG_COMPONENT.label,
      fields: [{ apiKey: 'text', label: 'Text', type: 'text' }],
    },
  });
  blogComponentId = quote.definitionId;
  const nav = page.getByRole('navigation', { name: 'Main navigation' });

  // On the blog: its own type (no mark) and the shared one (marked, its name still the label).
  await page.goto(`${ADMIN_URL}s/${SITE.key}/`);
  await expect(nav.getByRole('link', { name: BLOG_MODEL.label, exact: true })).toHaveAccessibleDescription(
    '',
  );
  await expect(nav.getByRole('link', { name: MODEL.label, exact: true })).toHaveAccessibleDescription(
    'Shared with all sites',
  );
  await captureScreen(page, 'sites-08-shared-mark', { viewports: ['desktop'] });
  await page.goto(`${ADMIN_URL}s/${SITE.key}/develop/components`);
  await expect(page.getByRole('row').filter({ hasText: BLOG_COMPONENT.label })).toBeVisible();

  // On the main site: the shared type only; the blog's type and component aren't there at all.
  await page.goto(`${ADMIN_URL}s/default/`);
  await expect(nav.getByRole('link', { name: MODEL.label, exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: BLOG_MODEL.label })).toHaveCount(0);
  await page.goto(`${ADMIN_URL}s/default/develop/components`);
  await expect(page.getByRole('heading', { level: 1, name: 'Components' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: BLOG_COMPONENT.label })).toHaveCount(0);
  const mainModels = await owner().get<{ items: { definition: { apiKey: string } }[] }>('/models');
  expect(mainModels.items.map(({ definition }) => definition.apiKey)).not.toContain(BLOG_MODEL.key);
  expect((await owner().fetch('GET', `/content/${BLOG_MODEL.key}`)).status()).toBe(404);
});

test('the builder shares a type with all sites and keeps it on one; a type with entries elsewhere stays', async () => {
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const settings = () => page.getByRole('button', { name: 'Model settings' });
  const availableOn = () => page.getByRole('heading', { name: 'Available on' }).locator('..');

  await page.goto(`${ADMIN_URL}s/${SITE.key}/content/${BLOG_MODEL.key}?tab=structure`);
  await expect(page.getByRole('heading', { level: 1, name: BLOG_MODEL.label })).toBeVisible();
  await settings().click();
  await expect(availableOn()).toContainText(`Only on ${SITE.name}`);
  await availableOn().getByRole('button', { name: 'Share with all sites' }).click();
  const share = page.getByRole('alertdialog', { name: `Share ${BLOG_MODEL.label} with all sites?` });
  await expect(share).toBeVisible();
  await captureScreen(page, 'sites-09-share-confirm', { viewports: ['desktop'] });
  await share.getByRole('button', { name: 'Share with all sites' }).click();
  await expect(page.getByText('Shared with all sites.').first()).toBeVisible();
  await expect(availableOn().getByRole('button', { name: 'Keep on this site' })).toBeVisible();
  await captureScreen(page, 'sites-10-scope-shared', { viewports: ['desktop', 'phone'] });

  // Shared: the main site has it now; keeping it there moves it off the blog (which has no entries of it).
  await page.goto(`${ADMIN_URL}s/default/content/${BLOG_MODEL.key}?tab=structure`);
  await expect(page.getByRole('heading', { level: 1, name: BLOG_MODEL.label })).toBeVisible();
  await settings().click();
  await availableOn().getByRole('button', { name: 'Keep on this site' }).click();
  await page
    .getByRole('alertdialog', { name: `Keep ${BLOG_MODEL.label} on Default site only?` })
    .getByRole('button', { name: 'Keep on this site' })
    .click();
  await expect(page.getByText('Now only on this site.').first()).toBeVisible();
  await expect(availableOn()).toContainText('Only on Default site');
  const blogModels = await onBlog().get<{ items: { definition: { apiKey: string } }[] }>('/models');
  expect(blogModels.items.map(({ definition }) => definition.apiKey)).not.toContain(BLOG_MODEL.key);
  await deleteDefinition(owner(), `/models/${blogModelId}`);
  blogModelId = '';
  // Deleted through the API: a fresh load shows the sidebar without it.
  await page.goto(`${ADMIN_URL}s/default/`);
  await expect(nav.getByRole('link', { name: MODEL.label, exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: BLOG_MODEL.label })).toHaveCount(0);

  // The shared note has an entry on the blog: it can't be kept on the main site alone.
  await page.goto(`${ADMIN_URL}s/default/content/${MODEL.key}?tab=structure`);
  await expect(page.getByRole('heading', { level: 1, name: MODEL.label })).toBeVisible();
  await settings().click();
  await availableOn().getByRole('button', { name: 'Keep on this site' }).click();
  const keep = page.getByRole('alertdialog', { name: `Keep ${MODEL.label} on Default site only?` });
  await keep.getByRole('button', { name: 'Keep on this site' }).click();
  await expect(keep.getByText(/Other sites still have 1 entry of this content type/)).toBeVisible();
  await captureScreen(page, 'sites-11-scope-in-use', { viewports: ['desktop'] });
  await keep.getByRole('button', { name: 'Cancel' }).click();
  await expect(availableOn()).toContainText('Shared with all sites');
  // A fresh load: the next test's focus checks start without a preceding mouse click.
  await page.goto(`${ADMIN_URL}s/default/`);
});

test('the switcher works from the keyboard with a visible focus in both themes', async () => {
  const trigger = switcher(page);
  await inBothSchemes(page, async () => {
    await trigger.focus();
    await expectVisibleFocus(page, 'site switcher');
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expectVisibleFocus(page, 'site switcher menu');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test('snapshots and change sets belong to their site', async () => {
  const set = await owner().send<{ id: string }>('POST', '/change-sets', { title: SET_TITLE });
  changeSetId = set.id;
  await page.goto(`${ADMIN_URL}s/default/changes`);
  await expect(page.getByText(SET_TITLE)).toBeVisible();
  await page.goto(`${ADMIN_URL}s/${SITE.key}/changes`);
  await expect(page.getByText('No open change sets')).toBeVisible();
  await expect(page.getByText(SET_TITLE)).toHaveCount(0);

  // The blog has published once: its own ledger starts at v1.
  await page.goto(`${ADMIN_URL}s/${SITE.key}/snapshots`);
  await expect(page.getByRole('heading', { level: 1, name: 'Snapshots' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^v\d+$/ })).toHaveText(['v1']);
  const blogLedger = await onBlog().get<{ current: number }>('/snapshots');
  const mainLedger = await owner().get<{ current: number }>('/snapshots');
  // Publishing on the blog took the blog's v1 and left the main site's ledger where it was.
  expect(blogLedger.current).toBe(1);
  expect(mainLedger.current).toBe(mainLedgerBefore);
});

test('inviting an admin to one site: the access rows', async () => {
  await page.goto(`${ADMIN_URL}network/users`);
  await page.getByRole('button', { name: 'Invite user' }).click();
  const sheet = page.getByRole('dialog', { name: 'Invite a user' });
  await sheet.getByLabel('Email').fill(EDITOR.email);
  const row = sheet.getByRole('group', { name: 'Access 1' });
  await row.getByRole('combobox', { name: 'Site' }).click();
  await page.getByRole('option', { name: SITE.name }).click();
  await expect(row.getByRole('combobox', { name: 'Role' })).toHaveText('Editor');
  await captureScreen(page, 'sites-05-invite-access', BOTH);
  await sheet.getByRole('button', { name: 'Invite user' }).click();
  const reveal = page.getByRole('region', { name: `Invitation link for ${EDITOR.email}` });
  inviteLink = await reveal.getByLabel('Invitation link').inputValue();
  await reveal.getByRole('button', { name: "I've copied it" }).click();
  await expect(
    page
      .getByRole('region', { name: 'Pending invitations' })
      .getByRole('row')
      .filter({ hasText: EDITOR.email }),
  ).toContainText(`Editor · ${SITE.name}`);
});

test('an editor with a role on one site only: the other site says so, and its API refuses', async ({
  browser,
}) => {
  const editor = await openPage(browser);
  editorPage = editor;
  const token = decodeURIComponent(inviteLink.split('#token=')[1] ?? '');
  const csrf = (await (await editor.request.get(`${ADMIN_API}/auth/csrf`)).json()) as { csrfToken: string };
  const accepted = await editor.request.post(`${ADMIN_API}/invitations/accept`, {
    headers: { 'x-csrf-token': csrf.csrfToken },
    data: { token, name: EDITOR.name, password: EDITOR.password },
  });
  expect(accepted.ok(), await accepted.text()).toBe(true);

  // No role on the primary site: a URL without a site lands on the blog.
  await editor.goto(ADMIN_URL);
  await expect(editor).toHaveURL(new RegExp(`/admin/s/${SITE.key}/$`));
  await expect(editor.getByRole('heading', { level: 1, name: `Welcome, ${EDITOR.name}` })).toBeVisible();
  const nav = editor.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: MODEL.label, exact: true })).toBeVisible();
  // The note is shared and the editor role grants no schema action: no Structure tab and no Develop.
  await expect(nav.getByRole('list', { name: 'Develop' })).toHaveCount(0);
  await nav.getByRole('link', { name: MODEL.label, exact: true }).click();
  await expect(editor.getByRole('row').filter({ hasText: BLOG_NOTE })).toBeVisible();
  await expect(editor.getByRole('link', { name: 'Structure' })).toHaveCount(0);
  await switcher(editor).click();
  await expect(editor.getByRole('menu').getByRole('menuitem')).toHaveCount(1);
  await expect(editor.getByRole('menuitem', { name: 'Network' })).toHaveCount(0);
  await editor.keyboard.press('Escape');

  await editor.goto(`${ADMIN_URL}s/default/`);
  await expect(editor.getByText('You have no role on this site')).toBeVisible();
  await expect(editor.getByRole('button', { name: `Open ${SITE.name}` })).toBeVisible();
  await expect(nav.getByRole('link')).toHaveCount(0);
  await captureScreen(editor, 'sites-06-no-role', BOTH);

  const denied = await siteApi(editor.request, 'default').fetch('GET', `/content/${MODEL.key}`);
  expect(denied.status()).toBe(403);
  expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('SITE_FORBIDDEN');
  const allowed = await siteApi(editor.request, SITE.key).fetch('GET', `/content/${MODEL.key}`);
  expect(allowed.ok()).toBe(true);

  await editor.getByRole('button', { name: `Open ${SITE.name}` }).click();
  await expect(editor).toHaveURL(new RegExp(`/admin/s/${SITE.key}/$`));

  await editor.goto(`${ADMIN_URL}s/no-such-site/`);
  await expect(editor.getByRole('heading', { name: "This site doesn't exist" })).toBeVisible();
});

test("an owner changes an admin's access per site; the owner role stays on all sites", async () => {
  await page.goto(`${ADMIN_URL}network/users`);
  await page.getByRole('button', { name: `Actions: ${EDITOR.name}` }).click();
  await page.getByRole('menuitem', { name: 'Change access' }).click();
  const sheet = page.getByRole('dialog', { name: `Access for ${EDITOR.name}` });
  await expect(
    sheet.getByRole('group', { name: 'Access 1' }).getByRole('combobox', { name: 'Site' }),
  ).toHaveText(SITE.name);
  await sheet.getByRole('button', { name: 'Add a site' }).click();
  const second = sheet.getByRole('group', { name: 'Access 2' });
  await second.getByRole('combobox', { name: 'Site' }).click();
  await page.getByRole('option', { name: 'Default site' }).click();
  await second.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'Owner' }).click();
  await sheet.getByRole('button', { name: 'Save changes' }).click();
  await expect(second.getByText('The owner role can only be given on all sites.')).toBeVisible();
  await second.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'Read-only' }).click();
  await captureScreen(page, 'sites-07-access-sheet', BOTH);
  await sheet.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Access updated.')).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: EDITOR.email });
  await expect(row).toContainText(`Editor · ${SITE.name}`);
  await expect(row).toContainText('Read-only · Default site');
});

test("a site admin creates the site's own types; a shared type's builder is read-only", async () => {
  const editor = editorPage;
  expect(editor).toBeDefined();
  if (!editor) {
    return;
  }
  const users = await owner().get<{ id: string; email: string }[]>('/users');
  const roles = await owner().get<{ id: string; key: string | null }[]>('/roles');
  const userId = users.find((user) => user.email === EDITOR.email)?.id ?? '';
  const adminRoleId = roles.find((role) => role.key === 'admin')?.id ?? '';
  await owner().send('PATCH', `/users/${userId}`, { assignments: [{ roleId: adminRoleId, siteId }] });

  // Admin on the blog only: "All sites" is off when creating, and the shared note can be read, not changed.
  await editor.goto(`${ADMIN_URL}s/${SITE.key}/content/new`);
  const availableOn = editor.getByRole('group', { name: 'Available on' });
  await expect(availableOn.getByRole('radio', { name: 'This site' })).toBeChecked();
  await expect(availableOn.getByRole('radio', { name: 'All sites' })).toBeDisabled();
  await captureScreen(editor, 'sites-12-available-on-site-only', { viewports: ['desktop'] });

  await editor.goto(`${ADMIN_URL}s/${SITE.key}/content/${MODEL.key}?tab=structure`);
  await expect(editor.getByRole('heading', { level: 1, name: MODEL.label })).toBeVisible();
  await expect(
    editor.getByText('Shared with all sites: changing it needs a role on every site.'),
  ).toBeVisible();
  await editor.getByRole('button', { name: 'Model settings' }).click();
  await expect(editor.getByRole('textbox', { name: 'Label' }).first()).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Keep on this site' })).toHaveCount(0);
  await captureScreen(editor, 'sites-13-shared-read-only', { viewports: ['desktop'] });
});

test('a site with content cannot be deleted; once emptied it can', async () => {
  await page.goto(`${ADMIN_URL}network/sites/${siteId}`);
  await page.getByRole('button', { name: 'Delete site' }).click();
  const confirm = page.getByRole('alertdialog', { name: `Delete ${SITE.name}?` });
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(
    confirm.getByText(
      'This site still has content types, components, entries, media, change sets or app users.',
      { exact: false },
    ),
  ).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();

  // Once its content and its own definitions are deleted, the site is empty and goes. This page load works
  // on the blog (it was the last site opened), so deleting it reloads the sites list for the primary site.
  await deleteDefinition(onBlog(), `/components/${blogComponentId}`);
  blogComponentId = '';
  await onBlog().send('DELETE', `/content/${MODEL.key}/${blogEntryId}`);
  blogEntryId = '';
  await page.goto(`${ADMIN_URL}s/${SITE.key}/`);
  await page.goto(`${ADMIN_URL}network/sites/${siteId}`);
  await page.getByRole('button', { name: 'Delete site' }).click();
  await page
    .getByRole('alertdialog', { name: `Delete ${SITE.name}?` })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page).toHaveURL(/\/admin\/network\/sites$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sites' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: SITE.name })).toHaveCount(0);
  await switcher(page).click();
  await expect(page.getByRole('menuitem', { name: new RegExp(`^${SITE.name}`) })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect((await owner().get<{ key: string }[]>('/sites')).map((site) => site.key)).toEqual(['default']);
});
