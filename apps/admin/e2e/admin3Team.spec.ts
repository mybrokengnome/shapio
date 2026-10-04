import { expect, test, type Page } from '@playwright/test';
import { OWNER } from './support/accounts';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { saveInviteLink } from './support/inviteLink';
import { signInAsOwner } from './support/session';

/**
 * Users and every settings screen against the real API: the user list, an invitation link, profile with
 * dirty-state protection, sessions, appearance, locales, roles, API tokens and the audit log.
 * The admin*.spec.ts files run in name order (Playwright sorts files): admin1Setup does first-run setup,
 * admin3Team sends the invitation admin4Auth accepts.
 */
test.describe.configure({ mode: 'serial' });

const INVITEE_EMAIL = 'grace@example.com';
const BOTH = { viewports: ['desktop', 'phone'] } as const;

let page: Page;
/** Uncaught exceptions in the admin fail the test that caused them. */
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  // axe needs a page from an explicit context.
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  await page.goto(ADMIN_URL);
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page.context().close();
});

const settingsLink = (name: string) =>
  page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name });

test('home is the Inbox: an empty workspace shows the steps to get started', async () => {
  await expect(page.getByRole('heading', { name: `Welcome, ${OWNER.name}` })).toBeVisible();
  // No content types yet on this server: the getting-started steps, nothing else.
  const steps = page.getByRole('region', { name: 'Get started' }).getByRole('listitem');
  await expect(steps.filter({ hasText: 'Create a content type' })).toBeVisible();
  await expect(
    steps.filter({ hasText: 'Invite your team' }).getByRole('link', { name: 'Invite people' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Needs you' })).toHaveCount(0);
  // Only the owner so far: the stats row counts admins, not background jobs.
  await expect(page.getByRole('link', { name: /Admins\s*1/ })).toBeVisible();
  await captureScreen(page, 'team-01-home', { viewports: ['desktop', 'phone'] });
});

test('users screen lists the owner', async () => {
  await page.goto(`${ADMIN_URL}network/users`);
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: new RegExp(OWNER.email) })).toBeVisible();
  await captureScreen(page, 'team-02-users', { viewports: ['desktop'] });
});

