import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Keyboard-only helpers: walk focus with Tab, check that every stop shows a visible focus indicator, and
 * prove there is no keyboard trap. Pointer input is never used.
 */
export const SCHEMES = ['light', 'dark'] as const;
/** Tab stops a single element may keep (the segments of a native date-time input) before it is a trap. */
const MAX_SEGMENTS = 4;
export type Scheme = (typeof SCHEMES)[number];

type FocusReport = {
  /** A readable description of the focused element (tag, role, name). */
  label: string;
  /** A stable number per element (kept on the element), to spot repeats and wrapping. */
  key: number;
  onBody: boolean;
  visible: boolean;
  inViewport: boolean;
  /** Why the indicator was judged missing (empty when visible). */
  reason: string;
};

/**
 * Inspects document.activeElement. The indicator is visible when the element, or one of its nearest
 * ancestors (rings drawn with focus-within on a wrapper), has an outline or box-shadow that differs from
 * the same element unfocused. The unfocused state is read from a clone inserted beside it (a clone never
 * has focus, so :focus, :focus-visible and :focus-within do not match). Options and menu items follow the
 * ARIA pattern of a highlighted row, so a background change counts for them too. Running transitions are
 * finished first so the ring is read at its final value.
 */
const inspectFocus = (): FocusReport => {
  type Tagged = Window & { __kbKeys?: WeakMap<Element, number>; __kbNext?: number };
  const win = window as Tagged;
  win.__kbKeys ??= new WeakMap();
  win.__kbNext ??= 1;
  const active = document.activeElement;
  // Past the last control Tab leaves the page for the browser's own UI (the document loses focus but keeps
  // its activeElement); the next Tab comes back to the top.
  if (!active || active === document.body || active === document.documentElement || !document.hasFocus()) {
    return { label: 'body', key: 0, onBody: true, visible: true, inViewport: true, reason: '' };
  }
  let key = win.__kbKeys.get(active);
  if (key === undefined) {
    key = win.__kbNext;
    win.__kbNext += 1;
    win.__kbKeys.set(active, key);
  }
  const name =
    active.getAttribute('aria-label') ??
    (active.getAttribute('aria-labelledby')
      ? document.getElementById(active.getAttribute('aria-labelledby')?.split(' ')[0] ?? '')?.textContent
      : null) ??
    (active as HTMLInputElement).labels?.[0]?.textContent ??
    active.textContent ??
    '';
  const role = active.getAttribute('role');
  const label = `${active.tagName.toLowerCase()}${role ? `[role=${role}]` : ''} "${name.trim().replace(/\s+/g, ' ').slice(0, 60)}"`;

  const isTransparent = (color: string) =>
    color === 'transparent' || /rgba?\([^)]*,\s*0\)$/.test(color) || / \/ 0\)$/.test(color);
  // Only transitions: keyframe animations (spinners, skeletons) can be infinite and are not focus styles.
  const finishTransitions = (element: Element) => {
    for (const animation of element.getAnimations()) {
      if (animation instanceof CSSTransition) {
        animation.finish();
      }
    }
  };
  const highlightRows = new Set(['option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem']);
  const snapshot = (element: Element, withBackground: boolean) => {
    const style = getComputedStyle(element);
    const outline =
      style.outlineStyle !== 'none' &&
      parseFloat(style.outlineWidth) > 0 &&
      !isTransparent(style.outlineColor)
        ? `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`
        : 'none';
    return {
      outline,
      boxShadow: style.boxShadow,
      background: withBackground ? style.backgroundColor : '',
    };
  };
  const unfocused = (element: Element, withBackground: boolean) => {
    const clone = element.cloneNode(true) as Element;
    for (const node of [clone, ...clone.querySelectorAll('[id]')]) {
      node.removeAttribute('id');
    }
    clone.setAttribute('aria-hidden', 'true');
    clone.setAttribute('inert', '');
    element.after(clone);
    finishTransitions(clone);
    const result = snapshot(clone, withBackground);
    clone.remove();
    return result;
  };
  const candidates: Element[] = [];
  for (let node: Element | null = active; node && candidates.length < 4; node = node.parentElement) {
    if (node === document.body) {
      break;
    }
    candidates.push(node);
  }
  const reasons: string[] = [];
  let visible = false;
  for (const candidate of candidates) {
    finishTransitions(candidate);
    const withBackground = highlightRows.has(candidate.getAttribute('role') ?? '');
    const focused = snapshot(candidate, withBackground);
    const before = unfocused(candidate, withBackground);
    const outlineShown = focused.outline !== 'none' && focused.outline !== before.outline;
    const ringShown = focused.boxShadow !== 'none' && focused.boxShadow !== before.boxShadow;
    const backgroundShown =
      withBackground && !isTransparent(focused.background) && focused.background !== before.background;
    if (outlineShown || ringShown || backgroundShown) {
      visible = true;
      break;
    }
    reasons.push(
      `${candidate.tagName.toLowerCase()}${candidate.matches(':focus-visible') ? ':focus-visible' : ''}${candidate.matches(':focus') ? ':focus' : ''}: outline ${focused.outline}, shadow ${focused.boxShadow} (unfocused ${before.boxShadow})`,
    );
  }
  const rect = active.getBoundingClientRect();
  const inViewport =
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth;
  return { label, key, onBody: false, visible, inViewport, reason: reasons.join(' | ') };
};

