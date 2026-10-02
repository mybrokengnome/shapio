import type { Transaction } from 'kysely';
import type { ContentModel } from '../content/model.js';
import type { DB } from '../db/types.js';
import * as adminUsersRepository from '../repositories/adminUsers.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';

/**
 * What the admin list shows beside each entry's data (the place list, plan editor-experience §4): who
 * created it, and for localized models every locale's status. Two queries per page, never one per row.
 */
export type ListAuthor = { id: string; name: string };
export type ListLocaleStatus = { locale: string; status: 'draft' | 'published' | 'modified' };

type ListRow = { entry_id: string; created_by_admin_id: string | null };

export const listDetailsFor = async (
  trx: Transaction<DB>,
  model: ContentModel,
  rows: readonly ListRow[],
  statusOf: (
    draft: { revision_id: string; autosaved_at: Date | null },
    published?: { revision_id: string },
  ) => ListLocaleStatus['status'],
) => {
  const authorIds = [
    ...new Set(rows.map((row) => row.created_by_admin_id).filter((id): id is string => id !== null)),
  ];
  const [authors, heads] = await Promise.all([
    adminUsersRepository.findNamesByIds(authorIds, trx),
    model.definition.localized
      ? entryHeadsRepository.findStatesForEntries(
          rows.map((row) => row.entry_id),
          trx,
        )
      : Promise.resolve([]),
  ]);
  const names = new Map(authors.map((author) => [author.id, author.name]));
  const authorOf = (row: ListRow): ListAuthor | null => {
    const name = row.created_by_admin_id ? names.get(row.created_by_admin_id) : undefined;
    return row.created_by_admin_id && name !== undefined ? { id: row.created_by_admin_id, name } : null;
  };
  const localesOf = (entryId: string): ListLocaleStatus[] | undefined => {
    if (!model.definition.localized) {
      return undefined;
    }
    const ofEntry = heads.filter((head) => head.entry_id === entryId);
    return ofEntry
      .filter((head) => head.state === 'draft')
      .map((draft) => ({
        locale: draft.locale,
        status: statusOf(
          draft,
          ofEntry.find((head) => head.state === 'published' && head.locale === draft.locale),
        ),
      }));
  };
  return { authorOf, localesOf };
};
