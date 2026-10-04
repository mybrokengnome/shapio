import { expect, test, type Page } from '@playwright/test';
import { OWNER } from './support/accounts';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { signInAsOwner } from './support/session';

/**
 * The signed-in shell: sidebar groups (no "Models" for anyone), the ⌘K palette, phone layout, direct deep
 * links (SPA fallback under BASE_PATH) and the import map runtime editors use. The editor-only sidebar is
 * in inbox.spec.ts (it needs content and a second account).
 * The admin*.spec.ts files run in name order (Playwright sorts files): admin1Setup does first-run setup,
 * admin3Team sends the invitation admin4Auth accepts.
 */
test.describe.configure({ mode: 'serial' });

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

test('the sidebar: Inbox, places, Media, Publishing, Develop and Workspace; never "Models"', async () => {
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Inbox' })).toHaveAttribute('aria-current', 'page');
  // No content types yet: the places list is only the "+ New" row (the owner may create types).
  await expect(nav.getByRole('list', { name: 'Content' }).getByRole('link')).toHaveText(['New content type']);
  for (const name of ['Media', 'Publishing', 'Changes', 'Settings']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  const develop = nav.getByRole('list', { name: 'Develop' });
  for (const name of ['Snapshots', 'Schema as code', 'Components', 'API explorer', 'Live', 'API tokens']) {
    await expect(develop.getByRole('link', { name, exact: true })).toBeVisible();
  }
  const workspace = nav.getByRole('list', { name: 'Workspace' });
  for (const name of ['App users', 'Locales', 'Settings']) {
    await expect(workspace.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole('link', { name: /models/i })).toHaveCount(0);
  await expect(develop.getByRole('link', { name: 'Changes' })).toHaveCount(0);
  await expect(nav.locator('[aria-disabled="true"]')).toHaveCount(0);
  await captureScreen(page, 'shell-00-sidebar-admin', { viewports: ['desktop'] });
});

test('"+ New content type" opens the create page; old /models URLs redirect', async () => {
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'New content type' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New content type' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'New content type' })).toHaveAttribute('aria-current', 'page');
  await page.goto(`${ADMIN_URL}models/new`);
  await expect(page).toHaveURL(/\/content\/new$/);
  await page.goto(`${ADMIN_URL}models/new?kind=component`);
  await expect(page).toHaveURL(/\/develop\/components\/new$/);
  await expect(page.getByRole('heading', { level: 1, name: 'New component' })).toBeVisible();
  await page.goto(`${ADMIN_URL}models?tab=components`);
  await expect(page).toHaveURL(/\/develop\/components$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Components' })).toBeVisible();
});

test('the palette opens with ⌘K anywhere and is driven by the keyboard', async () => {
  await page.goto(`${ADMIN_URL}settings/sessions`);
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  const opener = page.getByRole('link', { name: 'Profile' });
  await opener.focus();
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Search and commands' });
  const input = palette.getByRole('combobox', { name: /Search places/ });
  await expect(input).toBeFocused();
  await expect(palette.getByRole('group', { name: 'Create' })).toBeVisible();
  await expect(palette.getByRole('group', { name: 'Go to' })).toBeVisible();
  await captureScreen(page, 'shell-03-palette', { viewports: ['desktop', 'phone'] });
  // Escape closes it and focus goes back where it was.
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  await expect(opener).toBeFocused();

  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('locales');
  const first = palette.getByRole('option').first();
  await expect(first).toHaveText(/Locales/);
  await expect(input).toHaveAttribute('aria-activedescendant', (await first.getAttribute('id')) ?? '');
  await captureScreen(page, 'shell-04-palette-search', { viewports: ['desktop'] });
  // ↓ and ↑ move the highlight (wrapping), Enter opens it.
  const options = palette.getByRole('option');
  if ((await options.count()) > 1) {
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowUp');
  }
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'Locales' })).toBeVisible();

  // What was opened comes back as a recent item; the sidebar's search button opens the palette too.
  await page.getByRole('button', { name: 'Search or jump to…' }).click();
  await expect(
    palette.getByRole('group', { name: 'Recent' }).getByRole('option', { name: /Locales/ }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
});

test('a nested admin URL loads directly (SPA fallback under BASE_PATH)', async () => {
  await page.goto(`${ADMIN_URL}settings/sessions`);
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
});

/** Picks a look in the account menu's Theme submenu (sidebar footer or phone bar). */
const chooseTheme = async (name: string) => {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Theme' }).hover();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
};

test('the shell works at phone width', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(ADMIN_URL);
  await expect(page.getByRole('heading', { name: `Welcome, ${OWNER.name}` })).toBeVisible();
  await captureScreen(page, '17-home-mobile');
  // The phone bar's account menu holds the looks too.
  await chooseTheme('Snowed');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'snowed');
  await chooseTheme('Shapio');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'shapio');
  await page.getByRole('button', { name: 'Toggle sidebar' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Sidebar' })).toBeVisible();
  await captureScreen(page, '18-sidebar-mobile');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1360, height: 900 });
});