/** The focused element's report, asserting a visible indicator inside the viewport. */
export const expectVisibleFocus = async (page: Page, context = ''): Promise<FocusReport> => {
  const report = await page.evaluate(inspectFocus);
  if (!report.onBody) {
    expect(report.visible, `no visible focus indicator on ${report.label} ${context}: ${report.reason}`).toBe(
      true,
    );
    expect(report.inViewport, `focused ${report.label} is outside the viewport ${context}`).toBe(true);
  }
  return report;
};

/** Waits until opening and closing animations (dialogs sliding or fading in) have finished. */
export const waitForAnimations = (page: Page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity,
      ),
  );

const isFocused = (target: Locator) =>
  target.evaluate((element) => element === document.activeElement).catch(() => false);

/**
 * Presses Tab (or Shift+Tab) until `target` has focus, checking the indicator at every stop on the way.
 * Fails when the target is not reached within `max` presses.
 */
export const tabTo = async (
  page: Page,
  target: Locator,
  { max = 60, backwards = false }: { max?: number; backwards?: boolean } = {},
) => {
  const stops: string[] = [];
  for (let press = 0; press < max; press += 1) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
    const report = await expectVisibleFocus(page, `(on the way to ${target.toString()})`);
    stops.push(report.label);
    if (await isFocused(target)) {
      return stops;
    }
  }
  throw new Error(
    `${target.toString()} not reached by keyboard in ${max} presses; stops: ${stops.join(' → ')}`,
  );
};

/** Removes focus and scrolls to the top, so the next Tab starts from the beginning of the document. */
export const resetFocusToTop = async (page: Page) => {
  await page.evaluate(() => {
    // Blurring alone keeps the browser's sequential-navigation starting point where focus was; focusing
    // a throwaway element at the very start of the document moves it to the top.
    const start = document.createElement('span');
    start.tabIndex = -1;
    document.body.prepend(start);
    start.focus();
    start.remove();
    window.getSelection()?.removeAllRanges();
    window.scrollTo(0, 0);
  });
};

/**
 * Tabs through the whole page from the top, checking every stop's indicator, and proves focus is never
 * trapped: within `max` presses it must leave the last element and come back to the first (or to the
 * document). Revisiting any other element before that means focus is stuck in a widget.
 */
export const expectFullTabCycle = async (page: Page, { max = 250 }: { max?: number } = {}) => {
  await resetFocusToTop(page);
  const seen: number[] = [];
  const labels: string[] = [];
  let stay = 0;
  for (let press = 0; press < max; press += 1) {
    await page.keyboard.press('Tab');
    const report = await expectVisibleFocus(page, '(full tab cycle)');
    if (report.onBody || report.key === seen[0]) {
      expect(seen.length, 'Tab never reached a focusable element').toBeGreaterThan(0);
      return labels;
    }
    // Native date and time inputs move between their segments with Tab: a few stops on one element.
    if (report.key === seen.at(-1)) {
      stay += 1;
      expect(stay, `keyboard trap: Tab keeps focus on ${report.label}`).toBeLessThanOrEqual(MAX_SEGMENTS);
      continue;
    }
    stay = 0;
    expect(
      seen,
      `keyboard trap: ${report.label} came back before the cycle ended (${labels.join(' → ')})`,
    ).not.toContain(report.key);
    seen.push(report.key);
    labels.push(report.label);
  }
  throw new Error(`Tab did not wrap within ${max} presses: ${labels.join(' → ')}`);
};

/**
 * Inside a modal dialog focus must be trapped by design: Tab cycles through the dialog's controls only,
 * coming back to where it started, each stop with a visible indicator.
 */
export const expectFocusTrappedIn = async (
  page: Page,
  dialog: Locator,
  { max = 80 }: { max?: number } = {},
) => {
  await waitForAnimations(page);
  const start = await expectVisibleFocus(page, '(dialog start)');
  const seen = new Set<number>([start.key]);
  for (let press = 0; press < max; press += 1) {
    await page.keyboard.press('Tab');
    const report = await expectVisibleFocus(page, '(inside dialog)');
    expect(
      await dialog.evaluate((element) => element.contains(document.activeElement)),
      `focus left the dialog to ${report.label}`,
    ).toBe(true);
    if (seen.has(report.key)) {
      return;
    }
    seen.add(report.key);
  }
  throw new Error(`Focus did not cycle inside the dialog within ${max} presses`);
};

/** Runs `check` in light and in dark (the admin follows the OS preference by default). */
export const inBothSchemes = async (page: Page, check: (scheme: Scheme) => Promise<unknown>) => {
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('html')).toHaveClass(scheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b).*$/);
    await check(scheme);
  }
  await page.emulateMedia({ colorScheme: 'light' });
};
