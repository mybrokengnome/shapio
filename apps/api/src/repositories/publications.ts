import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';
import { entrySiteOf } from './entries.js';

type Executor = Kysely<DB> | Transaction<DB>;

/** Why a publication sequence number was taken (the `publication_snapshots` ledger). */
export type SnapshotSource =
  'publish' | 'unpublish' | 'delete' | 'schedule' | 'change_set' | 'schema' | 'conversion' | 'import';

export type SnapshotMeta = {
  source: SnapshotSource;
  changeSetId?: string | null;
  /** Who caused it, in audit vocabulary (`schema/planner/actor.ts actorColumns`). */
  actor?: { type: string; id: string | null } | null;
};

/**
 * The publication sequence and log behind `?snapshot=N` (ADR 0001). The sequence is one row incremented
 * inside each publishing transaction: its row lock orders publications by commit, so a reader that sees N
 * also sees every publication before N. Take it as late as possible in the transaction (it serialises every
 * publication instance-wide until commit), and never ahead of the transaction that uses it.
 *
 * Every number also gets a `publication_snapshots` ledger row (why, who, the schema version live with it),
 * written in the same transaction.
 */
export const nextSeq = async (trx: Transaction<DB>, siteId: string, meta: SnapshotMeta): Promise<number> => {
  // One sequence per site (sites plan §H): publishing on one site never waits for another's.
  const row = await trx
    .updateTable('publication_state')
    .set((eb) => ({ last_seq: eb('last_seq', '+', '1') }))
    .where('site_id', '=', siteId)
    .returning('last_seq')
    .executeTakeFirstOrThrow();
  const seq = Number(row.last_seq);
  await trx
    .insertInto('publication_snapshots')
    .values((eb) => ({
      site_id: siteId,
      seq: String(seq),
      schema_version: eb.selectFrom('system_versions').select('schema_version'),
      source: meta.source,
      change_set_id: meta.changeSetId ?? null,
      actor_type: meta.actor?.type ?? null,
      actor_id: meta.actor?.id ?? null,
    }))
    .execute();
  return seq;
};

/**
 * One sequence number per transaction, taken on first use: everything a batch publishes, unpublishes or
 * converts shares it, so the batch is exactly one snapshot.
 */
export type SeqAllocator = {
  next: () => Promise<number>;
  /** The number if one was taken already. */
  taken: () => number | undefined;
};

export const createSeqAllocator = (
  trx: Transaction<DB>,
  siteId: string,
  meta: SnapshotMeta,
): SeqAllocator => {
  let seq: Promise<number> | undefined;
  let value: number | undefined;
  return {
    next: () => {
      seq ??= nextSeq(trx, siteId, meta).then((taken) => {
        value = taken;
        return taken;
      });
      return seq;
    },
    taken: () => value,
  };
};

export const currentSeq = async (siteId: string, executor: Executor = db): Promise<number> => {
  const row = await executor
    .selectFrom('publication_state')
    .select('last_seq')
    .where('site_id', '=', siteId)
    .executeTakeFirstOrThrow();
  return Number(row.last_seq);
};

/** Ends the live period of (entry, locale) at `seq`, if one is open. */
export const close = (entryId: string, locale: string | null, seq: number, trx: Executor = db) => {
  let query = trx
    .updateTable('publication_log')
    .set({ to_seq: String(seq) })
    .where('entry_id', '=', entryId)
    .where('to_seq', 'is', null);
  if (locale !== null) {
    query = query.where('locale', '=', locale);
  }
  return query.executeTakeFirst();
};

export const open = (
  row: { entryId: string; modelId: string; locale: string; revisionId: string; seq: number; now: Date },
  trx: Executor = db,
) =>
  trx
    .insertInto('publication_log')
    .values({
      entry_id: row.entryId,
      // The log is per site (snapshot numbers are): a copy of the entry's site.
      site_id: entrySiteOf(trx, row.entryId),
      model_id: row.modelId,
      locale: row.locale,
      revision_id: row.revisionId,
      from_seq: String(row.seq),
      published_at: row.now,
    })
    .execute();

export const hasOpen = async (entryId: string, executor: Executor = db): Promise<boolean> => {
  const row = await executor
    .selectFrom('publication_log')
    .select('id')
    .where('entry_id', '=', entryId)
    .where('to_seq', 'is', null)
    .executeTakeFirst();
  return row !== undefined;
};

export const removeForLocale = (locale: string, trx: Executor = db) =>
  trx.deleteFrom('publication_log').where('locale', '=', locale).executeTakeFirst();

/**
 * An entry's publications (one row per live period of a locale), newest first, with the ledger rows that
 * opened and closed each: when, why (`source`, the change set) and who, for the entry's history.
 */
export const listForEntry = (
  entryId: string,
  locale: string | null,
  limit: number,
  executor: Executor = db,
) =>
  executor
    .selectFrom('publication_log as l')
    .leftJoin('publication_snapshots as opened', (join) =>
      join.onRef('opened.site_id', '=', 'l.site_id').onRef('opened.seq', '=', 'l.from_seq'),
    )
    .leftJoin('publication_snapshots as closed', (join) =>
      join.onRef('closed.site_id', '=', 'l.site_id').onRef('closed.seq', '=', 'l.to_seq'),
    )
    .leftJoin('change_sets as cs', 'cs.id', 'opened.change_set_id')
    .select([
      'l.revision_id',
      'l.locale',
      'l.from_seq',
      'l.to_seq',
      'l.published_at',
      'opened.source',
      'opened.actor_type',
      'opened.actor_id',
      'cs.title as change_set_title',
      'closed.created_at as closed_at',
      'closed.actor_type as closed_actor_type',
      'closed.actor_id as closed_actor_id',
    ])
    .where('l.entry_id', '=', entryId)
    .$if(locale !== null, (qb) => qb.where('l.locale', '=', locale ?? ''))
    .orderBy('l.from_seq', 'desc')
    .orderBy('l.id', 'desc')
    .limit(limit)
    .execute();

export type EntryPublicationRow = Awaited<ReturnType<typeof listForEntry>>[number];
