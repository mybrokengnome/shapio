import { expect, type Browser, type Locator, type Page } from '@playwright/test';
import { adminApiFor, type AdminApi } from '../content/api';
import { startProjectServer, type ProjectServer } from '../content/projectServer';
import { OWNER } from './accounts';
import { expectVisibleFocus, waitForAnimations } from './keyboard';

/**
 * Shared setup for the keyboard-only specs (keyboardContent, keyboardModels, keyboardMedia). Each runs on
 * its own server (a fresh database), so the other specs' "starts empty" screens are unaffected.
 */
export type KeyboardSuite = { server: ProjectServer; page: Page; api: AdminApi };

/** Starts a project server named `name`, creates the owner and returns a signed-in 1440×900 page. */
export const openKeyboardSuite = async (
  browser: Browser,
  name: string,
  pageErrors: string[],
): Promise<KeyboardSuite> => {
  const server = await startProjectServer(name);
  const setupContext = await browser.newContext();
  const setup = await setupContext.request.post(`${server.adminApi}/setup`, {
    data: { name: OWNER.name, email: OWNER.email, password: OWNER.password },
  });
  expect(setup.ok(), await setup.text()).toBe(true);
  await setupContext.close();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const response = await page.request.post(`${server.adminApi}/auth/login`, {
    data: { email: OWNER.email, password: OWNER.password },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return { server, page, api: adminApiFor(page.request, server.adminApi) };
};

/** Focus helpers bound to the suite's page (read lazily: the page exists only after beforeAll). */
export const createKeyboardHelpers = (getPage: () => Page) => {
  /** Presses ↓ until `target` has focus (it may have it already, as a menu's first item), checking the indicator. */
  const arrowTo = async (target: Locator, max = 5) => {
    const page = getPage();
    for (let press = 0; press <= max; press += 1) {
      // Radix moves focus on the next task after the key (or after opening).
      const reached = await expect(target)
        .toBeFocused({ timeout: 300 })
        .then(() => true)
        .catch(() => false);
      if (reached) {
        await expectVisibleFocus(page, '(arrow keys)');
        return;
      }
      await page.keyboard.press('ArrowDown');
    }
    throw new Error(`${target.toString()} not reached with the arrow keys`);
  };

  /** Escape closes the open dialog or popover and focus lands back on the control that opened it. */
  const escapeBackTo = async (overlay: Locator, trigger: Locator) => {
    const page = getPage();
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
    await expect(trigger).toBeFocused();
    await waitForAnimations(page);
    await expectVisibleFocus(page, '(after Escape)');
  };

  return { arrowTo, escapeBackTo };
};
