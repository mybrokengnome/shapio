import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import { emptyJsonArray, jsonAgg, jsonObject } from '../db/sql/json.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

type SnapshotDeploymentRun = { id: string; connectionId: string; status: string };

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
      (eb) =>
        eb
          .selectFrom('publication_log as pl')
          .select((sub) => sub.fn.countAll<string>().as('count'))
          .whereRef('pl.site_id', '=', 's.site_id')
          .where((sub) =>
            sub.or([sub('pl.from_seq', '=', sub.ref('s.seq')), sub('pl.to_seq', '=', sub.ref('s.seq'))]),
          )
          .$castTo<string>()
          .as('changed_entries'),
      (eb) =>
        eb.fn
          .coalesce(
            eb
              .selectFrom('deployment_runs as r')
              .innerJoin('deployment_connections as dc', 'dc.id', 'r.connection_id')
              .select((sub) =>
                jsonAgg<SnapshotDeploymentRun>(
                  jsonObject(
                    {
                      id: sub.ref('r.id'),
                      connectionId: sub.ref('r.connection_id'),
                      status: sub.ref('r.status'),
                    },
                    'json',
                  ),
                  [{ column: 'r.created_at' }],
                  'json',
                ).as('runs'),
              )
              .whereRef('dc.site_id', '=', 's.site_id')
              .whereRef('r.snapshot_seq', '=', 's.seq'),
            emptyJsonArray<SnapshotDeploymentRun>('json'),
          )
          .as('deployment_runs'),
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
