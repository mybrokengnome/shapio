import { expect, type Locator, type Page } from '@playwright/test';
import { createPng } from './png';

/**
 * The entry document (editor experience E1): a top bar, the title typed into the page, a properties strip,
 * the canvas of blocks, a non-modal settings drawer with every property, and publishing through a
 * pre-flight sheet. Specs that edit or publish entries go through these helpers.
 */
export const entryDocument = (page: Page) => {
  const field = (path: string): Locator => page.locator(`[data-field-path="${path}"]`);
  const settingsButton = () => page.getByRole('button', { name: 'Settings', exact: true });
  const drawer = () => page.locator('#entry-settings');

  const openSettings = async () => {
    if ((await settingsButton().getAttribute('aria-expanded')) !== 'true') {
      await settingsButton().click();
    }
    await expect(drawer()).toBeVisible();
    return drawer();
  };

  const closeSettings = async () => {
    if ((await settingsButton().getAttribute('aria-expanded')) === 'true') {
      await settingsButton().click();
    }
    await expect(drawer()).toBeHidden();
  };

  /** A property's editor, in the settings drawer (opened, and its row expanded, as needed). */
  const property = async (apiKey: string): Promise<Locator> => {
    await openSettings();
    const toggle = drawer().locator(`[data-property-row="${apiKey}"] > button`);
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click();
    }
    const editor = drawer().locator(`[data-field-path="/${apiKey}"]`);
    await expect(editor).toBeVisible();
    return editor;
  };

  /** The `+` after a canvas field (`final`: the always-visible one after the last), then a menu item. */
  const addBlock = async (item: string | RegExp, { after }: { after?: string } = {}) => {
    const trigger = after
      ? page.getByRole('button', { name: new RegExp(`^Add a block here \\(${after}`) })
      : page.getByRole('button', { name: 'Add a block, or just keep writing' });
    await trigger.click();
    await page
      .getByRole('menuitem', { name: item, exact: typeof item === 'string' })
      .first()
      .click();
  };

  /** Opens the pre-flight from Publish and returns the sheet. */
  const openPreflight = async () => {
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Ready to publish?' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Publish now' })).toBeVisible();
    return sheet;
  };

  /** Publishes through the pre-flight (which must have no errors) and waits for the toast. */
  const publish = async () => {
    const sheet = await openPreflight();
    await expect(sheet.getByRole('button', { name: 'Publish now' })).toBeEnabled();
    await sheet.getByRole('button', { name: 'Publish now' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText('Published.').first()).toBeVisible();
  };

  /** Drops a generated PNG onto an element, as a file dragged from the desktop. */
  const dropImage = async (target: Locator, name: string, width = 1200, height = 800) => {
    const box = await target.boundingBox();
    if (!box) {
      throw new Error('drop target is not visible');
    }
    const dataTransfer = await page.evaluateHandle(
      ({ base64, filename }) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], filename, { type: 'image/png' }));
        return transfer;
      },
      { base64: createPng(width, height).toString('base64'), filename: name },
    );
    const point = { clientX: box.x + box.width / 2, clientY: box.y + box.height - 4 };
    await target.dispatchEvent('dragenter', { dataTransfer, ...point });
    await target.dispatchEvent('dragover', { dataTransfer, ...point });
    await target.dispatchEvent('drop', { dataTransfer, ...point });
  };

  return {
    field,
    openSettings,
    closeSettings,
    property,
    addBlock,
    openPreflight,
    publish,
    dropImage,
    drawer,
  };
};
