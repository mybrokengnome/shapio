import { expect, test, type Page } from '@playwright/test';
import type { AdminApi } from './content/api';
import type { ProjectServer } from './content/projectServer';
import {
  expectFocusTrappedIn,
  expectFullTabCycle,
  expectVisibleFocus,
  inBothSchemes,
  resetFocusToTop,
  tabTo,
} from './support/keyboard';
import { createKeyboardHelpers, openKeyboardSuite } from './support/keyboardSuite';

/**
 * Keyboard-only use of the content type builder: create a type from the sidebar, add a field with the type
 * picker, review and apply. After the first page.goto nothing is clicked: only Tab, arrows, Enter, Space and Escape. Every
 * focus stop must show a visible indicator in light and dark, Tab must cycle through each page without a
 * trap, the review sheet must hold focus, and Escape must return focus to the control that opened a sheet or
 * added a field it discards.
 * Runs on its own server (a fresh database).
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

let server: ProjectServer;
let page: Page;
let api: AdminApi;
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  ({ server, page, api } = await openKeyboardSuite(browser, 'keyboardModels', pageErrors));
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page?.context().close();
  await server?.stop();
});

const { escapeBackTo } = createKeyboardHelpers(() => page);

test('content type builder: create a type and add a field with the keyboard only', async () => {
  await page.goto(server.adminUrl);
  await expect(page.getByRole('heading', { level: 1, name: /^Welcome/ })).toBeVisible();
  await inBothSchemes(page, () => expectFullTabCycle(page));

  // "+ New content type" is a sidebar link to its own page.
  const newType = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'New content type' });
  await resetFocusToTop(page);
  await tabTo(page, newType, { max: 30 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'New content type' })).toBeVisible();
  await inBothSchemes(page, () => expectFullTabCycle(page));
  const create = page.getByRole('main');
  await resetFocusToTop(page);
  await tabTo(page, create.getByLabel('Label', { exact: true }), { max: 60 });
  await page.keyboard.type('Keyboard Book');
  await expect(create.getByLabel('API ID', { exact: true })).toHaveValue('keyboardBook');
  await tabTo(page, create.getByRole('button', { name: 'Create' }), { max: 12 });
  await page.keyboard.press('Enter');
  // It opens in the Structure tab of its new place.
  await expect(page).toHaveURL(/\/content\/keyboardBook\?tab=structure$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Keyboard Book' })).toBeVisible();

  await inBothSchemes(page, () => expectFullTabCycle(page));
  const addField = page.getByRole('button', { name: 'Add field' });
  await resetFocusToTop(page);
  await tabTo(page, addField, { max: 100 });
  await page.keyboard.press('Enter');
  // "Add field" adds a field at once with its label focused; Escape discards it while untouched and focus
  // returns to "Add field".
  const label = page.getByRole('region', { name: / properties$/ }).getByLabel('Label', { exact: true });
  await expect(label).toBeFocused();
  await expectVisibleFocus(page, '(new field label)');
  await escapeBackTo(page.getByRole('region', { name: 'New field properties' }), addField);
  await page.keyboard.press('Enter');
  await expect(label).toBeFocused();
  await expect(label).toHaveValue('New field');
  await page.keyboard.type('Blurb');
  await expect(label).toHaveValue('Blurb');
  await inBothSchemes(page, () => expectFullTabCycle(page));
  // The type grid sits above the label: Shift+Tab enters it at the selected type, arrows choose another.
  await resetFocusToTop(page);
  await tabTo(page, label, { max: 110 });
  const panel = page.getByRole('region', { name: 'Blurb properties' });
  const shortText = panel.getByRole('radio', { name: /^Short text/ });
  await tabTo(page, shortText, { max: 3, backwards: true });
  await expect(shortText).toBeChecked();
  // Radix checks the radio it moves focus to only while the arrow key is still down (focus moves on the
  // next task), so hold the key as a person does rather than sending keydown and keyup back to back.
  const longText = panel.getByRole('radio', { name: /^Long text/ });
  await page.keyboard.down('ArrowDown');
  await expect(longText).toBeFocused();
  await page.keyboard.up('ArrowDown');
  await expect(longText).toBeChecked();
  await expectVisibleFocus(page, '(type grid)');

  const review = page.getByRole('button', { name: 'Review', exact: true });
  await resetFocusToTop(page);
  await tabTo(page, review, { max: 100 });
  await page.keyboard.press('Enter');
  const plan = page.getByRole('dialog', { name: /^Review changes to / });
  await expect(plan).toBeVisible();
  await inBothSchemes(page, () => expectFocusTrappedIn(page, plan));
  await tabTo(page, plan.getByRole('button', { name: 'Ship now' }), { max: 10 });
  await page.keyboard.press('Enter');
  await expect(plan).toBeHidden();
  await expect(page.getByText('Model updated — no restart needed').first()).toBeVisible();
  await inBothSchemes(page, () => expectFullTabCycle(page));

  const models = await api.get<{
    items: { definition: { apiKey: string; fields: { apiKey: string; label: string; type: string }[] } }[];
  }>('/models');
  const book = models.items.find((item) => item.definition.apiKey === 'keyboardBook');
  expect(book?.definition.fields).toEqual([
    expect.objectContaining({ apiKey: 'blurb', label: 'Blurb', type: 'text' }),
  ]);
});
