import { expect, test, type Browser, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * Approval workflows on change sets (plan approval-workflows) against the real API: the network default with
 * two stages, the site inheriting it, asking for approval, a sign-off by the owner (Editorial, anyone who may
 * approve) and one by a second admin who holds the Legal role, the stage strip moving between them, the
 * reason Approve is off for someone without the role, the Inbox for the second admin, shipping once approved,
 * and the site switching approval off. Captured at 1440 and 390 in light and dark with axe. The network
 * default and the site are put back at the end, so later specs ship without approval.
 */
test.describe.configure({ mode: 'serial' });

const MODEL_KEY = 'approvalPost';
const SET_TITLE = 'Approval: spring launch';
const LEGAL_ROLE = 'Legal reviewer';
const REVIEWER = {
  name: 'Grace Hopper',
  email: 'grace.approval@example.com',
  password: 'cobol-compiler-1959',
};
const BOTH = { viewports: ['desktop', 'phone'] } as const;

let page: Page;
let reviewer: Page;
let setId = '';

const getJson = async <T>(path: string): Promise<T> => {
  const response = await page.request.get(`${ADMIN_API}${path}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
};

/** A new draft entry in a new set, ready to ship. */
const createSetWithEntry = async (title: string, entryTitle: string) => {
  const created = await adminRequest(page.request, 'POST', `/content/${MODEL_KEY}`, {
    data: { title: entryTitle },
  });
  const entryId = ((await created.json()) as { id: string }).id;
  const set = await adminRequest(page.request, 'POST', '/change-sets', { title });
  const newSetId = ((await set.json()) as { id: string }).id;
  await adminRequest(page.request, 'POST', `/change-sets/${newSetId}/items`, {
    modelKey: MODEL_KEY,
    entryId,
    action: 'publish',
  });
  return { setId: newSetId };
};

/** Invites the reviewer with the Legal role and signs them in, in a browser of their own. */
const signInReviewer = async (browser: Browser, roleId: string) => {
  const invitation = await adminRequest(page.request, 'POST', '/invitations', {
    email: REVIEWER.email,
    roleIds: [roleId],
  });
  const { id } = (await invitation.json()) as { id: string };
  const link = await adminRequest(page.request, 'POST', `/invitations/${id}/link`);
  const { acceptUrl } = (await link.json()) as { acceptUrl: string };
  const token = decodeURIComponent(acceptUrl.split('#token=')[1] ?? '');
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const reviewerPage = await context.newPage();
  const { csrfToken } = (await (await reviewerPage.request.get(`${ADMIN_API}/auth/csrf`)).json()) as {
    csrfToken: string;
  };
  const accepted = await reviewerPage.request.post(`${ADMIN_API}/invitations/accept`, {
    headers: { 'x-csrf-token': csrfToken },
    data: { token, name: REVIEWER.name, password: REVIEWER.password },
  });
  expect(accepted.ok(), await accepted.text()).toBe(true);
  return reviewerPage;
};

/** The approval chip in the set's header (the timeline and the strip repeat some of its words). */
const approvalChip = (target: Page, label: string) =>
  target.locator('[data-slot="status-chip"]', { hasText: new RegExp(`^${label}$`) }).first();

const approvalPanel = (target: Page) => target.getByRole('region', { name: 'Approval' });

const stage = (number: number) => page.getByRole('group', { name: `Stage ${number}` });

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  await signInAsOwner(page);
  await adminRequest(page.request, 'POST', '/models', {
    definition: {
      kind: 'collection',
      apiKey: MODEL_KEY,
      label: 'Approval post',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string', required: true }],
    },
  });
  ({ setId } = await createSetWithEntry(SET_TITLE, 'Spring is here'));
  // The Legal stage's role: it may prepare and approve change sets, and read what they hold.
  const global = (action: string) => ({ action, modelId: null, condition: null, fieldIds: null });
  const role = await adminRequest(page.request, 'POST', '/roles', {
    key: 'legal-reviewer',
    name: LEGAL_ROLE,
    kind: 'admin',
    permissions: [global('read'), global('changes.manage'), global('changes.approve')],
  });
  reviewer = await signInReviewer(browser, ((await role.json()) as { id: string }).id);
});

test.afterAll(async () => {
  // Nothing requires approval after this spec: the network default off, the site inheriting it.
  const network = await getJson<{ version: number }>('/network/approval');
  await adminRequest(page.request, 'PUT', '/network/approval', {
    expectedVersion: network.version,
    workflow: null,
  });
  const site = await getJson<{ version: number }>('/site/change-sets');
  await adminRequest(page.request, 'PUT', '/site/change-sets', {
    expectedVersion: site.version,
    mode: 'inherit',
  });
  await reviewer.context().close();
  await page.context().close();
});

test('Network → Approval sets a two-stage default every site inherits', async () => {
  await page.goto(`${ADMIN_URL}network/approval`);
  await expect(page.getByRole('heading', { level: 1, name: 'Approval' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Off' })).toBeChecked();
  await page.getByRole('radio', { name: 'Workflow' }).click();

  // An empty stage is refused inline; the first stage is anyone who may approve.
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(stage(1).getByText('This field is required.')).toBeVisible();
  await stage(1).getByLabel('Name', { exact: true }).fill('Editorial');
  await expect(stage(1).getByText('Anyone who may approve change sets')).toBeVisible();

  await page.getByRole('button', { name: 'Add stage' }).click();
  await stage(2).getByLabel('Name', { exact: true }).fill('Legal');
  await stage(2).getByRole('checkbox', { name: LEGAL_ROLE }).click();
  await page.getByRole('switch', { name: 'People may approve their own change sets' }).click();
  await captureScreen(page, 'approval-01-network-default', BOTH);

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.getByText(/sites? inherits? this default\./)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Workflow' })).toBeChecked();
  await expect(stage(2).getByLabel('Name', { exact: true })).toHaveValue('Legal');
  await expect(stage(2).getByRole('checkbox', { name: LEGAL_ROLE })).toBeChecked();
});

test('Settings → Change sets shows the site inheriting the default', async () => {
  await page.goto(`${ADMIN_URL}settings/change-sets`);
  await expect(page.getByRole('heading', { level: 1, name: 'Change sets' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Network default' })).toBeChecked();
  const stages = page.getByRole('list', { name: 'Stages' });
  await expect(stages.getByText('1. Editorial')).toBeVisible();
  await expect(stages.getByText('2. Legal')).toBeVisible();
  await expect(stages.getByText(`${LEGAL_ROLE} · 1 sign-off needed`)).toBeVisible();
  await captureScreen(page, 'approval-02-site-inherits', BOTH);
});

test('asking for approval starts at the first stage; the owner signs Editorial and the strip moves on', async () => {
  await page.goto(`${ADMIN_URL}changes/${setId}`);
  await expect(page.getByRole('heading', { level: 1, name: SET_TITLE })).toBeVisible();
  const panel = approvalPanel(page);
  await expect(panel.getByText('This site requires approval')).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Stages' })).toHaveText(/1\s*Editorial.*2\s*Legal/);
  await expect(page.getByRole('button', { name: 'Ship', exact: true })).toBeDisabled();

  await panel.getByRole('button', { name: 'Request approval' }).click();
  const request = page.getByRole('dialog', { name: 'Ask for approval' });
  await request.getByLabel('Note (optional)').fill('Please check the headline before Friday.');
  await request.getByRole('button', { name: 'Request approval' }).click();
  await expect(request).toBeHidden();
  await expect(approvalChip(page, 'In review · Editorial 0/1')).toBeVisible();
  await expect(panel.getByText('Please check the headline before Friday.')).toBeVisible();

  await panel.getByRole('button', { name: 'Review', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Approve this change set, or say what to change' });
  await review.getByLabel('Note', { exact: true }).fill('Copy reads well.');
  await review.getByRole('button', { name: 'Approve' }).click();
  await expect(review).toBeHidden();
  await expect(approvalChip(page, 'In review · Legal 0/1')).toBeVisible();
  const strip = panel.getByRole('list', { name: 'Stages' });
  await expect(strip.getByRole('listitem').first()).toContainText('complete');
  await expect(strip.locator('[aria-current="step"]')).toContainText('Legal');
  await expect(panel.getByText(/signed off at Editorial$/)).toBeVisible();

  // The owner doesn't hold the Legal role: Approve is off, and the hint says who may sign.
  await expect(panel.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'More about Approve' }).click();
  await expect(
    page.getByRole('dialog').getByText(`Only ${LEGAL_ROLE} may sign off at this stage.`),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Ship', exact: true })).toBeDisabled();
  await captureScreen(page, 'approval-03-in-review', BOTH);
});

test('the Legal reviewer sees the set in the Inbox, signs the last stage, and the set ships', async () => {
  await reviewer.goto(ADMIN_URL);
  const awaiting = reviewer.locator('section', {
    has: reviewer.getByRole('heading', { level: 3, name: 'Awaiting your approval' }),
  });
  const row = awaiting.getByRole('listitem').filter({ hasText: SET_TITLE });
  await expect(row).toContainText('Legal 0/1');
  await row.getByRole('link', { name: 'Review' }).click();
  await expect(reviewer.getByRole('heading', { level: 1, name: SET_TITLE })).toBeVisible();

  await approvalPanel(reviewer).getByRole('button', { name: 'Review', exact: true }).click();
  const review = reviewer.getByRole('dialog', { name: 'Approve this change set, or say what to change' });
  await review.getByRole('button', { name: 'Approve' }).click();
  await expect(review).toBeHidden();
  await expect(approvalChip(reviewer, 'Approved')).toBeVisible();

  await page.reload();
  await expect(approvalChip(page, 'Approved')).toBeVisible();
  await expect(approvalPanel(page).getByText(`${REVIEWER.name} signed off at Legal`)).toBeVisible();
  await captureScreen(page, 'approval-04-approved', BOTH);
  const ship = page.getByRole('button', { name: 'Ship', exact: true });
  await expect(ship).toBeEnabled();
  await ship.click();
  await page
    .getByRole('alertdialog', { name: `Ship “${SET_TITLE}”?` })
    .getByRole('button', { name: 'Ship' })
    .click();
  await expect(page.getByText(/^Shipped as v\d+ by /)).toBeVisible({ timeout: 30_000 });

  await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
  await expect(page.getByText('Signed off · Editorial 1 of 1')).toBeVisible();
  await expect(page.getByText('Stage complete · Legal')).toBeVisible();
  await captureScreen(page, 'approval-05-timeline', BOTH);
});

test('a site that switches approval off ships change sets without it', async () => {
  await page.goto(`${ADMIN_URL}settings/change-sets`);
  await page.getByRole('radio', { name: 'Off' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Off' })).toBeChecked();
  await captureScreen(page, 'approval-06-site-off', BOTH);
  const effective = await getJson<{ mode: string; effective: unknown }>('/site/change-sets');
  expect(effective).toMatchObject({ mode: 'off', effective: null });

  const next = await createSetWithEntry('Approval: no review needed', 'Summer is near');
  await page.goto(`${ADMIN_URL}changes/${next.setId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Approval: no review needed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ship', exact: true })).toBeEnabled();
  await expect(approvalPanel(page)).toHaveCount(0);
});