test('inviting a user without email shows a link to send by hand, and lists the invitation', async () => {
  await page.getByRole('button', { name: 'Invite user' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite a user' });
  await dialog.getByLabel('Email').fill(INVITEE_EMAIL);
  // Exactly one role, Editor preselected; Owner isn't offered.
  const roles = dialog.getByRole('radiogroup', { name: 'Role' });
  await expect(roles.getByRole('radio', { name: 'Editor' })).toBeChecked();
  await expect(roles.getByRole('radio', { name: 'Owner' })).toHaveCount(0);
  await roles.getByRole('radio', { name: 'Read-only' }).check();
  await expect(roles.getByRole('radio', { name: 'Editor' })).not.toBeChecked();
  await roles.getByRole('radio', { name: 'Editor' }).check();
  await expect(roles.getByRole('radio', { name: 'Read-only' })).not.toBeChecked();
  await captureScreen(page, 'team-03-users-invite-sheet', BOTH);
  await dialog.getByRole('button', { name: 'Invite user' }).click();
  // e2e runs with the console email transport, so the link is shown on screen, once, with focus on Copy.
  const reveal = page.getByRole('region', { name: `Invitation link for ${INVITEE_EMAIL}` });
  await expect(reveal.getByText("Email isn't set up on this server")).toBeVisible();
  const link = await reveal.getByLabel('Invitation link').inputValue();
  expect(link).toMatch(/\/admin\/accept-invitation#token=/);
  expect(page.url()).not.toContain('token');
  await expect(reveal.getByRole('button', { name: /Copy/ })).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Pending invitations' }).getByText(INVITEE_EMAIL),
  ).toBeVisible();
  await captureScreen(page, 'team-03a-users-invitation-link', BOTH);
  saveInviteLink(link);
  await reveal.getByRole('button', { name: "I've copied it" }).click();
  await expect(reveal).toHaveCount(0);
});

test('a pending invitation gets a new link after an inline confirmation, then is revoked', async () => {
  const email = 'temp@example.com';
  await page.getByRole('button', { name: 'Invite user' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite a user' });
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('button', { name: 'Invite user' }).click();
  const reveal = page.getByRole('region', { name: `Invitation link for ${email}` });
  const first = await reveal.getByLabel('Invitation link').inputValue();
  await reveal.getByRole('button', { name: "I've copied it" }).click();

  const invitations = page.getByRole('region', { name: 'Pending invitations' });
  await invitations.getByRole('button', { name: `Copy link: ${email}` }).click();
  const relink = page.getByRole('alertdialog', { name: `Create a new link for ${email}?` });
  await expect(relink.getByText('This creates a new link; any earlier link stops working.')).toBeVisible();
  await expect(relink.getByRole('button', { name: 'Create link' })).toBeFocused();
  await relink.getByRole('button', { name: 'Create link' }).click();
  const second = await reveal.getByLabel('Invitation link').inputValue();
  expect(second).toMatch(/#token=/);
  expect(second).not.toBe(first);
  await expect(reveal.getByRole('button', { name: /Copy/ })).toBeFocused();
  await reveal.getByRole('button', { name: "I've copied it" }).click();

  await invitations.getByRole('button', { name: `Revoke: ${email}` }).click();
  const confirm = page.getByRole('alertdialog', { name: `Revoke the invitation for ${email}?` });
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await captureScreen(page, 'team-03b-users-revoke-invitation', BOTH);
  await confirm.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Invitation revoked.')).toBeVisible();
  await expect(invitations.getByText(email)).toHaveCount(0);
  await expect(invitations.getByText(INVITEE_EMAIL)).toBeVisible();
});

test('settings → profile, with dirty-state protection', async () => {
  await page.goto(`${ADMIN_URL}settings`);
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
  await captureScreen(page, 'team-04-settings-profile', { viewports: ['desktop'] });

  await page.getByLabel('Name').fill('Ada King');
  await settingsLink('Sessions').click();
  await expect(page.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await captureScreen(page, 'team-05-unsaved-changes', { viewports: ['desktop'] });
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  await page.getByLabel('Name').fill(OWNER.name);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile saved.').first()).toBeVisible();
});

test('settings → sessions lists this device', async () => {
  await settingsLink('Sessions').click();
  await expect(page.getByText('This device')).toBeVisible();
  await captureScreen(page, 'team-06-settings-sessions', { viewports: ['desktop'] });
});

test('settings → appearance switches and remembers the choice', async () => {
  await settingsLink('Appearance').click();
  await captureScreen(page, 'team-07-settings-theme', { viewports: ['desktop'] });
  const html = page.locator('html');
  await page.getByRole('radio', { name: 'Snowed' }).click();
  await expect(html).toHaveAttribute('data-theme', 'snowed');
  await expect(html).not.toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'snowed');
  await page.getByRole('radio', { name: 'Shapio' }).click();
  await expect(html).toHaveAttribute('data-theme', 'shapio');
  await expect(html).toHaveClass(/\bdark\b/);
});

test('settings → locales lists the default locale', async () => {
  await settingsLink('Locales').click();
  await expect(page.getByRole('cell', { name: /Default/ })).toBeVisible();
  await captureScreen(page, 'team-08-settings-locales', { viewports: ['desktop'] });
});

test('settings → roles: built-ins plus a new custom role', async () => {
  await page.goto(`${ADMIN_URL}network/roles`);
  await expect(page.getByRole('cell', { name: /Owner/ })).toBeVisible();
  await captureScreen(page, 'team-09-settings-roles', { viewports: ['desktop'] });
  await page.getByRole('button', { name: 'New role' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create role' });
  await dialog.getByLabel('Name').fill('Reviewer');
  await dialog.getByLabel('Key', { exact: true }).fill('reviewer');
  await dialog.getByLabel('Read entries').check();
  await dialog.getByLabel('Read the audit log').check();
  await captureScreen(page, 'team-10-settings-role-sheet', { viewports: ['desktop'] });
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Role created.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Reviewer Custom' })).toBeVisible();
});

test('settings → API tokens: created, shown once, listed, revoked', async () => {
  await page.goto(`${ADMIN_URL}settings/api-tokens`);
  await expect(page.getByText('No API tokens yet.')).toBeVisible();
  await captureScreen(page, 'team-11-settings-api-tokens-empty', { viewports: ['desktop'] });
  await page.getByRole('button', { name: 'New token' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create API token' });
  await dialog.getByLabel('Name').fill('Marketing site build');
  await dialog.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'Reviewer' }).click();
  await dialog.getByRole('button', { name: 'Create' }).click();
  // The secret is shown inline above the list, with focus on its copy button, and never in the URL.
  const secret = page.getByRole('region', { name: 'Copy your new token' });
  await expect(secret.getByLabel('Token')).toHaveValue(/^shp_/);
  await expect(secret.getByRole('button', { name: /Copy/ })).toBeFocused();
  expect(page.url()).not.toContain('shp_');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Marketing site build', exact: true })).toBeVisible();
  await captureScreen(page, 'team-12-settings-api-token-secret', BOTH);
  await secret.getByRole('button', { name: "I've copied it" }).click();
  await expect(secret).toHaveCount(0);
  await captureScreen(page, 'team-13-settings-api-tokens', { viewports: ['desktop'] });

  await page.getByRole('button', { name: 'Revoke: Marketing site build' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Revoke Marketing site build?' });
  await confirm.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Token revoked.')).toBeVisible();
  await expect(page.getByRole('row', { name: /Marketing site build/ })).toContainText('Revoked');
});

test('settings → audit log shows the changes just made, filterable', async () => {
  await page.goto(`${ADMIN_URL}network/audit-log`);
  // Actions read as words; the code stays in the cell's title.
  await expect(page.getByRole('cell', { name: 'Completed setup', exact: true })).toHaveAttribute(
    'title',
    'setup.complete',
  );
  // Actors are shown by name, with their email beneath.
  await expect(page.getByRole('cell', { name: `${OWNER.name} ${OWNER.email}` }).first()).toBeVisible();
  await captureScreen(page, 'team-14-settings-audit-log', { viewports: ['desktop'] });
  await page.getByLabel('Filter by action').fill('role.create');
  await page.getByLabel('Filter by action').press('Enter');
  await expect(page).toHaveURL(/action=role.create/);
  await expect(page.getByRole('cell', { name: 'Completed setup', exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Created role', exact: true })).toBeVisible();
});
