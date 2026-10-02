import { useRef } from 'react';
import { selectionRange } from '../helpers/selectionRange';

type SelectRequest = { id: string; checked: boolean; shiftKey: boolean };

/**
 * Shift-click selection over an ordered list: a plain toggle sets the anchor; a shift toggle selects
 * everything from the anchor to the clicked item. Works through `onSelectChange` alone, so any owner of the
 * selection (the library, the media picker) gets ranges without new props.
 */
export const useRangeSelection = (
  ids: readonly string[],
  onSelectChange: (id: string, checked: boolean) => void,
) => {
  const anchor = useRef<string | undefined>(undefined);
  const select = ({ id, checked, shiftKey }: SelectRequest) => {
    const range = shiftKey ? selectionRange(ids, anchor.current, id) : undefined;
    if (range) {
      for (const rangeId of range) {
        onSelectChange(rangeId, true);
      }
    } else {
      onSelectChange(id, checked);
    }
    anchor.current = id;
  };
  return { select };
};
