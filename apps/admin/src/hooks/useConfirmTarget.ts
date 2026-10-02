import { useState } from 'react';

/**
 * The item a confirmation dialog is asking about. `target` is undefined while no dialog is open; keeping
 * the last target while the dialog animates out avoids its text flickering.
 */
export const useConfirmTarget = <T>() => {
  const [target, setTarget] = useState<T | undefined>(undefined);
  const [open, setOpen] = useState(false);
  return {
    target,
    open,
    ask: (item: T) => {
      setTarget(item);
      setOpen(true);
    },
    onOpenChange: setOpen,
    close: () => setOpen(false),
  };
};
