import { expect, request, test, type Browser, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { signBody, startReceiver } from './support/receiver';
import { signInAsOwner } from './support/session';

/**
 * Publishing against the real API: the section and its sub-navigation, a webhook delivering a signed test to a local receiver (its signing secret shown once at
 * the top of the page, on create and on rotate), and a generic build-hook deployment whose run only reads
 * "Deployed" once the site's signed callback says so. Captured in light and dark with axe.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
const pageErrors: string[] = [];
let receiver: Awaited<ReturnType<typeof startReceiver>>;

const openSession = async (browser: Browser) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const opened = await context.newPage();
  opened.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(opened);
  return opened;
};

test.beforeAll(async ({ browser }) => {
  page = await openSession(browser);
  receiver = await startReceiver();
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page.context().close();
  await receiver.close();
});

const toast = (text: string | RegExp) => page.getByText(text).first();
const subNav = () => page.getByRole('navigation', { name: 'Publishing sections' });
/** Detail pages have a breadcrumb instead of the tabs. */
const crumb = (name: string) =>
  page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name, exact: true });
const DESKTOP = { viewports: ['desktop'] } as const;
const BOTH = { viewports: ['desktop', 'phone'] } as const;
const expectTab = (name: string) =>
  expect(subNav().getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');

test('Publishing is in the sidebar and opens the first section', async () => {
  await page.goto(ADMIN_URL);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Publishing' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Publishing' })).toBeVisible();
  for (const section of ['Scheduled', 'Webhooks', 'Deployments']) {
    await expect(subNav().getByRole('link', { name: section })).toBeVisible();
  }
  await expectTab('Scheduled');
  await expect(page.getByText('Nothing scheduled')).toBeVisible();
  await captureScreen(page, 'publishing-02-scheduled-empty', DESKTOP);
});

test('a webhook sends a signed test delivery and logs the attempt', async () => {
  await subNav().getByRole('link', { name: 'Webhooks' }).click();
  await page.getByRole('button', { name: 'New webhook' }).click();
  const create = page.getByRole('dialog', { name: 'New webhook' });
  await create.getByLabel('Name').fill('Local receiver');
  await create.getByLabel('URL').fill(receiver.url('/hook'));
  await create.getByRole('checkbox', { name: 'All entry events' }).check();
  await create.getByRole('switch', { name: 'Allow private network addresses' }).click();
  await captureScreen(page, 'publishing-09-webhook-create', BOTH);
  await create.getByRole('button', { name: 'Create' }).click();

  // The secret is shown once, at the top of the list it was created from, with focus on Copy.
  const reveal = page.getByRole('region', { name: 'Copy the signing secret' });
  await expect(create).toBeHidden();
  await expect(reveal.getByRole('button', { name: 'Copy' })).toBeFocused();
  const secret = await reveal.getByLabel('Signing secret').inputValue();
  expect(secret.length).toBeGreaterThan(16);
  expect(page.url()).not.toContain(secret);
  await captureScreen(page, 'publishing-10-webhook-secret', BOTH);
  await reveal.getByRole('button', { name: "I've copied it" }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Local receiver' })).toBeVisible();

  await page.getByRole('button', { name: 'Send test' }).click();
  await expect(toast(/Test delivery queued/)).toBeVisible();
  const delivered = await receiver.waitFor((request) => request.path === '/hook');
  const timestamp = Number(delivered.headers['x-shapio-timestamp']);
  expect(delivered.headers['x-shapio-signature']).toBe(signBody(secret, timestamp, delivered.body));
  expect(delivered.headers['x-shapio-event']).toBe('webhook.test');

  const row = page.getByRole('row', { name: /webhook\.test/ });
  await expect(row.getByText('Delivered')).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: 'Show or hide the attempts of webhook.test' }).click();
  await expect(page.getByText('HTTP 200')).toBeVisible();
  await captureScreen(page, 'publishing-11-webhook-deliveries', DESKTOP);

  // Rotating the secret is confirmed inline, then the new one is shown once at the top of this page.
  await page.getByRole('button', { name: 'Rotate secret' }).click();
  const rotate = page.getByRole('alertdialog', { name: 'Rotate the signing secret?' });
  await rotate.getByRole('button', { name: 'Rotate secret' }).click();
  const rotated = page.getByRole('region', { name: 'Copy the signing secret' });
  await expect(rotated.getByRole('button', { name: 'Copy' })).toBeFocused();
  const newSecret = await rotated.getByLabel('Signing secret').inputValue();
  expect(newSecret).not.toBe(secret);
  await rotated.getByRole('button', { name: "I've copied it" }).click();
  await expect(rotated).toBeHidden();

  await crumb('Webhooks').click();
  await expect(page.getByRole('link', { name: 'Local receiver' })).toBeVisible();
  await captureScreen(page, 'publishing-12-webhooks', DESKTOP);
});

