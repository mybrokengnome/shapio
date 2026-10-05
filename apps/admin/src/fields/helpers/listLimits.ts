/** Whether a list of `count` items can take one more under its `max` (none: always). */
export const hasRoomFor = (count: number, max: number | undefined): boolean =>
  max === undefined || count < max;

/**
 * The count an empty list must reach once it has items, when that changes what the person does: a `min`
 * of 2 or more means one item is not enough. A `min` of 1 says nothing (an empty optional list is valid,
 * and a required one already shows its asterisk), and `max` cannot matter while the list is empty.
 */
export const emptyListMinimum = (min: number | undefined): number | undefined =>
  min !== undefined && min > 1 ? min : undefined;
