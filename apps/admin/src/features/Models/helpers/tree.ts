/** One item of a list ordered as a tree: its depth (0 for a root) and its parent's ID when it has one. */
export type TreeRow<T> = { item: T; depth: number; parentId: string | undefined };

/**
 * Orders items so every child follows its parent (depth first), keeping the given order among siblings. An
 * item whose parent is not in the list (another site's, deleted, or the chain is broken) is a root. A cycle
 * can't hang it: each item is placed once.
 */
export const orderAsTree = <T>(
  items: readonly T[],
  idOf: (item: T) => string,
  parentOf: (item: T) => string | undefined,
): TreeRow<T>[] => {
  const ids = new Set(items.map(idOf));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const item of items) {
    const parentId = parentOf(item);
    if (parentId !== undefined && parentId !== idOf(item) && ids.has(parentId)) {
      children.set(parentId, [...(children.get(parentId) ?? []), item]);
    } else {
      roots.push(item);
    }
  }
  const rows: TreeRow<T>[] = [];
  const placed = new Set<string>();
  const visit = (item: T, depth: number, parentId: string | undefined) => {
    const id = idOf(item);
    if (placed.has(id)) {
      return;
    }
    placed.add(id);
    rows.push({ item, depth, parentId });
    for (const child of children.get(id) ?? []) {
      visit(child, depth + 1, id);
    }
  };
  for (const root of roots) {
    visit(root, 0, undefined);
  }
  // Members of a cycle have no root above them: list them flat rather than lose them.
  for (const item of items) {
    visit(item, 0, undefined);
  }
  return rows;
};
