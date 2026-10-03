import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely';
import { isMysql, isSqlite } from './dialect.js';
import { mysqlJsonArrayOf } from './sql/values.js';
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
type DiffDialect = {
  uuid: (value: string) => RawBuilder<unknown>;
  seq: (value: number) => RawBuilder<unknown>;
  inModels: (modelIds: readonly string[]) => RawBuilder<unknown>;
  /** `a <op> b`: the two revision IDs differ (nulls compare as values). */
  distinct: (a: RawBuilder<unknown>, b: RawBuilder<unknown>) => RawBuilder<unknown>;
  /** The JSON objects of a group as an array ordered by locale. */
  aggregate: (object: RawBuilder<unknown>) => RawBuilder<unknown>;
  object: RawBuilder<unknown>;
  /** The classification column's name (`change` is reserved on MySQL). */
  change: RawBuilder<unknown>;
};

const POSTGRES: DiffDialect = {
  uuid: (value: string) => sql`${value}::uuid`,
  seq: (value: number) => sql`${value}::bigint`,
  inModels: (modelIds: readonly string[]) => sql`pl.model_id = any(${[...modelIds]}::uuid[])`,
  distinct: (a, b) => sql`${a} is distinct from ${b}`,
  aggregate: (object) => sql`jsonb_agg(
        ${object}
        order by ch.locale
      )`,
  object: sql`jsonb_build_object`,
  change: sql`change`,
};

const SQLITE: DiffDialect = {
  uuid: (value) => sql`${value.toLowerCase()}`,
  seq: (value) => sql`${value}`,
  inModels: (modelIds) => sql`pl.model_id in (select value from json_each(${JSON.stringify(modelIds)}))`,
  distinct: (a, b) => sql`${a} is not ${b}`,
  aggregate: (object) => sql`json_group_array(
        ${object}
        order by ch.locale
      )`,
  object: sql`json_object`,
  change: sql`change`,
};

/** MySQL: `<=>` is null-safe equality; JSON_ARRAYAGG takes no ORDER BY (`mysqlJsonArrayOf`). */
const MYSQL: DiffDialect = {
  uuid: (value) => sql`${value.toLowerCase()}`,
  seq: (value) => sql`${value}`,
  inModels: (modelIds) =>
    modelIds.length === 0 ? sql`false` : sql`pl.model_id in (${sql.join([...modelIds])})`,
  distinct: (a, b) => sql`not (${a} <=> ${b})`,
  aggregate: (object) => mysqlJsonArrayOf(sql`${object} order by ch.locale`),
  object: sql`json_object`,
  change: sql`\`change\``,
};

const modelCondition = (dialect: DiffDialect, modelIds: readonly string[] | null) =>
  modelIds === null ? sql`true` : dialect.inModels(modelIds);

const afterCondition = (dialect: DiffDialect, after: string | undefined) =>
  after === undefined ? sql`true` : sql`pl.entry_id > ${dialect.uuid(after)}`;

/** The revision of (entry, locale) live at `seq`, as a lateral subquery over `c`. */
const liveAt = (dialect: DiffDialect, siteId: string, seq: number) => sql`(
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
  const dialect = isMysql() ? MYSQL : isSqlite() ? SQLITE : POSTGRES;
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
        end as ${dialect.change}
      from states s
      where ${dialect.distinct(sql`s.from_revision_id`, sql`s.to_revision_id`)}
    )
    select ch.entry_id, e.model_id,
      ${dialect.aggregate(sql`${dialect.object}(
          'locale', ch.locale,
          'change', ch.${dialect.change},
          'fromRevisionId', ch.from_revision_id,
          'toRevisionId', ch.to_revision_id
        )`)} as locales
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
