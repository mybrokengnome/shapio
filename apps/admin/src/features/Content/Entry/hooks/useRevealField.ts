import { useCallback } from 'react';
import { fieldDomId } from '@/fields/helpers/domIds';

const FOCUSABLE =
  'input:not([type="hidden"]), textarea, select, [contenteditable="true"], button[aria-expanded], button';

/** The element for a path, or the closest ancestor path that is on the page (a collapsed item's block). */
const elementFor = (path: string) => {
  const segments = path.split('/');
  for (let length = segments.length; length > 1; length -= 1) {
    const candidate = document.querySelector<HTMLElement>(
      `[data-field-path="${CSS.escape(segments.slice(0, length).join('/'))}"]`,
    );
    if (candidate) {
      return candidate;
    }
  }
  return null;
};

/** The control to focus inside a field's block: an image's alt input, a linked entry's row, or none. */
const itemIn = (block: HTMLElement, assetId: string | undefined, linkedEntryId: string | undefined) =>
  assetId
    ? block.querySelector<HTMLElement>(`[data-media-id="${CSS.escape(assetId)}"] [data-alt-input]`)
    : linkedEntryId
      ? block.querySelector<HTMLElement>(`[data-linked-entry="${CSS.escape(linkedEntryId)}"]`)
      : null;

/**
 * Takes a person to a value (a pre-flight "Fix" link, an Inbox link): opens the settings drawer when the
 * field is a property that isn't on the page, then scrolls to it and focuses its control. An image without
 * alt text focuses that image's alt input; a relation's linked entry focuses that entry's row.
 */
export const useRevealField = (idPrefix: string, openProperty: (apiKey: string) => void) =>
  useCallback(
    (path: string, assetId?: string, linkedEntryId?: string) => {
      const apiKey = path.split('/')[1] ?? '';
      const focus = () => {
        const target = elementFor(path);
        if (!target) {
          return false;
        }
        const item = itemIn(target, assetId, linkedEntryId);
        (item ?? target).scrollIntoView({ behavior: 'smooth', block: 'center' });
        const control =
          item ??
          document.getElementById(fieldDomId(idPrefix, path)) ??
          target.querySelector<HTMLElement>(FOCUSABLE);
        control?.focus({ preventScroll: true });
        return true;
      };
      if (!focus()) {
        openProperty(apiKey);
        // The drawer renders the row on the next frames.
        window.setTimeout(focus, 150);
      }
    },
    [idPrefix, openProperty],
  );
