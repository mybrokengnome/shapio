import { AppError } from '../helpers/appError.js';
import * as changeSetsRepository from '../repositories/changeSets.js';
import type { SnapshotSource } from '../repositories/publications.js';
import * as publicationsRepository from '../repositories/publications.js';
import * as publicationSnapshotsRepository from '../repositories/publicationSnapshots.js';
import type { SnapshotRow } from '../repositories/publicationSnapshots.js';
import type { ContentServiceContext } from './contentAccess.js';

/**
 * The publication snapshot ledger of the request's site for the Snapshots page (numbers are per site, sites
 * plan §H): every snapshot number with why it was taken, who took it, the schema version live with it, how
 * many (entry, locale) publications changed and the deployment runs pinned to it. A snapshot taken because a
 * change set on another site converted this site's content names that set and its site.
 */
export type SnapshotChangeSetView = { id: string; title: string; site: { id: string; key: string } };

export type SnapshotView = {
  seq: number;
  schemaVersion: number | null;
  /** `legacy`: numbers taken before the ledger existed. */
  source: SnapshotSource | 'legacy';
  changeSetId: string | null;
  changeSetTitle: string | null;
  changeSet: SnapshotChangeSetView | null;
  actor: { type: string; id: string | null };
  changedEntries: number;
  deploymentRuns: Array<{ id: string; connectionId: string; status: string }>;
  createdAt: Date;
};

type ChangeSetsById = ReadonlyMap<string, SnapshotChangeSetView>;

const toView = (row: SnapshotRow, changeSets: ChangeSetsById): SnapshotView => {
  const changeSet = row.change_set_id ? (changeSets.get(row.change_set_id) ?? null) : null;
  return {
    seq: Number(row.seq),
    schemaVersion: row.schema_version,
    source: row.source as SnapshotView['source'],
    changeSetId: row.change_set_id,
    changeSetTitle: changeSet?.title ?? null,
    changeSet,
    actor: { type: row.actor_type ?? 'system', id: row.actor_id },
    changedEntries: Number(row.changed_entries),
    deploymentRuns: row.deployment_runs,
    createdAt: row.created_at,
  };
};

/** The change sets the rows name, with their sites (one query). */
const changeSetsOf = async (
  context: ContentServiceContext,
  rows: readonly SnapshotRow[],
): Promise<ChangeSetsById> => {
  const ids = [...new Set(rows.flatMap((row) => (row.change_set_id ? [row.change_set_id] : [])))];
  const titles = await changeSetsRepository.findTitles(ids, context.db);
  return new Map(
    titles.map((row) => [
      row.id,
      { id: row.id, title: row.title, site: { id: row.site_id, key: row.site_key } },
    ]),
  );
};

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
    context.site.id,
    { limit: limit + 1, ...(beforeSeq !== undefined ? { beforeSeq } : {}) },
    context.db,
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const changeSets = await changeSetsOf(context, page);
  return {
    items: page.map((row) => toView(row, changeSets)),
    nextCursor: rows.length > limit && last ? String(last.seq) : null,
    current: await publicationsRepository.currentSeq(context.site.id, context.db),
  };
};

export const getSnapshot = async (context: ContentServiceContext, seq: number): Promise<SnapshotView> => {
  const row = await publicationSnapshotsRepository.findBySeq(context.site.id, seq, context.db);
  if (!row) {
    throw new AppError(404, 'SNAPSHOT_NOT_FOUND', `There is no snapshot ${seq}`, { seq });
  }
  return toView(row, await changeSetsOf(context, [row]));
};
