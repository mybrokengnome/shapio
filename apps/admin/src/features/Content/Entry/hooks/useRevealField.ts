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

/**
 * Takes a person to a value (a pre-flight "Fix" link): opens the settings drawer when the field is a
 * property that isn't on the page, then scrolls to it and focuses its control. An image without alt text
 * focuses that image's alt input.
 */
export const useRevealField = (idPrefix: string, openProperty: (apiKey: string) => void) =>
  useCallback(
    (path: string, assetId?: string) => {
      const apiKey = path.split('/')[1] ?? '';
      const focus = () => {
        const target = elementFor(path);
        if (!target) {
          return false;
        }
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const image = assetId
          ? target.querySelector<HTMLElement>(`[data-media-id="${CSS.escape(assetId)}"] [data-alt-input]`)
          : null;
        const control =
          image ??
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
