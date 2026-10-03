import { expect, test, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL, E2E_ORIGIN } from './support/constants';
import { ADMIN_API, adminRequest, signInAsOwner } from './support/session';
import { startVisualSite } from './support/visualSite';

/**
 * Preview and visual editing against the real API: a site on a second origin (a local stand-in running
 * @shapio/visual) opens beside the document; clicking its title or body focuses that field, a message from
 * anywhere but the frame is ignored, a save re-renders the frame, and a site without the SDK gets the notice.
 * Captured in light and dark, desktop and phone, with axe.
 */
test.describe.configure({ mode: 'serial' });

const MODEL_KEY = 'visualNote';
let page: Page;
const pageErrors: string[] = [];
let site: Awaited<ReturnType<typeof startVisualSite>>;
let modelId: string;
let entryId: string;
const connectionIds: string[] = [];

const connect = async (name: string, path: string) => {
  const created = (await (
    await adminRequest(page.request, 'POST', '/deployments/connections', {
      name,
      provider: 'generic_webhook',
      settings: { url: 'https://build.invalid/hook' },
      secrets: {},
      triggerPolicy: [],
      previewUrlTemplate: `${site.origin}${path}?id={entryId}#token={token}`,
    })
  ).json()) as { connection: { id: string } };
  connectionIds.push(created.connection.id);
};

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(page);
  site = await startVisualSite(E2E_ORIGIN);
  const model = (await (
    await adminRequest(page.request, 'POST', '/models', {
      definition: {
        kind: 'collection',
        apiKey: MODEL_KEY,
        pluralApiKey: 'visualNotes',
        label: 'Visual note',
        fields: [
          { apiKey: 'title', label: 'Title', type: 'string' },
          { apiKey: 'body', label: 'Body', type: 'richtext' },
        ],
      },
    })
  ).json()) as { definitionId: string };
  modelId = model.definitionId;
  const entry = (await (
    await adminRequest(page.request, 'POST', `/content/${MODEL_KEY}`, { data: { title: 'Hello preview' } })
  ).json()) as { id: string };
  entryId = entry.id;
  await connect('Visual site', '/preview/');
  await connect('Plain site', '/plain/');
  // The admin's CSP lists preview origins from a short-lived cache: wait until a fresh admin page frames the site.
  await expect
    .poll(async () => (await page.request.get(ADMIN_URL)).headers()['content-security-policy'] ?? '', {
      timeout: 30_000,
      intervals: [1_000],
    })
    .toContain(site.origin);
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  // Later specs expect no models and no connections.
  for (const id of connectionIds) {
    await adminRequest(page.request, 'DELETE', `/deployments/connections/${id}`);
  }
  if (modelId) {
    const { version } = (await (await page.request.get(`${ADMIN_API}/models/${modelId}`)).json()) as {
      version: number;
    };
    await adminRequest(page.request, 'DELETE', `/models/${modelId}?expectedVersion=${version}`);
  }
  await page.context().close();
  await site.close();
});

const pane = () => page.getByRole('region', { name: 'Preview' });
const frame = () => page.frameLocator('[data-preview-pane] iframe');

test('Preview opens the site beside the document, and a click on the title focuses it', async () => {
  await page.goto(`${ADMIN_URL}content/${MODEL_KEY}/${entryId}`);
  const button = page.getByRole('button', { name: 'Preview', exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(pane()).toBeVisible();
  await expect(frame().getByRole('heading', { name: 'Preview of the draft' })).toBeVisible();
  // The site said it runs @shapio/visual: no notice.
  await page.waitForTimeout(500);
  await expect(pane().getByText("The site isn't using @shapio/visual yet")).toBeHidden();

  await frame().getByRole('heading', { name: 'Preview of the draft' }).click();
  await expect(page.locator('[data-field-path="/title"]').getByRole('textbox')).toBeFocused();
});

test('a click on the body focuses the canvas field', async () => {
  await page.getByRole('button', { name: 'Preview', exact: true }).focus();
  await frame().getByText('The body of the story.').click();
  await expect(page.locator('[data-field-path="/body"] [contenteditable="true"]')).toBeFocused();
});

test('a focus message from anything but the frame is ignored', async () => {
  await page.getByRole('button', { name: 'Preview', exact: true }).focus();
  await page.evaluate((id) => {
    window.postMessage({ type: 'shapio:focus', v: 1, entryId: id, path: 'title' }, '*');
  }, entryId);
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeFocused();
});

test('a save re-renders the frame', async () => {
  const title = page.locator('[data-field-path="/title"]').getByRole('textbox');
  await title.fill('Hello preview, edited');
  await expect(frame().getByText(/Refreshed [1-9]\d* times/)).toBeVisible({ timeout: 15_000 });
});

test('the pane in light and dark, desktop and phone', async () => {
  await page.mouse.move(0, 0);
  await captureScreen(page, 'visual-01-preview-pane', { viewports: ['desktop', 'phone'] });
});

test('on a phone the preview is full screen, and the document slides in over it', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pane().getByRole('button', { name: 'Document' }).click();
  await expect(pane()).toBeHidden();
  const button = page.getByRole('button', { name: 'Preview', exact: true });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect(pane()).toBeVisible();
  // A click on the title in the frame brings the document back with the title focused.
  await frame().getByRole('heading', { name: 'Preview of the draft' }).click();
  await expect(pane()).toBeHidden();
  await expect(page.locator('[data-field-path="/title"]').getByRole('textbox')).toBeFocused();
  await button.click();
  await expect(pane()).toBeVisible();
  await page.setViewportSize({ width: 1360, height: 900 });
});

test('a site without @shapio/visual gets the notice', async () => {
  await pane().getByRole('combobox', { name: 'Site' }).click();
  await page.getByRole('option', { name: 'Plain site' }).click();
  await expect(pane().getByText("The site isn't using @shapio/visual yet")).toBeVisible({ timeout: 15_000 });
  await captureScreen(page, 'visual-02-sdk-missing', { viewports: ['desktop'] });
  await pane().getByRole('button', { name: 'Close the preview' }).click();
  await expect(pane()).toBeHidden();
});
