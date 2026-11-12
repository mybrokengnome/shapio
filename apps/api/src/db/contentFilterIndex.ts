import type { FastifyBaseLogger } from 'fastify';
import { sql } from 'kysely';
import { sleep } from '../helpers/sleep.js';
import type { ContentIndexForm } from './contentIndexForm.js';
import { currentDialect } from './dialect.js';
import { isLockTimeout, isUndefinedColumn } from './sql/errors.js';
import type { Database } from './index.js';

/**
 * `entry_heads.filter_data` and its containment index (ADR 0001, "Filter data"; PostgreSQL only).
 *
 * The migration `20261112120000_entry_heads_scalars_gin` creates the function `shapio_scalar_fields(jsonb)` and
 * the trigger function. On an empty table (a new install) it also adds the column (nullable), the trigger
 * `entry_heads_filter_data`, which sets `filter_data = shapio_scalar_fields(data)` on every insert and on every
 * update that names `data` or `filter_data`, whoever writes, the check `entry_heads_filter_data_present`, and the
 * index. On a table with heads it takes no lock on it and enqueues `schema.contentFilterIndex`, which adds the
 * column and the trigger (`addFilterDataColumn`, a polite lock), fills the rows written before the trigger
 * existed (`fillFilterData`), adds the check `NOT VALID` and validates it, builds the index `CONCURRENTLY`, and
 * queues the drop of the whole-document index. Until then the column may not exist: nothing but this module and
 * the compiler's filter form names it, and a process uses that form only once `readContentIndexForm` says so.
 *
 * The invariant: once the check is validated, every row's `filter_data` is `shapio_scalar_fields(data)`. The
 * validated check proves no row lacks it (it scanned every row, and refuses any write that would clear it), and
 * the trigger recomputes it on every write that could change either column. So containment on `filter_data`
 * answers exactly what containment on `data` answers, for every row, and a process uses it (`filter`) only when
 * the check is validated and the index is valid (`readContentIndexForm`).
 *
 * Long strings: the function leaves out a top-level string longer than `FILTER_STRING_MAX_CHARS` characters (and
 * such string elements of a top-level array), and the compiler emits the document form for a value that long
 * (`content/compiler/dialect/postgres.ts`), so answers stay the same in both forms.
 */
export const FILTER_INDEX = 'entry_heads_filter_data_gin';
export const DOCUMENT_INDEX = 'entry_heads_data_gin';
/** An index an unreleased draft of the migration built; dropped with the whole-document index. */
export const DRAFT_SCALARS_INDEX = 'entry_heads_scalars_gin';
export const FILTER_CHECK = 'entry_heads_filter_data_present';
export const FILTER_TRIGGER = 'entry_heads_filter_data';
/** Created by the migration, with the function, on every database. */
export const FILTER_TRIGGER_FUNCTION = 'shapio_entry_heads_filter_data';

/** How often a process still on the old form looks at the catalog again. */
export const CONTENT_INDEX_RECHECK_MS = 60_000;

/**
 * How long one attempt to add the check waits for its table lock. While it waits, every query on `entry_heads`
 * queues behind it, so it gives up quickly and tries again later (`addFilterCheckNotValid`).
 */
export const LOCK_ATTEMPT_TIMEOUT_MS = 150;
/** Attempts to add the check before the job is rescheduled (`EntryHeadsLockBusyError`). */
const LOCK_ATTEMPTS = 8;
/** The longest pause between two attempts (jittered, doubling from 100 ms). */
const LOCK_RETRY_MAX_PAUSE_MS = 5_000;

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

/** Another transaction held `entry_heads` through every attempt to lock it; the caller tries again later. */
export class EntryHeadsLockBusyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EntryHeadsLockBusyError';
  }
}

const lockRetryPause = (attempt: number) => {
  const ceiling = Math.min(LOCK_RETRY_MAX_PAUSE_MS, 100 * 2 ** (attempt - 1));
  return Math.round(ceiling / 2 + (Math.random() * ceiling) / 2);
};

export type LockAttempts = { attempts?: number; signal?: AbortSignal };

/**
 * Runs `statements` in a short transaction that needs ACCESS EXCLUSIVE on `entry_heads` for a moment. The lock
 * waits behind any open transaction that touched the table (a long export, `pg_dump`), and every later query on
 * the table queues behind the wait. So each attempt waits at most `LOCK_ATTEMPT_TIMEOUT_MS`, the next comes
 * after a jittered pause, and after `attempts` it throws `EntryHeadsLockBusyError` for the job to reschedule
 * itself.
 */
