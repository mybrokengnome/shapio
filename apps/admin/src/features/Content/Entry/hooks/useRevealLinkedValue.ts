import { useEffect, useRef } from 'react';
import type { LinkedValue } from '@/fields/form/context';

type Reveal = (path: string, assetId?: string, linkedEntryId?: string) => void;

/**
 * Goes to the value the URL opened the entry at, once per link, after the document has rendered: scrolls to
 * the field (opening the settings drawer for a property) and focuses the linked entry's row in a relation.
 */
export const useRevealLinkedValue = (
  linkedValue: LinkedValue | undefined,
  reveal: Reveal,
  ready: boolean,
) => {
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!linkedValue || !ready) {
      return;
    }
    const key = `${linkedValue.path}|${linkedValue.entryId ?? ''}`;
    if (revealed.current === key) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      revealed.current = key;
      reveal(linkedValue.path, undefined, linkedValue.entryId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [linkedValue, reveal, ready]);
};