const navLink = (name: string) =>
  page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name });

test('desktop shell: status bar, a visible collapse control and the looks in the account menu', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ADMIN_URL);
  await expect(page.getByRole('heading', { name: `Welcome, ${OWNER.name}` })).toBeVisible();
  // No top bar: the status bar says the schema is live.
  const statusBar = page.locator('[data-slot="status-bar"]');
  await expect(statusBar).toContainText(/Schema v\d+ · live, no restart needed/);
  await captureScreen(page, 'shell-01-home', { viewports: ['desktop', 'phone'] });
  await navLink('Media').click();
  await expect(statusBar).toContainText('Media');

  // The rail is pointer-only, so the sidebar header has a real button to collapse it.
  const sidebar = page.locator('[data-slot="sidebar"]');
  const toggle = page.getByRole('button', { name: 'Toggle sidebar' }).first();
  await toggle.click();
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  await captureScreen(page, 'shell-02-sidebar-collapsed', { viewports: ['desktop'] });
  await toggle.click();
  await expect(sidebar).toHaveAttribute('data-state', 'expanded');

  // The look lives in the account menu: one list, kept across a reload; nothing else to switch.
  const html = page.locator('html');
  await chooseTheme('Snowed');
  await expect(html).toHaveAttribute('data-theme', 'snowed');
  await expect(html).not.toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'snowed');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Theme' }).hover();
  await expect(page.getByRole('menuitemradio', { name: 'Snowed' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Switch to (light|dark) theme/ })).toHaveCount(0);
  await chooseTheme('Shapio');
  await expect(html).toHaveAttribute('data-theme', 'shapio');
  await expect(html).toHaveClass(/\bdark\b/);
  await page.setViewportSize({ width: 1360, height: 900 });
});

test('the import map shares React, ReactDOM and the editor SDK with runtime editors', async () => {
  const shared = await page.evaluate(async () => {
    const importModule = (specifier: string) =>
      import(/* @vite-ignore */ specifier) as Promise<Record<string, unknown>>;
    const react = await importModule('react');
    const runtime = await importModule('react/jsx-runtime');
    const client = await importModule('react-dom/client');
    const sdk = await importModule('@shapio/editor-sdk');
    // A runtime "editor" with state, rendered by the shared ReactDOM: proves one working React instance.
    const host = document.createElement('div');
    document.body.append(host);
    const useState = react.useState as (value: number) => [number, unknown];
    const jsx = runtime.jsx as (type: unknown, props: Record<string, unknown>) => unknown;
    const Editor = () => {
      const [value] = useState(42);
      return jsx('output', { id: 'runtime-editor', children: String(value) });
    };
    const root = (client.createRoot as (node: Element) => { render: (node: unknown) => void })(host);
    (react.startTransition as (fn: () => void) => void)(() => root.render(jsx(Editor, {})));
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      rendered: document.getElementById('runtime-editor')?.textContent ?? null,
      sdk: typeof sdk.defineEditor,
      version: react.version,
    };
  });
  expect(shared).toEqual({ rendered: '42', sdk: 'function', version: expect.stringMatching(/^19\./) });
});