const withPoliteLock = async (
  db: Database,
  what: string,
  statements: (trx: Database) => Promise<void>,
  { attempts = LOCK_ATTEMPTS, signal }: LockAttempts,
): Promise<void> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    signal?.throwIfAborted();
    try {
      await db.transaction().execute(async (trx) => {
        await sql`set local lock_timeout = ${sql.lit(`${LOCK_ATTEMPT_TIMEOUT_MS}ms`)}`.execute(trx);
        await statements(trx);
      });
      return;
    } catch (error) {
      if (!isLockTimeout(error)) {
        throw error;
      }
      lastError = error;
    }
    if (attempt < attempts) {
      await sleep(lockRetryPause(attempt), signal);
    }
  }
  throw new EntryHeadsLockBusyError(
    `Another transaction held entry_heads through ${attempts} attempts to ${what}`,
    {
      cause: lastError,
    },
  );
};

const columnExists = async (db: Database): Promise<boolean> => {
  const { rows } = await sql<{ present: boolean }>`
    select exists (select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('entry_heads') and attname = 'filter_data' and not attisdropped) as present
  `.execute(db);
  return rows[0]?.present ?? false;
};

const triggerExists = async (db: Database): Promise<boolean> => {
  const { rows } = await sql<{ present: boolean }>`
    select exists (select 1 from pg_catalog.pg_trigger
      where tgrelid = to_regclass('entry_heads') and tgname = ${FILTER_TRIGGER}) as present`.execute(db);
  return rows[0]?.present ?? false;
};

/** Whether the migration has run here (it creates the function on every database). */
export const filterFunctionExists = async (db: Database): Promise<boolean> => {
  const { rows } = await sql<{ present: boolean }>`
    select to_regprocedure('shapio_scalar_fields(jsonb)') is not null as present`.execute(db);
  return rows[0]?.present ?? false;
};

/**
 * Adds `filter_data` (nullable: a catalog-only change) and the trigger that keeps it, in one short transaction
 * under a polite lock, so every row written after it commits has its filter data. Both guarded, so a retry or a
 * second job finds them and does nothing; a quick catalog look first skips the lock entirely once they exist.
 */
export const addFilterDataColumn = async (db: Database, options: LockAttempts = {}): Promise<boolean> => {
  if ((await columnExists(db)) && (await triggerExists(db))) {
    return false;
  }
  await withPoliteLock(
    db,
    'add filter_data',
    async (trx) => {
      await sql`alter table entry_heads add column if not exists filter_data jsonb`.execute(trx);
      if (!(await triggerExists(trx))) {
        await sql`create trigger ${sql.id(FILTER_TRIGGER)} before insert or update of data, filter_data
          on entry_heads for each row execute function ${sql.id(FILTER_TRIGGER_FUNCTION)}()`.execute(trx);
      }
    },
    options,
  );
  return true;
};

/** Adds the check without scanning (`NOT VALID`: it holds for every write from now on), under a polite lock. */
export const addFilterCheckNotValid = (db: Database, options: LockAttempts = {}): Promise<void> =>
  withPoliteLock(
    db,
    `add ${FILTER_CHECK}`,
    async (trx) => {
      await sql`alter table entry_heads add constraint ${sql.id(FILTER_CHECK)}
        check (filter_data is not null) not valid`.execute(trx);
    },
    options,
  );

/**
 * Scans every row under SHARE UPDATE EXCLUSIVE, which blocks neither reads nor writes (only other schema changes,
 * index builds and VACUUM on the table); while it waits for that lock, user queries pass it. No lock timeout:
 * it never holds anyone up. Fails if a row lacks `filter_data`.
 */
export const validateFilterCheck = (db: Database): Promise<unknown> =>
  sql`alter table entry_heads validate constraint ${sql.id(FILTER_CHECK)}`.execute(db);

/**
 * SHARE UPDATE EXCLUSIVE too, and waits for transactions older than the build to end; reads and writes pass it
 * throughout. No lock timeout: one would leave an INVALID index after a wait that holds no one up.
 */
export const createFilterIndexConcurrently = (db: Database): Promise<unknown> =>
  sql`create index concurrently if not exists ${sql.id(FILTER_INDEX)}
    on entry_heads using gin (filter_data jsonb_path_ops)`.execute(db);

/** Drops an index on `entry_heads` without blocking reads or writes (the same lock as the build, same waits). */
export const dropIndexConcurrently = (db: Database, name: string): Promise<unknown> =>
  sql`drop index concurrently if exists ${sql.id(name)}`.execute(db);

/**
 * `filter` once the column and the trigger exist, the check is validated (every row filled), and the index is
 * valid; never merely present. One catalog statement (the watch runs it every minute for the life of the
 * process).
 */
export const readContentIndexForm = async (db: Database): Promise<ContentIndexForm> => {
  const { rows } = await sql<{ ready: boolean }>`
    select
      exists (select 1 from pg_catalog.pg_attribute
        where attrelid = to_regclass('entry_heads') and attname = 'filter_data' and not attisdropped)
      and exists (select 1 from pg_catalog.pg_trigger
        where tgrelid = to_regclass('entry_heads') and tgname = ${FILTER_TRIGGER} and tgenabled <> 'D')
      and exists (select 1 from pg_catalog.pg_constraint
        where conrelid = to_regclass('entry_heads') and conname = ${FILTER_CHECK} and convalidated)
      and exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_index i on i.indexrelid = c.oid
        where c.relname = ${FILTER_INDEX} and pg_catalog.pg_table_is_visible(c.oid) and i.indisvalid)
      as ready`.execute(db);
  return rows[0]?.ready ? 'filter' : 'document';
};

