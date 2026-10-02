import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely';
import type { DB } from './types.js';

/**
 * The snapshot diff query over `publication_log` (PostgreSQL-specific SQL lives in `db/`, the content
 * compiler and migrations; CONTRIBUTING.md). repositories/snapshotDiff.ts is its typed wrapper and documents the
 * classification. Rows come back in entry-ID order, at most `maxRows` of them, with each entry's changed
 * locales aggregated as JSON.
 */
type Executor = Kysely<DB> | Transaction<DB>;

export type SnapshotDiffLocaleRow = {
  locale: string;
  change: 'published' | 'updated' | 'unpublished';
  fromRevisionId: string | null;
  toRevisionId: string | null;
};

export type SnapshotDiffRow = { entry_id: string; model_id: string; locales: SnapshotDiffLocaleRow[] };

export type SnapshotDiffParams = {
  from: number;
  to: number;
  /** Keyset cursor: only entries with a greater ID. */
  after: string | undefined;
  /** Only these models; null = every model. */
  modelIds: readonly string[] | null;
  /** A compiled condition over the `entries` row aliased `e`. */
  rowFilter: RawBuilder<unknown> | null;
  maxRows: number;
};

const modelCondition = (modelIds: readonly string[] | null) =>
  modelIds === null ? sql`true` : sql`pl.model_id = any(${[...modelIds]}::uuid[])`;

const afterCondition = (after: string | undefined) =>
  after === undefined ? sql`true` : sql`pl.entry_id > ${after}::uuid`;

/** The revision of (entry, locale) live at `seq`, as a lateral subquery over `c`. */
const liveAt = (seq: number) => sql`(
  select p.revision_id from publication_log p
  where p.entry_id = c.entry_id and p.locale = c.locale and p.from_seq <= ${seq}::bigint
    and (p.to_seq is null or p.to_seq > ${seq}::bigint)
  order by p.from_seq desc
  limit 1
)`;

export const selectSnapshotDiffRows = async (
  params: SnapshotDiffParams,
  executor: Executor,
): Promise<SnapshotDiffRow[]> => {
  const { from, to } = params;
  const scope = sql`${modelCondition(params.modelIds)} and ${afterCondition(params.after)}`;
  const result = await sql<SnapshotDiffRow>`
    with candidates as (
      select pl.entry_id, pl.locale from publication_log pl
      where pl.from_seq > ${from}::bigint and pl.from_seq <= ${to}::bigint and ${scope}
      union
      select pl.entry_id, pl.locale from publication_log pl
      where pl.to_seq > ${from}::bigint and pl.to_seq <= ${to}::bigint and ${scope}
    ),
    states as (
      select c.entry_id, c.locale, ${liveAt(from)} as from_revision_id, ${liveAt(to)} as to_revision_id
      from candidates c
    ),
    changes as (
      select s.*,
        case
          when s.from_revision_id is null then 'published'
          when s.to_revision_id is null then 'unpublished'
          else 'updated'
        end as change
      from states s
      where s.from_revision_id is distinct from s.to_revision_id
    )
    select ch.entry_id, e.model_id,
      jsonb_agg(
        jsonb_build_object(
          'locale', ch.locale,
          'change', ch.change,
          'fromRevisionId', ch.from_revision_id,
          'toRevisionId', ch.to_revision_id
        )
        order by ch.locale
      ) as locales
    from changes ch
    join entries e on e.id = ch.entry_id
    where ${params.rowFilter ?? sql`true`}
    group by ch.entry_id, e.model_id
    order by ch.entry_id
    limit ${params.maxRows}
  `.execute(executor);
  return result.rows;
};