test('a build hook run shows "Deployed" only after the signed callback', async () => {
  await subNav().getByRole('link', { name: 'Deployments' }).click();
  await page.getByRole('button', { name: 'New connection' }).click();
  const create = page.getByRole('dialog', { name: 'New deployment connection' });
  await create.getByLabel('Name').fill('Marketing site');
  await create.getByLabel('Build hook URL', { exact: true }).fill(receiver.url('/build'));
  await create.getByRole('switch', { name: 'Allow private network addresses' }).click();
  await create.getByRole('button', { name: 'Create' }).click();

  const reveal = page.getByRole('region', { name: 'Copy the signing secret' });
  const secret = await reveal.getByLabel('Signing secret').inputValue();
  await reveal.getByRole('button', { name: "I've copied it" }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Marketing site' })).toBeVisible();
  const callbackUrl = await page.getByLabel('Callback URL').inputValue();
  await captureScreen(page, 'publishing-13-connection', DESKTOP);

  await page.getByRole('button', { name: 'Deploy now' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Marketing site run' })).toBeVisible();
  const trigger = await receiver.waitFor((request) => request.path === '/build');
  const { runId } = JSON.parse(trigger.body) as { runId: string };
  expect(page.url()).toContain(runId);
  // Without a callback, Shapio doesn't know the outcome and must not claim one.
  await expect(page.getByText('Trigger sent · completion unknown').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Deployed', { exact: true })).toBeHidden();

  // The site calls back without any admin session: the signature is its only credential.
  const site = await request.newContext();
  const postCallback = async (status: 'building' | 'deployed', extra: Record<string, string> = {}) => {
    const body = JSON.stringify({ runId, status, ...extra });
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await site.post(callbackUrl, {
      data: body,
      headers: {
        'content-type': 'application/json',
        'x-shapio-timestamp': String(timestamp),
        'x-shapio-signature': signBody(secret, timestamp, body),
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  };
  await postCallback('building', { logUrl: 'https://ci.example.com/builds/42' });
  await expect(page.getByText('Building').first()).toBeVisible({ timeout: 20_000 });
  await postCallback('deployed', { siteUrl: 'https://www.example.com', message: 'Build 42 finished' });
  await site.dispose();

  const timeline = page.getByRole('list', { name: 'Timeline' });
  await expect(timeline.getByText('Deployed')).toBeVisible({ timeout: 20_000 });
  await expect(timeline.getByText('Building')).toBeVisible();
  await expect(timeline.getByText('Build 42 finished')).toBeVisible();
  await expect(page.getByRole('link', { name: /ci\.example\.com\/builds\/42/ })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  await captureScreen(page, 'publishing-14-run-deployed', DESKTOP);

  // The Deployments tab: the connection as a card with its latest run, and the runs of every connection.
  await crumb('Deployments').click();
  const card = page.getByRole('region', { name: 'Marketing site' });
  await expect(card.getByText('Deployed')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent runs' }).getByText('Deployed')).toBeVisible();
  await captureScreen(page, 'publishing-15-deployments', DESKTOP);
});
