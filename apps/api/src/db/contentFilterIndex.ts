import type { FastifyBaseLogger } from 'fastify';
import { sql } from 'kysely';
import { setContentIndexForm, type ContentIndexForm } from './contentIndexForm.js';
import { currentDialect } from './dialect.js';
import { getIndexState } from './indexCatalog.js';
import type { Database } from './index.js';

/**
 * `entry_heads.filter_data` and its containment index (ADR 0001, "Filter data"; PostgreSQL only).
 *
 * The migration `20261112120000_entry_heads_scalars_gin` adds the column (nullable, catalog only), the function
 * `shapio_scalar_fields(jsonb)` and the trigger `entry_heads_filter_data`, which sets
 * `filter_data = shapio_scalar_fields(data)` on every insert and on every update that names `data` or
 * `filter_data`, whoever writes. On a new install it also adds the check `entry_heads_filter_data_present` and the
 * index. With heads present, the `schema.contentFilterIndex` job fills the rows written before the trigger
 * existed (`fillFilterData`), adds the check `NOT VALID` and validates it, builds the index `CONCURRENTLY`, and
 * queues the drop of the whole-document index.
 *
 * The invariant: once the check is validated, every row's `filter_data` is `shapio_scalar_fields(data)`. The
 * validated check proves no row lacks it (it scanned every row, and refuses any write that would clear it), and
 * the trigger recomputes it on every write that could change either column. So containment on `filter_data`
 * answers exactly what containment on `data` answers, for every row, and a process uses it (`filter`) only when
 * the check is validated and the index is valid (`readContentIndexForm`).
 */
export const FILTER_INDEX = 'entry_heads_filter_data_gin';
export const DOCUMENT_INDEX = 'entry_heads_data_gin';
/** An index an unreleased draft of the migration built; dropped with the whole-document index. */
export const DRAFT_SCALARS_INDEX = 'entry_heads_scalars_gin';
export const FILTER_CHECK = 'entry_heads_filter_data_present';

/** How often a process still on the old form looks at the catalog again. */
export const CONTENT_INDEX_RECHECK_MS = 60_000;

/** How long adding the check may wait for its brief table lock before giving up (the job retries). */
const CHECK_LOCK_TIMEOUT = '5s';

export type HeadKey = { entryId: string; locale: string; state: string };

/**
 * Fills `filter_data` on up to `size` heads that lack it, after `after` in key order, in one short statement.
 * Rows another transaction holds are skipped (`SKIP LOCKED`), never waited for, so a user's write is never held
 * up for more than this statement, and no deadlock is possible. Only `filter_data` changes: no version, change
 * sequence, timestamp, revision or event. Returns how many it filled and the last key it locked.
 */
export const fillFilterDataBatch = async (
  db: Database,
  after: HeadKey | null,
  size: number,
): Promise<{ filled: number; last: HeadKey | null }> => {
  const { rows } = await sql<{
    filled: number;
    entry_id: string | null;
    locale: string | null;
    state: string | null;
  }>`
    with batch as (
      select entry_id, locale, state from entry_heads
      where filter_data is null
        ${after ? sql`and (entry_id, locale, state) > (${after.entryId}::uuid, ${after.locale}, ${after.state})` : sql``}
      order by entry_id, locale, state
      limit ${size}
      for update skip locked
    ), filled as (
      update entry_heads h set filter_data = shapio_scalar_fields(h.data)
      from batch b
      where h.entry_id = b.entry_id and h.locale = b.locale and h.state = b.state
      returning 1
    ), last as (
      select entry_id, locale, state from batch order by entry_id desc, locale desc, state desc limit 1
    )
    select (select count(*)::int from filled) as filled, last.entry_id, last.locale, last.state
    from (select 1) one left join last on true
  `.execute(db);
  const row = rows[0];
  const last =
    row?.entry_id && row.locale !== null && row.state !== null
      ? { entryId: row.entry_id, locale: row.locale, state: row.state }
      : null;
  return { filled: row?.filled ?? 0, last };
};

