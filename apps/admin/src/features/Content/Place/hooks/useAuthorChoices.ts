import type { AdminEntryListItem, EntryAuthor } from '@shapio/client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useMe, useHasGlobalPermission } from '@/api/auth';
import { adminApi } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';

/**
 * Who the "Created by" filter offers: you first, then the authors on this page, then every admin when
 * you may list them (`users.manage`). Also names the author an active filter points at.
 */
export const useAuthorChoices = (items: readonly AdminEntryListItem[] | undefined) => {
  const me = useMe().data?.user;
  const canListUsers = useHasGlobalPermission('users.manage');
  const users = useQuery({
    queryKey: queryKeys.users,
    queryFn: () => adminApi.users.list(),
    enabled: canListUsers,
    meta: { silent: true },
  });
  const choices = useMemo(() => {
    const byId = new Map<string, EntryAuthor>();
    const add = (author: EntryAuthor | null | undefined) => {
      if (author && !byId.has(author.id)) {
        byId.set(author.id, author);
      }
    };
    add(me ? { id: me.id, name: me.name } : undefined);
    items?.forEach((item) => add(item.author));
    users.data?.forEach((user) => add({ id: user.id, name: user.name }));
    return [...byId.values()];
  }, [me, items, users.data]);
  return { choices, meId: me?.id, nameOf: (id: string) => choices.find((choice) => choice.id === id)?.name };
};
