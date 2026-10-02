import { sql, type Kysely, type Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/**
 * The publication snapshot ledger (written by `publications.nextSeq`): one row per sequence number, with
 * the number of (entry, locale) publications that started or ended at it and the deployment runs pinned to it.
 */
const listQuery = (executor: Executor) =>
  executor
    .selectFrom('publication_snapshots as s')
    .leftJoin('change_sets as c', 'c.id', 's.change_set_id')
    .select([
      's.seq',
      's.schema_version',
      's.source',
      's.change_set_id',
      'c.title as change_set_title',
      's.actor_type',
      's.actor_id',
      's.created_at',
      sql<string>`(select count(*) from publication_log pl where pl.from_seq = s.seq or pl.to_seq = s.seq)`.as(
        'changed_entries',
      ),
      sql<Array<{ id: string; connectionId: string; status: string }>>`coalesce((
        select json_agg(json_build_object('id', r.id, 'connectionId', r.connection_id, 'status', r.status)
          order by r.created_at)
        from deployment_runs r where r.snapshot_seq = s.seq), '[]'::json)`.as('deployment_runs'),
    ]);

export type SnapshotRow = Awaited<ReturnType<ReturnType<typeof listQuery>['execute']>>[number];

export const list = (filter: { beforeSeq?: number; limit: number }, executor: Executor = db) => {
  let query = listQuery(executor).orderBy('s.seq', 'desc').limit(filter.limit);
  if (filter.beforeSeq !== undefined) {
    query = query.where('s.seq', '<', String(filter.beforeSeq));
  }
  return query.execute();
};

export const findBySeq = (seq: number, executor: Executor = db) =>
  listQuery(executor).where('s.seq', '=', String(seq)).executeTakeFirst();
