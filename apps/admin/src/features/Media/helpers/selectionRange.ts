/**
 * The items a shift-click selects: from the anchor (the last item toggled) to the clicked one, inclusive,
 * in list order. Undefined when there is no usable anchor (then the click toggles one item).
 */
export const selectionRange = (
  ids: readonly string[],
  anchor: string | undefined,
  target: string,
): string[] | undefined => {
  const from = anchor === undefined ? -1 : ids.indexOf(anchor);
  const to = ids.indexOf(target);
  if (from === -1 || to === -1) {
    return undefined;
  }
  return ids.slice(Math.min(from, to), Math.max(from, to) + 1);
};
