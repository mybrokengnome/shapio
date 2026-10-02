import { useMatchRoute } from '@tanstack/react-router';
import type { ShellNavGroup } from './useShellNavGroups';

/**
 * The key of the item the current route belongs to: the most specific match, so `/settings/roles` marks
 * Roles rather than Settings, and an entry marks its place.
 */
export const useActiveNavKey = (groups: readonly ShellNavGroup[]): string | undefined => {
  const matchRoute = useMatchRoute();
  let best: { key: string; length: number } | undefined;
  for (const item of groups.flatMap((group) => group.items)) {
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
