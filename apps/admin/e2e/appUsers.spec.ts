import { expect, request, test, type Page } from '@playwright/test';
import { captureScreen, VIEWPORTS } from './support/capture';
import { ADMIN_URL, E2E_BASE_PATH, E2E_ORIGIN } from './support/constants';
import { logOffset, waitForLog } from './support/serverLog';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * Users → App users and Settings → Roles → App roles against the real API: app users who signed up through
 * /api/app-auth, searched, given a custom role, blocked (their token stops working at once), sent a new
 * confirmation email and deleted; a custom app role edited in the model × action matrix with "own entries
 * only" and a hidden field; the built-in Public role opened to anonymous reads. Light and dark, with axe.
 */
test.describe.configure({ mode: 'serial' });

const APP_AUTH = `${E2E_ORIGIN}${E2E_BASE_PATH}/api/app-auth`;
const PASSWORD = 'app-user password 1';
const USERS = {
  alice: { name: 'Alice Ball', email: 'alice@example.com' },
  bob: { name: 'Bob Kahn', email: 'bob@example.com' },
  carol: { name: 'Carol Shaw', email: 'carol@example.com' },
};

let page: Page;
const pageErrors: string[] = [];
let model: { id: string; version: number } | undefined;
let bobAccessToken = '';

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  const created = await adminRequest(page.request, 'POST', '/models', {
    definition: {
      kind: 'collection',
      apiKey: 'review',
      label: 'Review',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'moderatorNote', label: 'Moderator note', type: 'string', public: false },
      ],
    },
  });
  const { definitionId } = (await created.json()) as { definitionId: string };
  await expect
    .poll(async () => (await page.request.get(`${ADMIN_API}/models/${definitionId}`)).status())
    .toBe(200);
  const detail = (await (await page.request.get(`${ADMIN_API}/models/${definitionId}`)).json()) as {
    version: number;
  };
  model = { id: definitionId, version: detail.version };
  for (const [key, user] of Object.entries(USERS)) {
    const response = await page.request.post(`${APP_AUTH}/register`, {
      data: { ...user, password: PASSWORD },
    });
    expect(response.status(), await response.text()).toBe(201);
    if (key === 'bob') {
      bobAccessToken = ((await response.json()) as { session: { accessToken: string } }).session.accessToken;
    }
  }
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  // Later specs expect an empty model list and the built-in app roles back at their defaults (nothing).
  const roles = (await (await page.request.get(`${ADMIN_API}/app-roles`)).json()) as Array<{
    id: string;
    key: string;
    version: number;
  }>;
  const { csrfToken } = (await (await page.request.get(`${ADMIN_API}/auth/csrf`)).json()) as {
    csrfToken: string;
  };
  for (const role of roles.filter((candidate) => ['public', 'authenticated'].includes(candidate.key))) {
    await page.request.patch(`${ADMIN_API}/app-roles/${role.id}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { expectedVersion: role.version, permissions: [] },
    });
  }
  if (model) {
    await adminRequest(page.request, 'DELETE', `/models/${model.id}?expectedVersion=${model.version}`);
  }
  await page.context().close();
});

const toast = (text: string) => page.getByText(text).first();
const rowActions = (name: string) => page.getByRole('button', { name: `Actions: ${name}` });
const appUserRow = (name: string) => page.getByRole('row').filter({ hasText: name });

test('App users lists the people who signed up on the site', async () => {
  await page.goto(ADMIN_URL);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'App users' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'App users' })).toBeVisible();
  for (const user of Object.values(USERS)) {
    await expect(appUserRow(user.name)).toContainText(user.email);
  }
  await expect(appUserRow(USERS.alice.name)).toContainText('Email not confirmed');
  await captureScreen(page, 'app-users-01-list', { viewports: ['desktop'] });
});

test('searches by email or name, in the URL', async () => {
  await page.getByRole('searchbox', { name: 'Search app users' }).fill('kahn');
  await expect(page).toHaveURL(/[?&]q=kahn/);
  await expect(appUserRow(USERS.bob.name)).toBeVisible();
  await expect(appUserRow(USERS.alice.name)).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search app users' }).fill('nobody-matches');
  await expect(page.getByText('No app users match this search.')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search app users' }).fill('');
  await expect(appUserRow(USERS.alice.name)).toBeVisible();
});

test('App roles: the built-in roles and a new custom role', async () => {
  await page.goto(`${ADMIN_URL}settings/roles`);
  await page.getByRole('navigation', { name: 'Role types' }).getByRole('link', { name: 'App roles' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'App roles' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Everyone without a token' })).toContainText('Public');
  await expect(page.getByRole('row').filter({ hasText: 'Every signed-in app user' })).toContainText(
    'Authenticated',
  );
  // Deny by default: both built-in roles start with nothing, and the screen says so.
  await expect(page.getByRole('note')).toContainText('see nothing until you grant it');
  await captureScreen(page, 'app-roles-01-list', { viewports: ['desktop'] });

  // The one-click preset.
  await page.getByRole('button', { name: 'Grant read on all models: Authenticated' }).click();
  await expect(toast('Authenticated can now read published content in every model.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Grant read on all models: Authenticated' })).toHaveCount(0);

  await page.getByRole('button', { name: 'New app role' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create app role' });
  await dialog.getByLabel('Name').fill('Reviewers');
  await dialog.getByLabel('Key', { exact: true }).fill('reviewers');
  await captureScreen(page, 'app-roles-02-create-sheet');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Reviewers' })).toBeVisible();
});

test('the permission matrix: create, own entries only, and a hidden field', async () => {
  await page.getByRole('checkbox', { name: 'Read: Review' }).click();
  await page.getByRole('checkbox', { name: 'Create: Review' }).click();
  await page.getByRole('checkbox', { name: 'Update: Review' }).click();
  await page.getByRole('button', { name: 'Options: Review' }).click();
  const update = page.getByRole('group', { name: 'Update' });
  await update.getByRole('switch', { name: 'Only their own entries' }).click();
  const read = page.getByRole('group', { name: 'Read' });
  await read.getByRole('radio', { name: 'Only selected fields' }).click();
  await read.getByRole('checkbox', { name: /Moderator note/ }).click();
  await expect(read.getByRole('checkbox', { name: 'Title' })).toBeChecked();
  await captureScreen(page, 'app-roles-03-matrix', { viewports: ['desktop'] });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(toast('Role saved.')).toBeVisible();

  const roles = (await (await page.request.get(`${ADMIN_API}/app-roles`)).json()) as Array<{
    key: string;
    permissions: Array<{
      action: string;
      modelId: string | null;
      condition: string | null;
      fieldIds: string[] | null;
    }>;
  }>;
  const reviewers = roles.find((role) => role.key === 'reviewers');
  expect(
    reviewers?.permissions.map(({ fieldIds, ...grant }) => ({ ...grant, fields: fieldIds?.length ?? null })),
  ).toEqual([
    { action: 'create', modelId: model?.id, condition: null, fields: null },
    { action: 'read', modelId: model?.id, condition: null, fields: 2 },
    { action: 'update', modelId: model?.id, condition: 'ownedByPrincipal', fields: null },
  ]);
});

test('the built-in Public role keeps its name; granting read opens delivery to anonymous callers', async () => {
  const anonymous = await request.newContext();
  // Delivery lists a collection under its plural API ID (`review` → `reviews`).
  const deliver = () => anonymous.get(`${E2E_ORIGIN}${E2E_BASE_PATH}/api/content/reviews`);
  expect((await deliver()).status()).toBe(401);
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'App roles', exact: true })
    .click();
  await page.getByRole('link', { name: 'Public', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Public' })).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Read: All models' }).click();
  await captureScreen(page, 'app-roles-04-public');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(toast('Role saved.')).toBeVisible();
  expect((await deliver()).status()).toBe(200);
  await anonymous.dispose();
});

test('assigns a custom role to an app user', async () => {
  await page.goto(`${ADMIN_URL}users/app`);
  await rowActions(USERS.alice.name).click();
  await page.getByRole('menuitem', { name: 'Change roles' }).click();
  // A checklist anchored to the row's roles, not a dialog over the list.
  const checklist = page.getByRole('dialog', { name: `Roles for ${USERS.alice.name}` });
  await checklist.getByRole('checkbox', { name: 'Reviewers' }).click();
  await captureScreen(page, 'app-users-02-roles-checklist', { viewports: ['desktop', 'phone'] });
  await checklist.getByRole('button', { name: 'Save changes' }).click();
  await expect(toast('Roles updated.')).toBeVisible();
  await expect(checklist).toHaveCount(0);
  await expect(rowActions(USERS.alice.name)).toBeFocused();
  await expect(appUserRow(USERS.alice.name)).toContainText('Reviewers');
});

test('blocking signs the app user out at once', async () => {
  const me = () =>
    page.request.get(`${APP_AUTH}/me`, { headers: { authorization: `Bearer ${bobAccessToken}` } });
  expect((await me()).status()).toBe(200);
  await rowActions(USERS.bob.name).click();
  await page.getByRole('menuitem', { name: 'Block' }).click();
  await expect(page.getByRole('alertdialog', { name: `Block ${USERS.bob.name}?` })).toBeVisible();
  await captureScreen(page, 'app-users-03-block-confirm', { viewports: ['desktop'] });
  // On a phone the row's menu button is reached by scrolling the table, so open the confirmation there
  // (resizing with it open would leave its anchor scrolled out of view).
  await page.keyboard.press('Escape');
  const size = page.viewportSize();
  await page.setViewportSize(VIEWPORTS.phone);
  await rowActions(USERS.bob.name).click();
  await page.getByRole('menuitem', { name: 'Block' }).click();
  await expect(page.getByRole('alertdialog', { name: `Block ${USERS.bob.name}?` })).toBeVisible();
  await captureScreen(page, 'app-users-03-block-confirm', { viewports: ['phone'] });
  if (size) {
    await page.setViewportSize(size);
  }
  await page.getByRole('alertdialog').getByRole('button', { name: 'Block' }).click();
  await expect(toast('App user blocked.')).toBeVisible();
  await expect(appUserRow(USERS.bob.name)).toContainText('Blocked');
  expect((await me()).status()).toBe(401);
  await rowActions(USERS.bob.name).click();
  await page.getByRole('menuitem', { name: 'Unblock' }).click();
  await page
    .getByRole('alertdialog', { name: `Unblock ${USERS.bob.name}?` })
    .getByRole('button', { name: 'Unblock' })
    .click();
  await expect(toast('App user unblocked.')).toBeVisible();
  await expect(appUserRow(USERS.bob.name)).toContainText('Active');
});

test('resends a confirmation email and deletes an account', async () => {
  const offset = logOffset();
  await rowActions(USERS.carol.name).click();
  await page.getByRole('menuitem', { name: 'Resend confirmation email' }).click();
  await expect(toast(`Confirmation email sent to ${USERS.carol.email}.`)).toBeVisible();
  await waitForLog(/https:\/\/site\.example\.com\/confirm-email#token=[A-Za-z0-9_%-]+/, 15_000, offset);

  await rowActions(USERS.carol.name).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog', { name: `Delete ${USERS.carol.name}?` })).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(toast('App user deleted.')).toBeVisible();
  await expect(appUserRow(USERS.carol.name)).toHaveCount(0);
  await captureScreen(page, 'app-users-04-after-delete');
});
