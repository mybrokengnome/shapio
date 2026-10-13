import { useMatchRoute } from '@tanstack/react-router';
import { flattenNavItems, type ShellNavGroup } from './useShellNavGroups';

/**
 * The key of the item the current route belongs to: the most specific match, so `/settings/roles` marks
 * Roles rather than Settings, an entry marks its place, and a nested kind marks itself, not its parent.
 */
export const useActiveNavKey = (groups: readonly ShellNavGroup[]): string | undefined => {
  const matchRoute = useMatchRoute();
  let best: { key: string; length: number } | undefined;
  for (const item of groups.flatMap((group) => flattenNavItems(group.items))) {
    if (!matchRoute({ ...item.link, fuzzy: !item.exact })) {
      continue;
    }
    const length = String(item.link.to ?? '').length;
    if (!best || length > best.length) {
      best = { key: item.key, length };
    }
  }
  return best?.key;
};
