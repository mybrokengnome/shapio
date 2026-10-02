import { useCallback } from 'react';
import { clientKeyOf, moveItem, toList, withClientKey, type ItemValues } from '../helpers/values';

/** Add, insert, move, duplicate and remove for list values (repeatable components, dynamic zones). */
export const useListEditor = (value: unknown, onChange: (value: unknown) => void) => {
  const items = toList<ItemValues>(value);
  const commit = useCallback((next: ItemValues[]) => onChange(next.length > 0 ? next : null), [onChange]);
  return {
    items,
    keys: items.map((item, index) => clientKeyOf(item, index)),
    add: (item: ItemValues) => commit([...items, item]),
    /** Inserts before `index` (0 = first, `items.length` = last): the canvas's insertion points. */
    insertAt: (index: number, item: ItemValues) => {
      const at = Math.min(Math.max(index, 0), items.length);
      commit([...items.slice(0, at), item, ...items.slice(at)]);
    },
    update: (index: number, item: ItemValues) =>
      commit(items.map((current, at) => (at === index ? item : current))),
    move: (from: number, to: number) => commit(moveItem(items, from, to)),
    duplicate: (index: number) => {
      const copy = withClientKey(structuredClone(items[index] ?? {}));
      commit([...items.slice(0, index + 1), copy, ...items.slice(index + 1)]);
    },
    remove: (index: number) => commit(items.filter((_, at) => at !== index)),
  };
};
