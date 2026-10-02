import { expect, test, type Browser, type Page } from '@playwright/test';
import { captureScreen } from './support/capture';
import { ADMIN_URL } from './support/constants';
import { seedMediaReference } from './support/database';
import { createPng } from './support/png';
import { ADMIN_API, signInAsOwner } from './support/session';

/**
 * The media library against the real API (local storage, inline worker): upload (picker and drop) with the
 * two-step grant flow, variants made in the background, alt text and visibility, folders named in place,
 * bulk move from a popover, and deletion confirmed inline, blocked while content uses a file, then forced
 * by the owner. Captured in light and dark with axe.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
const pageErrors: string[] = [];
const HERO = 'hero.png';
const DOC = 'terms.pdf';

const openSession = async (browser: Browser) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const opened = await context.newPage();
  opened.on('pageerror', (error) => pageErrors.push(error.message));
  await signInAsOwner(opened);
  return opened;
};

test.beforeAll(async ({ browser }) => {
  page = await openSession(browser);
});

test.afterEach(() => {
  expect(pageErrors.splice(0)).toEqual([]);
});

test.afterAll(async () => {
  await page.context().close();
});

const toast = (text: string) => page.getByText(text).first();
const details = () => page.getByRole('dialog', { name: HERO });
const card = (name: string) => page.getByRole('button', { name: `Open ${name}` });

const assetIdOf = async (name: string) => {
  const response = await page.request.get(`${ADMIN_API}/media/assets?search=${encodeURIComponent(name)}`);
  const body = (await response.json()) as { items: { id: string; filename: string }[] };
  const asset = body.items.find((item) => item.filename === name);
  if (!asset) {
    throw new Error(`No asset named ${name}`);
  }
  return asset.id;
};

test('the Media library is in the sidebar and starts empty', async () => {
  await page.goto(ADMIN_URL);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Media' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Media' })).toBeVisible();
  await expect(page.getByText('No media yet')).toBeVisible();
  await captureScreen(page, 'media-01-empty', { viewports: ['desktop'] });
});

test('uploads with the file picker and by dropping, with progress, then checks the bytes', async () => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await (await chooser).setFiles({ name: HERO, mimeType: 'image/png', buffer: createPng(1600, 900) });

  // Dropping files anywhere on the library uploads them too.
  const dataTransfer = await page.evaluateHandle((name) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['%PDF-1.7\n%%EOF\n'], name, { type: 'application/pdf' }));
    return transfer;
  }, DOC);
  const dropTarget = page.getByRole('searchbox', { name: 'Search media' });
  await dropTarget.dispatchEvent('dragenter', { dataTransfer });
  await expect(page.getByText('Drop files to upload')).toBeVisible();
  await dropTarget.dispatchEvent('drop', { dataTransfer });

  // Once every upload is done the queue collapses to one line; it can be opened to see each file.
  const queue = page.getByRole('region', { name: 'Uploads' });
  await expect(queue.getByText('2 uploaded')).toBeVisible({ timeout: 20_000 });
  await expect(card(HERO)).toBeVisible();
  await expect(card(DOC)).toBeVisible();
  await queue.getByRole('button', { name: 'Show finished uploads' }).click();
  await expect(queue.getByText('Uploaded', { exact: true })).toHaveCount(2);
  await queue.getByRole('button', { name: 'Hide finished uploads' }).click();
  await expect(queue.getByText('Uploaded', { exact: true })).toHaveCount(0);
  await captureScreen(page, 'media-02-grid', { viewports: ['desktop', 'phone'] });
  await queue.getByRole('button', { name: 'Clear finished' }).click();
  await expect(queue).toBeHidden();
});

test('a renamed executable is refused from its bytes and can be dismissed', async () => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const elf = Buffer.concat([
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
    Buffer.alloc(2048, 1),
  ]);
  await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: elf });
  const queue = page.getByRole('region', { name: 'Uploads' });
  await expect(queue.getByText(/not an allowed type/)).toBeVisible({ timeout: 20_000 });
  await expect(queue.getByRole('button', { name: 'Retry photo.png' })).toBeVisible();
  await captureScreen(page, 'media-03-upload-error', { viewports: ['desktop'] });
  await queue.getByRole('button', { name: 'Dismiss photo.png' }).click();
  await expect(queue).toBeHidden();
});

test('variants are made in the background and shown when ready; alt text is saved', async () => {
  await card(HERO).click();
  const sheet = details();
  await expect(sheet).toBeVisible();
  const sizes = sheet.getByRole('heading', { name: 'Sizes' }).locator('..');
  for (const label of ['Thumbnail', '640 px wide', '1280 px wide']) {
    await expect(sizes.getByRole('listitem').filter({ hasText: label }).getByText('Ready')).toBeVisible({
      timeout: 30_000,
    });
  }
  await expect(sheet.getByText('1600 × 900')).toBeVisible();

  await sheet.getByLabel('Alt text').fill('A blue gradient');
  await sheet.getByRole('button', { name: 'Save changes' }).click();
  await expect(toast('Details saved')).toBeVisible();
  await captureScreen(page, 'media-04-details', { viewports: ['desktop'] });

  // Visibility: the switch is confirmed beside it, and the line under it says what the setting means.
  await expect(sheet.getByText('Anyone with the link can open it.')).toBeVisible();
  await sheet.getByRole('switch', { name: 'Private' }).click();
  const makePrivate = page.getByRole('alertdialog', { name: 'Make this file private?' });
  await expect(makePrivate.getByText('Its public link stops working at once.')).toBeVisible();
  await makePrivate.getByRole('button', { name: 'Make private' }).click();
  await expect(toast('Visibility changed')).toBeVisible();
  await expect(sheet.getByRole('switch', { name: 'Private' })).toBeChecked();
  await expect(sheet.getByText('Opens only through signed links that expire.')).toBeVisible();

  await page.reload();
  await expect(details().getByLabel('Alt text')).toHaveValue('A blue gradient');
  await page.keyboard.press('Escape');
  await expect(details()).toBeHidden();
});

test('folders are named in place, renamed, deleted and assets moved into them in bulk', async () => {
  const folders = page.getByRole('navigation', { name: 'Folders' });
  await page.getByRole('button', { name: 'New folder' }).click();
  const name = folders.getByRole('textbox', { name: 'Name of the new folder' });
  await expect(name).toBeFocused();
  await name.fill('Brand');
  await captureScreen(page, 'media-05-folder-inline', { viewports: ['desktop', 'phone'] });
  await name.press('Enter');
  await expect(toast('Folder “Brand” created')).toBeVisible();
  await expect(name).toBeHidden();
  await expect(page.getByRole('button', { name: 'New folder' })).toBeFocused();

  // Escape cancels a row without creating anything.
  await page.getByRole('button', { name: 'New folder' }).click();
  await folders.getByRole('textbox', { name: 'Name of the new folder' }).fill('Nothing');
  await page.keyboard.press('Escape');
  await expect(folders.getByRole('textbox')).toHaveCount(0);
  await expect(folders.getByRole('button', { name: /^Nothing/ })).toHaveCount(0);

  // Rename from the folder's menu, then delete an empty folder from it: confirmed beside the menu button.
  await page.getByRole('button', { name: 'New folder' }).click();
  await folders.getByRole('textbox', { name: 'Name of the new folder' }).fill('Archive');
  await page.keyboard.press('Enter');
  await expect(toast('Folder “Archive” created')).toBeVisible();
  await folders.getByRole('button', { name: 'Actions for Archive' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = folders.getByRole('textbox', { name: 'New name for “Archive”' });
  await expect(rename).toBeFocused();
  await rename.fill('Old');
  await rename.press('Enter');
  await expect(toast('Folder renamed to “Old”')).toBeVisible();
  await folders.getByRole('button', { name: 'Actions for Old' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const deleteFolder = page.getByRole('alertdialog', { name: 'Delete “Old”?' });
  await expect(deleteFolder.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await captureScreen(page, 'media-06-folder-delete', { viewports: ['desktop'] });
  await deleteFolder.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(toast('Folder “Old” deleted')).toBeVisible();
  await expect(folders.getByRole('button', { name: /^Old/ })).toHaveCount(0);

  await folders.getByRole('button', { name: /^Brand/ }).click();
  await expect(page.getByText('This folder is empty')).toBeVisible();
  await captureScreen(page, 'media-07-empty-folder', { viewports: ['desktop'] });
  await folders.getByRole('button', { name: 'All media' }).click();

  // Shift-click selects a range: from the last ticked file to the clicked one.
  const tiles = page.getByRole('list', { name: '2 files' }).getByRole('button', { name: /^Open / });
  await page
    .getByRole('checkbox', { name: /^Select / })
    .first()
    .check();
  await tiles.last().click({ modifiers: ['Shift'] });
  await expect(page.getByText('2 files selected')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'Clear selection' }).click();

  await page.getByRole('checkbox', { name: `Select ${HERO}` }).check();
  await expect(page.getByText('1 file selected')).toBeVisible();
  await page.getByRole('button', { name: 'Move to…' }).click();
  const move = page.getByRole('dialog', { name: 'Move 1 file' });
  await expect(move.getByRole('button', { name: 'No folder' })).toBeFocused();
  await captureScreen(page, 'media-08-move-popover', { viewports: ['desktop', 'phone'] });
  await page.keyboard.press('ArrowDown');
  await expect(move.getByRole('button', { name: 'Brand' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toast('Moved 1 file')).toBeVisible();
  await expect(move).toBeHidden();

  await folders.getByRole('button', { name: /^Brand/ }).click();
  await expect(card(HERO)).toBeVisible();
  await expect(card(DOC)).toBeHidden();
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await captureScreen(page, 'media-09-folder-list', { viewports: ['desktop'] });
  await page.getByRole('button', { name: 'Grid view' }).click();
});

test('deleting a file content uses is blocked; the owner can delete it anyway', async () => {
  await seedMediaReference(await assetIdOf(HERO));
  await card(HERO).click();
  const sheet = details();
  await expect(sheet.getByText('Used by 2 entry versions.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Delete file' }).click();
  const confirm = page.getByRole('alertdialog', { name: `Delete “${HERO}”?` });
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await captureScreen(page, 'media-10-delete-confirm', { viewports: ['desktop', 'phone'] });
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

  // Content still uses it: only an owner may delete it anyway, in a blocking dialog.
  const blocked = page.getByRole('alertdialog', { name: 'This file is in use' });
  await expect(blocked.getByText('2 entry versions still use it.')).toBeVisible();
  await expect(confirm).toBeHidden();
  await captureScreen(page, 'media-11-delete-blocked', { viewports: ['desktop'] });
  await blocked.getByRole('button', { name: 'Delete anyway' }).click();
  await expect(toast(`Deleted ${HERO}`)).toBeVisible();
  await expect(details()).toBeHidden();
  await expect(card(HERO)).toBeHidden();
  const gone = await page.request.get(`${ADMIN_API}/media/assets?search=${HERO}`);
  expect(((await gone.json()) as { items: unknown[] }).items).toEqual([]);
});