/** Whether any head still lacks `filter_data`. */
export const hasMissingFilterData = async (db: Database): Promise<boolean> => {
  const { rows } = await sql<{ missing: boolean }>`
    select exists (select 1 from entry_heads where filter_data is null) as missing`.execute(db);
  return rows[0]?.missing ?? true;
};

export type CheckState = 'missing' | 'notValid' | 'valid';

export const filterCheckState = async (db: Database): Promise<CheckState> => {
  const { rows } = await sql<{ valid: boolean }>`
    select k.convalidated as valid from pg_catalog.pg_constraint k
    where k.conrelid = to_regclass('entry_heads') and k.conname = ${FILTER_CHECK}`.execute(db);
  const row = rows[0];
  if (!row) {
    return 'missing';
  }
  return row.valid ? 'valid' : 'notValid';
};

/**
 * Adds the check without scanning (`NOT VALID`: it holds for every write from now on). Taking the table lock
 * is brief, but waits behind open transactions; it gives up after `CHECK_LOCK_TIMEOUT` instead of queueing
 * every query behind it.
 */
export const addFilterCheckNotValid = (db: Database): Promise<void> =>
  db.transaction().execute(async (trx) => {
    await sql`set local lock_timeout = ${sql.lit(CHECK_LOCK_TIMEOUT)}`.execute(trx);
    await sql`alter table entry_heads add constraint ${sql.id(FILTER_CHECK)}
      check (filter_data is not null) not valid`.execute(trx);
  });

/** Scans every row under a lock that blocks neither reads nor writes; fails if a row lacks `filter_data`. */
export const validateFilterCheck = (db: Database): Promise<unknown> =>
  sql`alter table entry_heads validate constraint ${sql.id(FILTER_CHECK)}`.execute(db);

export const createFilterIndexConcurrently = (db: Database): Promise<unknown> =>
  sql`create index concurrently if not exists ${sql.id(FILTER_INDEX)}
    on entry_heads using gin (filter_data jsonb_path_ops)`.execute(db);

/** Drops an index on `entry_heads` without blocking writes. */
export const dropIndexConcurrently = (db: Database, name: string): Promise<unknown> =>
  sql`drop index concurrently if exists ${sql.id(name)}`.execute(db);

/** `filter` once the check is validated (every row filled) and the index is valid; never merely present. */
export const readContentIndexForm = async (db: Database): Promise<ContentIndexForm> =>
  (await filterCheckState(db)) === 'valid' && (await getIndexState(db, FILTER_INDEX)) === 'valid'
    ? 'filter'
    : 'document';

export type ContentIndexWatch = { stop: () => void };

const NO_WATCH: ContentIndexWatch = { stop: () => undefined };

/**
 * Sets the process's form from the catalog (PostgreSQL; SQLite and MySQL have no containment index). While the
 * old form is live, an unref'd timer looks again every `CONTENT_INDEX_RECHECK_MS` and stops at the switch, which
 * never goes back: nothing undoes a validated check, and the old index is dropped only after the switch.
 * Steady state costs nothing.
 */
export const watchContentIndexForm = async (
  db: Database,
  log: FastifyBaseLogger,
): Promise<ContentIndexWatch> => {
  if (currentDialect() !== 'postgres') {
    return NO_WATCH;
  }
  const form = await readContentIndexForm(db);
  setContentIndexForm(form);
  if (form === 'filter') {
    return NO_WATCH;
  }
  log.info({ indexName: FILTER_INDEX }, 'content filter index not ready yet; containment uses the old index');
  let checking = false;
  let stopped = false;
  const timer = setInterval(() => {
    if (checking || stopped) {
      return;
    }
    checking = true;
    readContentIndexForm(db)
      .then((next) => {
        if (next === 'filter' && !stopped) {
          clearInterval(timer);
          setContentIndexForm('filter');
          log.info({ indexName: FILTER_INDEX }, 'content filter index ready; containment uses it');
        }
      })
      .catch((error: unknown) => {
        log.warn({ err: error }, 'checking the content filter index failed; trying again later');
      })
      .finally(() => {
        checking = false;
      });
  }, CONTENT_INDEX_RECHECK_MS);
  timer.unref();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
};
