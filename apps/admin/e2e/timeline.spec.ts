import { expect, test, type Browser, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';

/**
 * The time scrubber (Snapshots → Timeline) against the real API: four snapshots of one place (two
 * publishes, an update, an unpublish), scrubbed with the keyboard. Cards show what was live at each
 * snapshot and how it moved since the one before (new, changed, removed); "Open this version" opens the
 * entry's history at that revision; "Restore to here" creates the restore change set. Captured at three
 * positions, 1440 and 390, light and dark, with axe.
 */
test.describe.configure({ mode: 'serial' });

const MODEL_KEY = 'tlNote';
const BOTH = { viewports: ['desktop', 'phone'] } as const;

let page: Page;
const pageErrors: string[] = [];
let alphaId = '';
let bravoId = '';
let latest = 0;

const openSession = async (browser: Browser) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const opened = await context.newPage();
  opened.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(opened);
  return opened;
};

const getJson = async <T>(path: string): Promise<T> => {
  const response = await page.request.get(`${ADMIN_API}${path}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
};

const createPublished = async (title: string) => {
  const created = await adminRequest(page.request, 'POST', `/content/${MODEL_KEY}`, {
    data: { title },
    publish: true,
  });
  return ((await created.json()) as { id: string }).id;
};

test.beforeAll(async ({ browser }) => {
  page = await openSession(browser);
  await adminRequest(page.request, 'POST', '/models', {
    definition: {
      kind: 'collection',
      apiKey: MODEL_KEY,
      pluralApiKey: 'tlNotes',
      label: 'Field note',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string', required: true }],
    },
  });
  alphaId = await createPublished('Alpha');
  bravoId = await createPublished('Bravo');
  const alpha = await getJson<{ version: number }>(`/content/${MODEL_KEY}/${alphaId}`);
  await adminRequest(page.request, 'PUT', `/content/${MODEL_KEY}/${alphaId}`, {
    expectedVersion: alpha.version,
    data: { title: 'Alpha, revised' },
  });
  await adminRequest(page.request, 'POST', `/content/${MODEL_KEY}/${alphaId}/publish`, { locales: ['en'] });
  await adminRequest(page.request, 'POST', `/content/${MODEL_KEY}/${bravoId}/unpublish`, { locales: ['en'] });
  latest = (await getJson<{ current: number }>('/snapshots')).current;
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page.context().close();
});

const place = () => page.getByRole('region', { name: 'Field note' });
const card = (title: string, state: string) => place().getByRole('listitem', { name: `${title}, ${state}` });
const slider = () => page.getByRole('slider', { name: 'Snapshot' });

test('the timeline shows the place at the newest snapshot: an unpublished entry is marked removed', async () => {
  await page.goto(`${ADMIN_URL}snapshots/${latest}?tab=timeline`);
  await expect(slider()).toHaveAttribute('aria-valuetext', `v${latest}`);
  await expect(page.getByText(`v${latest} ·`, { exact: false })).toBeVisible();
  await expect(card('Bravo', 'Removed')).toBeVisible();
  await expect(card('Alpha, revised', 'Live')).toBeVisible();
  await captureScreen(page, 'timeline-01-latest', BOTH);
});

test('stepping back one snapshot shows the update as changed; the URL keeps the position', async () => {
  await slider().focus();
  await page.keyboard.press('ArrowLeft');
  await expect(slider()).toHaveAttribute('aria-valuetext', `v${latest - 1}`);
  await expect(card('Alpha, revised', 'Changed')).toBeVisible();
  await expect(page.getByText(`1 entry changed since v${latest - 2}`, { exact: false })).toBeVisible();
  await expect(card('Bravo', 'Live')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`at=${latest - 1}`));
  await captureScreen(page, 'timeline-02-changed', BOTH);
});

test('the first snapshot of the place has only the first entry, new; the second is absent', async () => {
  await slider().focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(slider()).toHaveAttribute('aria-valuetext', `v${latest - 3}`);
  await expect(card('Alpha', 'New')).toBeVisible();
  await expect(place().getByRole('listitem', { name: /^Bravo/ })).toHaveCount(0);
  await captureScreen(page, 'timeline-03-first', BOTH);
});

test('"Open this version" opens the entry\'s history at the revision it served then', async () => {
  await card('Alpha', 'New')
    .getByRole('button', { name: /^Open the version of/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/content/${MODEL_KEY}/${alphaId}\\?.*revision=`));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.goBack();
  await expect(slider()).toHaveAttribute('aria-valuetext', `v${latest - 3}`);
});

test('"Restore to here" creates the restore change set and opens it', async () => {
  const seq = latest - 3;
  await page.getByRole('button', { name: 'Restore to here' }).click();
  const confirm = page.getByRole('alertdialog', { name: `Restore v${seq}?` });
  await expect(confirm).toContainText(`puts the content back to v${seq}. Nothing is deleted.`);
  await confirm.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Restore snapshot ${seq}` })).toBeVisible();
});
