import { expect, test, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * Approval on change sets (plan approval) against the real API: the site setting, asking for approval with a
 * note, approving with a note, the chip, banner and timeline, shipping once approved, and an edit after
 * approval that makes it outdated. Captured at 1440 and 390 in light and dark with axe. The setting is turned
 * off again at the end, so later specs ship without approval.
 */
test.describe.configure({ mode: 'serial' });

const MODEL_KEY = 'approvalPost';
const SET_TITLE = 'Approval: spring launch';
const BOTH = { viewports: ['desktop', 'phone'] } as const;

let page: Page;
let setId = '';
let entryId = '';

const getJson = async <T>(path: string): Promise<T> => {
  const response = await page.request.get(`${ADMIN_API}${path}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
};

const setRequireApproval = async (requireApproval: boolean) => {
  const current = await getJson<{ version: number }>('/site/change-sets');
  await adminRequest(page.request, 'PUT', '/site/change-sets', {
    expectedVersion: current.version,
    requireApproval,
  });
};

const editTitle = async (title: string) => {
  const entry = await getJson<{ version: number }>(`/content/${MODEL_KEY}/${entryId}`);
  await adminRequest(page.request, 'PUT', `/content/${MODEL_KEY}/${entryId}`, {
    expectedVersion: entry.version,
    data: { title },
  });
};

/** The approval chip in the set's header (the timeline below repeats the same labels). */
const approvalChip = (label: string) =>
  page.locator('[data-slot="status-chip"]', { hasText: new RegExp(`^${label}$`) }).first();

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
  const created = await adminRequest(page.request, 'POST', `/content/${MODEL_KEY}`, {
    data: { title: 'Spring is here' },
  });
  entryId = ((await created.json()) as { id: string }).id;
  const set = await adminRequest(page.request, 'POST', '/change-sets', { title: SET_TITLE });
  setId = ((await set.json()) as { id: string }).id;
  await adminRequest(page.request, 'POST', `/change-sets/${setId}/items`, {
    modelKey: MODEL_KEY,
    entryId,
    action: 'publish',
  });
});

test.afterAll(async () => {
  await setRequireApproval(false);
  await page.context().close();
});

test('Settings → Change sets turns on approval for the site', async () => {
  await page.goto(`${ADMIN_URL}settings/change-sets`);
  await expect(page.getByRole('heading', { level: 1, name: 'Change sets' })).toBeVisible();
  const toggle = page.getByRole('switch', { name: 'Require an approved change set before shipping' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await captureScreen(page, 'approval-01-settings', BOTH);
});

test('a set that is not approved cannot ship; asking for approval shows who asked and the note', async () => {
  await page.goto(`${ADMIN_URL}changes/${setId}`);
  await expect(page.getByRole('heading', { level: 1, name: SET_TITLE })).toBeVisible();
  await expect(page.getByText('This site requires approval')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ship', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: 'Request approval' }).click();
  const popover = page.getByRole('dialog', { name: 'Ask for approval' });
  await popover.getByLabel('Note (optional)').fill('Please check the headline before Friday.');
  await popover.getByRole('button', { name: 'Request approval' }).click();
  await expect(popover).toBeHidden();
  await expect(approvalChip('Approval requested')).toBeVisible();
  await expect(page.getByText('Please check the headline before Friday.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ship', exact: true })).toBeDisabled();
  await captureScreen(page, 'approval-02-requested', BOTH);
});

test('approving with a note lets the set ship; the timeline records both steps', async () => {
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const popover = page.getByRole('dialog', { name: 'Approve this change set, or say what to change' });
  await popover.getByLabel('Note', { exact: true }).fill('Headline looks good.');
  await popover.getByRole('button', { name: 'Approve' }).click();
  await expect(popover).toBeHidden();
  await expect(approvalChip('Approved')).toBeVisible();
  await expect(page.getByText('Headline looks good.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ship', exact: true })).toBeEnabled();
  await captureScreen(page, 'approval-03-approved', BOTH);

  await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
  await expect(page.getByText('Approval requested', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Please check the headline before Friday.')).toBeVisible();
  await captureScreen(page, 'approval-04-timeline', BOTH);
});

test('an edit after approval makes it outdated and stops the ship until approved again', async () => {
  await editTitle('Spring is finally here');
  await page.reload();
  await expect(approvalChip('Approval outdated')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ship', exact: true })).toBeDisabled();
  await captureScreen(page, 'approval-05-outdated', BOTH);

  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Approve this change set, or say what to change' })
    .getByRole('button', { name: 'Approve' })
    .click();
  await expect(approvalChip('Approved')).toBeVisible();
  const ship = page.getByRole('button', { name: 'Ship', exact: true });
  await expect(ship).toBeEnabled();
  await ship.click();
  await page
    .getByRole('alertdialog', { name: `Ship “${SET_TITLE}”?` })
    .getByRole('button', { name: 'Ship' })
    .click();
  await expect(page.getByText(/^Shipped as v\d+ by /)).toBeVisible({ timeout: 30_000 });
  await expect(approvalChip('Approved')).toBeVisible();
});
