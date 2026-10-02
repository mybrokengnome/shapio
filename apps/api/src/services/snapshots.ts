import { AppError } from '../helpers/appError.js';
import type { SnapshotSource } from '../repositories/publications.js';
import * as publicationsRepository from '../repositories/publications.js';
import * as publicationSnapshotsRepository from '../repositories/publicationSnapshots.js';
import type { SnapshotRow } from '../repositories/publicationSnapshots.js';
import type { ContentServiceContext } from './contentAccess.js';

/**
 * The publication snapshot ledger for the Snapshots page: every snapshot number with why it was taken, who
 * took it, the schema version live with it, how many (entry, locale) publications changed and the
 * deployment runs pinned to it.
 */
export type SnapshotView = {
  seq: number;
  schemaVersion: number | null;
  /** `legacy`: numbers taken before the ledger existed. */
  source: SnapshotSource | 'legacy';
  changeSetId: string | null;
  changeSetTitle: string | null;
  actor: { type: string; id: string | null };
  changedEntries: number;
  deploymentRuns: Array<{ id: string; connectionId: string; status: string }>;
  createdAt: Date;
};

const toView = (row: SnapshotRow): SnapshotView => ({
  seq: Number(row.seq),
  schemaVersion: row.schema_version,
  source: row.source as SnapshotView['source'],
  changeSetId: row.change_set_id,
  changeSetTitle: row.change_set_title,
  actor: { type: row.actor_type ?? 'system', id: row.actor_id },
  changedEntries: Number(row.changed_entries),
  deploymentRuns: row.deployment_runs,
  createdAt: row.created_at,
});

const parseCursor = (cursor: string | undefined): number | undefined => {
  if (cursor === undefined) {
    return undefined;
  }
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AppError(400, 'INVALID_CURSOR', 'The cursor is not valid');
  }
  return value;
};

export const listSnapshots = async (
  context: ContentServiceContext,
  query: { cursor?: string | undefined; limit?: number | undefined },
) => {
  const limit = query.limit ?? 50;
  const beforeSeq = parseCursor(query.cursor);
  const rows = await publicationSnapshotsRepository.list(
    { limit: limit + 1, ...(beforeSeq !== undefined ? { beforeSeq } : {}) },
    context.db,
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toView),
    nextCursor: rows.length > limit && last ? String(last.seq) : null,
    current: await publicationsRepository.currentSeq(context.db),
  };
};

export const getSnapshot = async (context: ContentServiceContext, seq: number): Promise<SnapshotView> => {
  const row = await publicationSnapshotsRepository.findBySeq(seq, context.db);
  if (!row) {
    throw new AppError(404, 'SNAPSHOT_NOT_FOUND', `There is no snapshot ${seq}`, { seq });
  }
  return toView(row);
};
