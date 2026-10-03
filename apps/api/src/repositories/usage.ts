import { sql, type Kysely, type Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/** A `YYYY-MM-DD` day as a SQL date (never a JS Date, whose time zone would shift it). */
const asDay = (day: string) => sql<Date>`${day}::date`;

/**
 * Daily usage counters (`field_reads`, `token_reads`), written by the usage aggregator's flush and read by
 * the usage API and change-set reviews. A flush is one multi-row upsert per table, so concurrent instances
 * add up instead of overwriting each other.
 */
export type UsageSelection = 'explicit' | 'implicit';

export type FieldReadRow = {
  day: string;
  siteId: string;
  modelId: string;
  fieldPath: string;
  principalKey: string;
  selection: UsageSelection;
  reads: number;
  lastReadAt: Date;
};

export type TokenReadRow = {
  day: string;
  siteId: string;
  principalKey: string;
  requests: number;
  lastSnapshot: number | null;
  lastReadAt: Date;
};

export const upsertFieldReads = async (rows: readonly FieldReadRow[], trx: Executor = db) => {
  if (rows.length === 0) {
    return;
  }
  await trx
    .insertInto('field_reads')
    .values(
      rows.map((row) => ({
        day: row.day,
        site_id: row.siteId,
        model_id: row.modelId,
        field_path: row.fieldPath,
        principal_key: row.principalKey,
        selection: row.selection,
        reads: String(row.reads),
        last_read_at: row.lastReadAt,
      })),
    )
    .onConflict((conflict) =>
      conflict
        .columns(['day', 'site_id', 'model_id', 'field_path', 'principal_key', 'selection'])
        .doUpdateSet({
          reads: sql`field_reads.reads + excluded.reads`,
          last_read_at: sql`greatest(field_reads.last_read_at, excluded.last_read_at)`,
        }),
    )
    .execute();
};

export const upsertTokenReads = async (rows: readonly TokenReadRow[], trx: Executor = db) => {
  if (rows.length === 0) {
    return;
  }
  await trx
    .insertInto('token_reads')
    .values(
      rows.map((row) => ({
        day: row.day,
        site_id: row.siteId,
        principal_key: row.principalKey,
        requests: String(row.requests),
        last_snapshot: row.lastSnapshot === null ? null : String(row.lastSnapshot),
        last_read_at: row.lastReadAt,
      })),
    )
    .onConflict((conflict) =>
      conflict.columns(['day', 'site_id', 'principal_key']).doUpdateSet({
        requests: sql`token_reads.requests + excluded.requests`,
        // The newer flush's pin wins; a flush without a pin keeps the one already recorded.
        last_snapshot: sql`case when excluded.last_read_at >= token_reads.last_read_at
          then coalesce(excluded.last_snapshot, token_reads.last_snapshot)
          else coalesce(token_reads.last_snapshot, excluded.last_snapshot) end`,
        last_read_at: sql`greatest(token_reads.last_read_at, excluded.last_read_at)`,
      }),
    )
    .execute();
};

/** The token's name for `token:<id>` keys (null for other principals and deleted tokens). */
const tokenName = sql<string | null>`(
  select t.name from api_tokens t where 'token:' || t.id::text = fr.principal_key
)`;

export type FieldUsageRow = {
  /** The site the reads were made on, with its key. */
  siteId: string;
  siteKey: string;
  fieldPath: string;
  principalKey: string;
  tokenName: string | null;
  selection: UsageSelection;
  reads: number;
  lastReadAt: Date;
};

const toFieldUsage = (row: {
  site_id: string;
  site_key: string;
  field_path: string;
  principal_key: string;
  token_name: string | null;
  selection: string;
  reads: string | number | bigint;
  last_read_at: Date;
}): FieldUsageRow => ({
  siteId: row.site_id,
  siteKey: row.site_key,
  fieldPath: row.field_path,
  principalKey: row.principal_key,
  tokenName: row.token_name,
  selection: row.selection as UsageSelection,
  reads: Number(row.reads),
  lastReadAt: row.last_read_at,
});

/**
 * Reads of one model's fields on one site since `sinceDay` (inclusive), per field path, principal and
 * selection.
 */
export const fieldUsageForModel = async (
  siteId: string,
  modelId: string,
  sinceDay: string,
  trx: Executor = db,
) =>
  (
    await trx
      .selectFrom('field_reads as fr')
      .innerJoin('sites as s', 's.id', 'fr.site_id')
      .select([
        'fr.site_id',
        's.key as site_key',
        'fr.field_path',
        'fr.principal_key',
        'fr.selection',
        tokenName.as('token_name'),
        (eb) => eb.fn.sum<string>('fr.reads').as('reads'),
        (eb) => eb.fn.max('fr.last_read_at').as('last_read_at'),
      ])
      .where('fr.site_id', '=', siteId)
      .where('fr.model_id', '=', modelId)
      .where('fr.day', '>=', asDay(sinceDay))
      .groupBy(['fr.site_id', 's.key', 'fr.field_path', 'fr.principal_key', 'fr.selection'])
      .orderBy('fr.field_path')
      .orderBy('reads', 'desc')
      .execute()
  ).map(toFieldUsage);

/**
 * Reads since `sinceDay` of field paths that involve any of `fieldIds`: the field itself, a populated
 * relation's target field (`rel.<id>`), and a relation read through to its targets (`<id>.sub`). Spans
 * every site (the schema is shared), per site.
 */
export const fieldUsageForFields = async (
  fieldIds: readonly string[],
  sinceDay: string,
  trx: Executor = db,
) => {
  if (fieldIds.length === 0) {
    return [];
  }
  const ids = [...fieldIds];
  return (
    await trx
      .selectFrom('field_reads as fr')
      .innerJoin('sites as s', 's.id', 'fr.site_id')
      .select([
        'fr.site_id',
        's.key as site_key',
        'fr.field_path',
        'fr.principal_key',
        'fr.selection',
        tokenName.as('token_name'),
        (eb) => eb.fn.sum<string>('fr.reads').as('reads'),
        (eb) => eb.fn.max('fr.last_read_at').as('last_read_at'),
      ])
      .where('fr.day', '>=', asDay(sinceDay))
      .where(
        sql<boolean>`(split_part(fr.field_path, '.', 1) = any(${ids}::text[])
          or split_part(fr.field_path, '.', 2) = any(${ids}::text[]))`,
      )
      .groupBy(['fr.site_id', 's.key', 'fr.field_path', 'fr.principal_key', 'fr.selection'])
      .execute()
  ).map(toFieldUsage);
};

export type PrincipalSummaryRow = {
  principalKey: string;
  tokenName: string | null;
  requests: number;
  lastSnapshot: number | null;
  lastReadAt: Date;
};

/**
 * Per principal on one site since `sinceDay`: requests, the last read and the snapshot it last pinned (from
 * the most recent day that recorded one; snapshot numbers are per site).
 */
export const principalSummaries = async (
  siteId: string,
  sinceDay: string,
  trx: Executor = db,
): Promise<PrincipalSummaryRow[]> => {
  const rows = await trx
    .selectFrom('token_reads as fr')
    .select([
      'fr.principal_key',
      tokenName.as('token_name'),
      (eb) => eb.fn.sum<string>('fr.requests').as('requests'),
      (eb) => eb.fn.max('fr.last_read_at').as('last_read_at'),
      sql<string | null>`(array_agg(fr.last_snapshot order by fr.day desc)
        filter (where fr.last_snapshot is not null))[1]`.as('last_snapshot'),
    ])
    .where('fr.site_id', '=', siteId)
    .where('fr.day', '>=', asDay(sinceDay))
    .groupBy('fr.principal_key')
    .orderBy('requests', 'desc')
    .execute();
  return rows.map((row) => ({
    principalKey: row.principal_key,
    tokenName: row.token_name,
    requests: Number(row.requests),
    lastSnapshot: row.last_snapshot === null ? null : Number(row.last_snapshot),
    lastReadAt: row.last_read_at,
  }));
};

const deleted = (result: { numDeletedRows: bigint }) => Number(result.numDeletedRows);

/** Deletes up to `limit` field-read buckets older than `beforeDay`; returns how many went. */
export const pruneFieldReads = async (beforeDay: string, limit: number, trx: Executor = db) =>
  deleted(
    await trx
      .deleteFrom('field_reads')
      .where((eb) =>
        eb(
          eb.refTuple('day', 'model_id', 'field_path', 'principal_key', 'selection'),
          'in',
          eb
            .selectFrom('field_reads')
            .select(['day', 'model_id', 'field_path', 'principal_key', 'selection'])
            .where('day', '<', asDay(beforeDay))
            .limit(limit)
            .$asTuple('day', 'model_id', 'field_path', 'principal_key', 'selection'),
        ),
      )
      .executeTakeFirstOrThrow(),
  );

/** Deletes up to `limit` per-principal buckets older than `beforeDay`; returns how many went. */
export const pruneTokenReads = async (beforeDay: string, limit: number, trx: Executor = db) =>
  deleted(
    await trx
      .deleteFrom('token_reads')
      .where((eb) =>
        eb(
          eb.refTuple('day', 'principal_key'),
          'in',
          eb
            .selectFrom('token_reads')
            .select(['day', 'principal_key'])
            .where('day', '<', asDay(beforeDay))
            .limit(limit)
            .$asTuple('day', 'principal_key'),
        ),
      )
      .executeTakeFirstOrThrow(),
  );
