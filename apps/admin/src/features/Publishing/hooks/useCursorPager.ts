import { useState } from 'react';

type CursorPagerProps = {
  onFirst: (() => void) | undefined;
  onPrevious: (() => void) | undefined;
  onNext: (() => void) | undefined;
};

/**
 * First / Previous / Next for a forward-only cursor list (newest first). The current cursor lives wherever
 * the caller keeps it (usually the URL); the cursors of earlier pages are remembered here.
 */
export const useCursorPager = (
  cursor: string | undefined,
  setCursor: (cursor: string | undefined) => void,
) => {
  const [previousCursors, setPreviousCursors] = useState<(string | undefined)[]>([]);
  const pagerProps = (nextCursor: string | null): CursorPagerProps => ({
    onFirst:
      cursor === undefined
        ? undefined
        : () => {
            setPreviousCursors([]);
            setCursor(undefined);
          },
    onPrevious:
      previousCursors.length === 0
        ? undefined
        : () => {
            setCursor(previousCursors.at(-1));
            setPreviousCursors((cursors) => cursors.slice(0, -1));
          },
    onNext: nextCursor
      ? () => {
          setPreviousCursors((cursors) => [...cursors, cursor]);
          setCursor(nextCursor);
        }
      : undefined,
  });
  return { pagerProps, resetPager: () => setPreviousCursors([]) };
};
