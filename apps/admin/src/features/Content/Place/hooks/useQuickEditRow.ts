import { useCallback, useRef, useState } from 'react';
import type { FormValues } from '@/fields/helpers/values';
import { rowMoreId } from '../helpers/rowIds';

/**
 * Which row's quick edit is open (one at a time), and its unsaved changes: the editor remounts when the list
 * switches between the table and phone rows (a rotated tablet), and picks them up again. Closing it puts
 * focus back on that row's menu button.
 */
export const useQuickEditRow = () => {
  const [openId, setOpenId] = useState<string | null>(null);
  const draft = useRef<FormValues | undefined>(undefined);
  const getDraft = useCallback(() => draft.current, []);
  const setDraft = useCallback((values: FormValues | undefined) => {
    draft.current = values;
  }, []);
  return {
    openId,
    open: (id: string) => {
      draft.current = undefined;
      setOpenId(id);
    },
    close: (id: string) => {
      draft.current = undefined;
      setOpenId(null);
      requestAnimationFrame(() => document.getElementById(rowMoreId(id))?.focus());
    },
    /** The open editor's changed values, to carry over a remount. */
    getDraft,
    setDraft,
  };
};
