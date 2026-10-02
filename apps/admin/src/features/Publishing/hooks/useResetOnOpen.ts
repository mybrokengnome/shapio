import { useEffect } from 'react';
import type { FieldValues, UseFormReset } from 'react-hook-form';

/**
 * A sheet or popover form starts clean every time it opens: default values, and no error left over from the last
 * attempt. `values` must be stable (a module constant or memoized).
 */
export const useResetOnOpen = <TValues extends FieldValues>(
  open: boolean,
  reset: UseFormReset<TValues>,
  values: TValues,
  resetMutation: () => void,
) => {
  useEffect(() => {
    if (open) {
      reset(values);
      resetMutation();
    }
  }, [open, reset, values, resetMutation]);
};