let processForm: ContentIndexForm = 'document';

/** The catalog look of every running watch in this process (`watchContentIndexForm`). */
const looks = new Set<() => Promise<void>>();

/**
 * Called with every failed query (`db/index.ts`): a query on the filter form that finds `filter_data` gone (a
 * migration run down by hand, a restore) makes every watch look at the catalog now, so the process falls back
 * to the document form before its next query instead of at the next minute. The failing query still fails.
 */
export const noticeQueryError = (error: unknown): void => {
  if (processForm === 'filter' && isUndefinedColumn(error, 'filter_data')) {
    for (const look of looks) {
      void look();
    }
  }
};

/**
 * The form this process emits containment in (`db/contentIndexForm.ts`): `document` until a catalog read in
 * `watchContentIndexForm` confirmed the filter form, which is the only place that switches it.
 */
export const contentIndexForm = (): ContentIndexForm => processForm;

/** Back to the default form (tests that move one database back to before the switch). */
export const resetContentIndexForm = (): void => {
  processForm = 'document';
};

export type ContentIndexWatch = {
  /** Settles after the first catalog read, whatever it found (never rejects). */
  ready: Promise<void>;
  stop: () => void;
};

export type ContentIndexWatchOptions = {
  /**
   * Called after every catalog read (at the start and on each re-check) with the form it found, so the caller
   * can keep the jobs that finish the switch queued (an older worker in a rolling upgrade can refuse them).
   * Returns whether there is still work to look after; once the filter form is live and it says no, it is not
   * called again until the form changes. Its failures are logged and count as yes.
   */
  onLook?: (form: ContentIndexForm) => Promise<boolean>;
};

const NO_WATCH: ContentIndexWatch = { ready: Promise.resolve(), stop: () => undefined };

/**
 * Keeps the process's form in step with the catalog (PostgreSQL; SQLite and MySQL have no containment index).
 * The first read starts at once; an unref'd timer reads again every `CONTENT_INDEX_RECHECK_MS` for the life of
 * the process (one catalog statement). The process emits the filter form only while the last read confirmed it,
 * and falls back to the document form, right on every database, whenever a read finds the column, trigger,
 * check or index gone or invalid (a migration run down by hand, a restore); a failed read changes nothing.
 * Callers that can wait (server and worker startup) await `ready`, so they serve with the filter form from their
 * first query on an instance that has it.
 */
export const watchContentIndexForm = (
  db: Database,
  log: FastifyBaseLogger,
  { onLook }: ContentIndexWatchOptions = {},
): ContentIndexWatch => {
  if (currentDialect() !== 'postgres') {
    return NO_WATCH;
  }
  let checking: Promise<void> | undefined;
  let stopped = false;
  let warned = false;
  // `onLook` said nothing is left while the filter form was live: not called again until the form changes.
  let jobsDone = false;
  const check = async (): Promise<void> => {
    let form: ContentIndexForm;
    try {
      form = await readContentIndexForm(db);
    } catch (error) {
      log.warn({ err: error }, 'checking the content filter index failed; trying again later');
      return;
    }
    if (stopped) {
      return;
    }
    if (form !== processForm) {
      jobsDone = false;
      if (form === 'filter') {
        log.info({ indexName: FILTER_INDEX }, 'content filter index ready; containment uses it');
      } else if (processForm === 'filter') {
        log.warn(
          { indexName: FILTER_INDEX },
          'content filter index no longer complete; containment uses the whole document again',
        );
      }
      processForm = form;
    }
    if (form === 'document' && !warned) {
      warned = true;
      log.info(
        { indexName: FILTER_INDEX },
        'content filter index not ready yet; containment uses the old index',
      );
    }
    if (!onLook || jobsDone) {
      return;
    }
    try {
      const more = await onLook(form);
      jobsDone = form === 'filter' && !more;
    } catch (error) {
      log.warn({ err: error }, 'making sure the content index jobs are queued failed; trying again later');
    }
  };
  const run = () => {
    if (checking || stopped) {
      return checking ?? Promise.resolve();
    }
    checking = check().finally(() => {
      checking = undefined;
    });
    return checking;
  };
  const timer = setInterval(() => {
    void run();
  }, CONTENT_INDEX_RECHECK_MS);
  timer.unref();
  looks.add(run);
  return {
    ready: run(),
    stop: () => {
      stopped = true;
      clearInterval(timer);
      looks.delete(run);
    },
  };
};
