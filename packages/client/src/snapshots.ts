import { toQueryString } from './admin/query.js';
import type { RequestFn } from './request.js';
import type {
  CurrentSnapshot,
  SnapshotChange,
  SnapshotChangesPage,
  SnapshotChangesQuery,
} from './snapshotTypes.js';

export const SNAPSHOT_PATHS = {
  current: '/api/snapshots/current',
  changes: '/api/snapshots/changes',
} as const;

/** Snapshots and the diff between two of them, for incremental site builds (delivery credentials). */
export const createSnapshotsApi = (request: RequestFn) => {
  const changes = (query: SnapshotChangesQuery) =>
    request<SnapshotChangesPage>(`${SNAPSHOT_PATHS.changes}${toQueryString(query)}`);
  return {
    current: () => request<CurrentSnapshot>(SNAPSHOT_PATHS.current),
    changes,
    /** Every change between `from` and `to`, following `nextCursor` until the last page. */
    allChanges: async (query: Omit<SnapshotChangesQuery, 'after'>) => {
      const items: SnapshotChange[] = [];
      let page = await changes(query);
      items.push(...page.items);
      while (page.nextCursor !== null) {
        page = await changes({ ...query, to: page.to, after: page.nextCursor });
        items.push(...page.items);
      }
      return { from: page.from, to: page.to, schemaVersions: page.schemaVersions, items };
    },
  };
};
