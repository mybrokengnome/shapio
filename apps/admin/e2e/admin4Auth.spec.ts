import { expect, test, type Page } from '@playwright/test';
import { adminApiFor } from './content/api';
import { NEW_PASSWORD, OWNER } from './support/accounts';
import { captureScreen, type ViewportName } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { endAdminSessions } from './support/database';
import { readInviteLink } from './support/inviteLink';
import { logOffset, waitForEmailedLink } from './support/serverLog';
import { ADMIN_API, signInAsOwner } from './support/session';

/**
 * Signing out and in, deep links behind sign-in, accepting an invitation, password reset and the not-found
 * page, against the real API.
 * The admin*.spec.ts files run in name order (Playwright sorts files): admin1Setup does first-run setup,
 * admin3Team sends the invitation admin4Auth accepts.
 */
test.describe.configure({ mode: 'serial' });

const AUTH_VIEWPORTS: ViewportName[] = ['desktop', 'phone'];

const INVITEE = { name: 'Grace Hopper', email: 'grace@example.com', password: 'cobol-and-compilers-1959' };

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

const signOut = async () => {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
};

const signIn = async (email: string, password: string) => {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
};

test('sign out, then sign in rejects a wrong password inline', async () => {
  await page.goto(ADMIN_URL);
  await signOut();
  await captureScreen(page, 'auth-03-login', { viewports: AUTH_VIEWPORTS });
  await signIn(OWNER.email, 'not-the-password');
  await expect(page.getByRole('alert')).toContainText("That email and password don't match an account.");
  await captureScreen(page, 'auth-04-login-error');
  await signIn(OWNER.email, OWNER.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${OWNER.name}` })).toBeVisible();
});

test('signed-out visitors to a deep link sign in and land where they were going', async () => {
  await signOut();
  await page.goto(`${ADMIN_URL}settings/roles`);
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await signIn(OWNER.email, OWNER.password);
  await expect(page).toHaveURL(/\/network\/roles$/);
  await signOut();
});

test('accepting an invitation creates the account and signs it in', async () => {
  const link = readInviteLink();
  expect(link).toContain('#token=');
  await page.goto(link);
  await expect(page.getByText(`You're joining as ${INVITEE.email}.`)).toBeVisible();
  // The token is read from the fragment, then removed from the address bar and history.
  await expect(page).toHaveURL(/\/accept-invitation$/);
  await captureScreen(page, 'auth-05-accept-invitation', { viewports: AUTH_VIEWPORTS });
  await page.getByLabel('Name').fill(INVITEE.name);
  await page.getByLabel('Password', { exact: true }).fill(INVITEE.password);
  await page.getByLabel('Confirm password').fill(INVITEE.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${INVITEE.name}` })).toBeVisible();
  // An editor can't manage users: the item is hidden (and the API refuses anyway).
  await expect(
    page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Users' }),
  ).toHaveCount(0);
  await signOut();
});

test('password reset: request, emailed link, new password, sign in', async () => {
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await captureScreen(page, 'auth-06-forgot-password', { viewports: AUTH_VIEWPORTS });
  const offset = logOffset();
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await captureScreen(page, 'auth-07-forgot-password-sent');
  await page.goto(await waitForEmailedLink('reset-password', offset));
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
  await captureScreen(page, 'auth-08-reset-password', { viewports: AUTH_VIEWPORTS });
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByLabel('Confirm password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();
  await captureScreen(page, 'auth-09-reset-password-done');
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await signIn(OWNER.email, NEW_PASSWORD);
  await expect(page.getByRole('heading', { name: `Welcome, ${OWNER.name}` })).toBeVisible();
});

test('a reset link without its token explains what to do', async () => {
  await page.goto(`${ADMIN_URL}reset-password`);
  await expect(page.getByText('This reset link is incomplete.', { exact: false })).toBeVisible();
  await captureScreen(page, 'auth-10-reset-password-missing-token');
});

test('unknown routes show the not-found page', async () => {
  await page.goto(`${ADMIN_URL}no-such-page`);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await captureScreen(page, 'auth-11-not-found', { viewports: AUTH_VIEWPORTS });
});

test('a screen that fails to load shows the error page with a way back home', async () => {
  // A code chunk that can't be fetched (removed by a deploy, a dropped connection) makes the route throw.
  const chunk = '**/assets/publishing-*.js';
  await page.route(chunk, (route) => route.abort());
  await page.goto(`${ADMIN_URL}publishing`);
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await captureScreen(page, 'auth-12-route-error', { viewports: AUTH_VIEWPORTS });
  await page.unroute(chunk);
  await page.getByRole('link', { name: 'Back home' }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${OWNER.name}` })).toBeVisible();
});

test('a session that ends over unsaved edits signs in again in place, and the edits save', async () => {
  const password = await signInAsOwner(page);
  const api = adminApiFor(page.request, ADMIN_API);
  // No draft-and-publish, so no autosave: the edits stay unsaved until ⌘S.
  await api.createDefinition('models', {
    kind: 'collection',
    apiKey: 'jotting',
    label: 'Jotting',
    draftAndPublish: false,
    fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
  });
  const memo = await api.send<{ id: string }>('POST', '/content/jotting', { data: { title: 'Saved title' } });
  const memoUrl = `${ADMIN_URL}content/jotting/${memo.id}`;
  await page.goto(memoUrl);
  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toHaveValue('Saved title');

  // Signing out over unsaved edits asks first; staying keeps them.
  await title.fill('Typed before signing out');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const discard = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Keep editing' }).click();
  await expect(discard).toBeHidden();
  await expect(title).toHaveValue('Typed before signing out');

  // The session ends elsewhere (expiry, "sign out everywhere"); the next save gets a 401.
  await endAdminSessions(OWNER.email);
  await title.fill('Typed after the session ended');
  await page.keyboard.press('ControlOrMeta+s');
  const panel = page.getByRole('dialog', { name: 'Your session has ended' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(`Signing in as ${OWNER.email}`)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/content/jotting/${memo.id}`));
  await expect(title).toHaveValue('Typed after the session ended');
  await captureScreen(page, 'auth-13-session-ended-in-place', { viewports: AUTH_VIEWPORTS });

  // A wrong password is covered by the panel's unit test: failed sign-ins count towards the account's rate
  // limit, which the specs after this one share.
  await panel.getByLabel('Password').fill(password);
  await panel.getByRole('button', { name: 'Sign in' }).click();
  await expect(panel).toBeHidden();
  // The save that failed runs again by itself.
  await expect(page.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Typed after the session ended');
});
