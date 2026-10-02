import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { SCREENSHOT_DIR } from './constants';

const SCHEMES = ['light', 'dark'] as const;
const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

/** Every screenshot taken in this run, for the report. */
export const capturedScreenshots: string[] = [];

/** Named viewports for `captureScreen`'s `viewports` option (the redesign's acceptance sizes). */
export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

type CaptureOptions = {
  /**
   * Capture at each of these sizes (files `{name}-{viewport}-{scheme}.png`), then restore the page's own
   * size. Without it the current viewport is captured as `{name}-{scheme}.png`.
   */
  viewports?: readonly ViewportName[];
};

/**
 * Screenshots the current screen in light and dark (OS preference, which the default "system" theme follows)
 * and runs axe in both: no serious or critical violations allowed.
 */
export const captureScreen = async (page: Page, name: string, { viewports }: CaptureOptions = {}) => {
  if (!viewports) {
    await captureSchemes(page, name);
    return;
  }
  const original = page.viewportSize();
  for (const viewport of viewports) {
    await page.setViewportSize(VIEWPORTS[viewport]);
    await captureSchemes(page, `${name}-${viewport}`);
  }
  if (original) {
    await page.setViewportSize(original);
  }
};

const captureSchemes = async (page: Page, name: string) => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  // No stray hover state (tooltips, hover colours) in screenshots.
  await page.mouse.move(0, 0);
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('html')).toHaveClass(scheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b).*$/);
    // Let transitions and animations (theme switch, sheets, dialogs) finish before the screenshot and the
    // contrast checks, which would otherwise see half-faded colours.
    await page.waitForTimeout(100);
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== 'running'),
    );
    const path = join(SCREENSHOT_DIR, `${name}-${scheme}.png`);
    await page.screenshot({ path, fullPage: true });
    capturedScreenshots.push(path);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations
      .filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ''))
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        targets: violation.nodes.map((node) => node.target.join(' ')).slice(0, 5),
      }));
    expect(blocking, `axe violations on ${name} (${scheme})`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'light' });
};
