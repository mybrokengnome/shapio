import { sql, type Kysely, type Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/**
 * The publication snapshot ledger of one site (written by `publications.nextSeq`; numbers are per site,
 * sites plan §H): one row per sequence number, with the number of the site's (entry, locale) publications
 * that started or ended at it and the site's deployment runs pinned to it.
 */
const listQuery = (siteId: string, executor: Executor) =>
  executor
    .selectFrom('publication_snapshots as s')
    .select([
      's.seq',
      's.schema_version',
      's.source',
      's.change_set_id',
      's.actor_type',
      's.actor_id',
      's.created_at',
      sql<string>`(select count(*) from publication_log pl
        where pl.site_id = s.site_id and (pl.from_seq = s.seq or pl.to_seq = s.seq))`.as('changed_entries'),
      sql<Array<{ id: string; connectionId: string; status: string }>>`coalesce((
        select json_agg(json_build_object('id', r.id, 'connectionId', r.connection_id, 'status', r.status)
          order by r.created_at)
        from deployment_runs r
        join deployment_connections dc on dc.id = r.connection_id
        where dc.site_id = s.site_id and r.snapshot_seq = s.seq), '[]'::json)`.as('deployment_runs'),
    ])
    .where('s.site_id', '=', siteId);

export type SnapshotRow = Awaited<ReturnType<ReturnType<typeof listQuery>['execute']>>[number];

export const list = (
  siteId: string,
  filter: { beforeSeq?: number; limit: number },
  executor: Executor = db,
) => {
  let query = listQuery(siteId, executor).orderBy('s.seq', 'desc').limit(filter.limit);
  if (filter.beforeSeq !== undefined) {
    query = query.where('s.seq', '<', String(filter.beforeSeq));
  }
  return query.execute();
};

export const findBySeq = (siteId: string, seq: number, executor: Executor = db) =>
  listQuery(siteId, executor).where('s.seq', '=', String(seq)).executeTakeFirst();
