import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely';
import { isSqlite } from './dialect.js';
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
  /** The site whose publication log is diffed (snapshot numbers are per site). */
  siteId: string;
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

/**
 * The dialect's spelling of the few typed pieces (PostgreSQL casts, arrays and `jsonb_agg`; SQLite binds
 * plain values, expands the model list with `json_each` and aggregates with `json_group_array`, whose text
 * result is parsed here).
 */
const POSTGRES = {
  uuid: (value: string) => sql`${value}::uuid`,
  seq: (value: number) => sql`${value}::bigint`,
  inModels: (modelIds: readonly string[]) => sql`pl.model_id = any(${[...modelIds]}::uuid[])`,
  distinct: sql`is distinct from`,
  aggregate: sql`jsonb_agg`,
  object: sql`jsonb_build_object`,
};

const SQLITE: typeof POSTGRES = {
  uuid: (value) => sql`${value.toLowerCase()}`,
  seq: (value) => sql`${value}`,
  inModels: (modelIds) => sql`pl.model_id in (select value from json_each(${JSON.stringify(modelIds)}))`,
  distinct: sql`is not`,
  aggregate: sql`json_group_array`,
  object: sql`json_object`,
};

const modelCondition = (dialect: typeof POSTGRES, modelIds: readonly string[] | null) =>
  modelIds === null ? sql`true` : dialect.inModels(modelIds);

const afterCondition = (dialect: typeof POSTGRES, after: string | undefined) =>
  after === undefined ? sql`true` : sql`pl.entry_id > ${dialect.uuid(after)}`;

/** The revision of (entry, locale) live at `seq`, as a lateral subquery over `c`. */
const liveAt = (dialect: typeof POSTGRES, siteId: string, seq: number) => sql`(
  select p.revision_id from publication_log p
  where p.site_id = ${dialect.uuid(siteId)} and p.entry_id = c.entry_id and p.locale = c.locale
    and p.from_seq <= ${dialect.seq(seq)} and (p.to_seq is null or p.to_seq > ${dialect.seq(seq)})
  order by p.from_seq desc
  limit 1
)`;

export const selectSnapshotDiffRows = async (
  params: SnapshotDiffParams,
  executor: Executor,
): Promise<SnapshotDiffRow[]> => {
  const dialect = isSqlite() ? SQLITE : POSTGRES;
  const { from, to } = params;
  const scope = sql`pl.site_id = ${dialect.uuid(params.siteId)} and ${modelCondition(dialect, params.modelIds)}
    and ${afterCondition(dialect, params.after)}`;
  const result = await sql<SnapshotDiffRow>`
    with candidates as (
      select pl.entry_id, pl.locale from publication_log pl
      where pl.from_seq > ${dialect.seq(from)} and pl.from_seq <= ${dialect.seq(to)} and ${scope}
      union
      select pl.entry_id, pl.locale from publication_log pl
      where pl.to_seq > ${dialect.seq(from)} and pl.to_seq <= ${dialect.seq(to)} and ${scope}
    ),
    states as (
      select c.entry_id, c.locale, ${liveAt(dialect, params.siteId, from)} as from_revision_id,
        ${liveAt(dialect, params.siteId, to)} as to_revision_id
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
      where s.from_revision_id ${dialect.distinct} s.to_revision_id
    )
    select ch.entry_id, e.model_id,
      ${dialect.aggregate}(
        ${dialect.object}(
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
  return result.rows.map((row) =>
    typeof row.locales === 'string'
      ? { ...row, locales: JSON.parse(row.locales) as SnapshotDiffLocaleRow[] }
      : row,
  );
};
