import { sql, type Kysely } from 'kysely';

/**
 * Filter data (ADR 0001, "Filter data"). Equality on a field without its own index is containment,
 * `{fieldId: scalar}` or `{fieldId: [scalar]}`, which a GIN `jsonb_path_ops` index serves. Indexing the whole
 * `data` also indexed every leaf of every component item, item IDs included, which no query can use, and
 * rechecking a match meant reading the whole document back. `entry_heads.filter_data` holds
 * `shapio_scalar_fields(data)`: the top-level fields such a document can match. The function keeps a top-level
 * scalar, and of a top-level array its scalar elements; it leaves out nulls, objects, nested arrays, arrays with
 * nothing left, and strings longer than 1,000 characters (code points), for which the compiler matches against
 * `data` instead (`FILTER_STRING_MAX_CHARS`). Data that is not a JSON object gives `{}`. Keeping more is always
 * safe; leaving out only those leaves every containment answer unchanged.
 *
 * - Every database gets the function and the trigger function `shapio_entry_heads_filter_data`, which calls
 *   the function by its schema, so it works whatever the writer's `search_path`. Neither locks a table.
 * - The column is nullable (a catalog-only change). The trigger `entry_heads_filter_data` keeps it on every
 *   insert and on every update that names `data` or `filter_data`, whoever writes, so no application code
 *   maintains it and no write can store anything else in it.
 * - Adding the column and the trigger needs ACCESS EXCLUSIVE on `entry_heads` for a moment. Every migration of a
 *   release runs in one transaction, so a wait here would also keep the locks earlier migrations took. So this
 *   migration adds them only to an empty table (a new install): it locks it politely (`lockEntryHeads`, 150 ms
 *   attempts for up to `EMPTY_TABLE_LOCK_WAIT_MS`), then adds the column, trigger, check
 *   `entry_heads_filter_data_present` and index `entry_heads_filter_data_gin`, and drops the whole-document
 *   index.
 * - On a table with heads it takes no lock on it beyond the read that finds a head, and enqueues
 *   `schema.contentFilterIndex` (schema/planner/contentFilterIndex.ts), which adds the column and the trigger
 *   in a short transaction under the same polite lock (rescheduling itself while the table is busy), fills the
 *   rows written before the trigger, adds the check `NOT VALID` and validates it, and builds the index
 *   `CONCURRENTLY`, so writes continue throughout; queries keep the whole-document index until all of that is
 *   done, and a later job drops it.
 *
 * The DDL is written out here on purpose: a migration never changes with the code that runs later
 * (`test/contentFilterIndex.int.test.ts` checks the live module builds the same index). SQLite and MySQL have
 * no containment index and no such column; their twins do nothing.
 */
const FUNCTION = 'shapio_scalar_fields';
const TRIGGER = 'entry_heads_filter_data';
const TRIGGER_FUNCTION = 'shapio_entry_heads_filter_data';
const CHECK = 'entry_heads_filter_data_present';
const FILTER_INDEX = 'entry_heads_filter_data_gin';
const DOCUMENT_INDEX = 'entry_heads_data_gin';
/** Built by an unreleased draft of this migration; `down` drops it too. */
const DRAFT_SCALARS_INDEX = 'entry_heads_scalars_gin';
export const CONTENT_FILTER_INDEX_JOB = 'schema.contentFilterIndex';
export const CONTENT_FILTER_INDEX_KEY = 'schema.contentFilterIndex:v1';
export const CONTENT_DOCUMENT_INDEX_DROP_JOB = 'schema.contentDocumentIndexDrop';
export const CONTENT_DOCUMENT_INDEX_DROP_KEY = 'schema.contentDocumentIndexDrop:v1';

/** How long one attempt to lock `entry_heads` may hold up the queries queued behind it. */
const LOCK_ATTEMPT_TIMEOUT = '150ms';
/** How long the migration keeps trying to lock an empty table before it fails with a message. */
export const EMPTY_TABLE_LOCK_WAIT_MS = 10_000;
const LOCK_RETRY_MAX_PAUSE_MS = 2_000;
const LOCK_SAVEPOINT = 'shapio_lock_entry_heads';
/** PostgreSQL SQLSTATE lock_not_available: `lock_timeout` gave up. */
const LOCK_NOT_AVAILABLE = '55P03';

const pause = (attempt: number) => {
  const ceiling = Math.min(LOCK_RETRY_MAX_PAUSE_MS, 50 * 2 ** Math.min(attempt - 1, 10));
  return new Promise((resolve) => setTimeout(resolve, ceiling / 2 + (Math.random() * ceiling) / 2));
};

/**
 * Takes ACCESS EXCLUSIVE on `entry_heads` for the rest of the migration's transaction without queueing the
 * table's queries for long: each attempt runs in a savepoint with `lock_timeout` 150 ms and is rolled back when
 * it gives up; the attempts go on, with jittered pauses, for up to `totalWaitMs`, then the migration fails with
 * a clear message. The transaction's own `lock_timeout` is left as it was.
 */
export const lockEntryHeads = async (
  db: Kysely<unknown>,
  totalWaitMs = EMPTY_TABLE_LOCK_WAIT_MS,
): Promise<void> => {
  const { rows } = await sql<{ setting: string }>`select current_setting('lock_timeout') as setting`.execute(
    db,
  );
  const previous = rows[0]?.setting ?? '0';
  const deadline = Date.now() + totalWaitMs;
  for (let attempt = 1; ; attempt += 1) {
    await sql`savepoint ${sql.id(LOCK_SAVEPOINT)}`.execute(db);
    try {
      await sql`set local lock_timeout = ${sql.lit(LOCK_ATTEMPT_TIMEOUT)}`.execute(db);
      await sql`lock table entry_heads in access exclusive mode`.execute(db);
      await sql`release savepoint ${sql.id(LOCK_SAVEPOINT)}`.execute(db);
      break;
    } catch (error) {
      await sql`rollback to savepoint ${sql.id(LOCK_SAVEPOINT)}`.execute(db);
      if ((error as { code?: unknown }).code !== LOCK_NOT_AVAILABLE) {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Another transaction kept entry_heads locked for ${Math.round(totalWaitMs / 1000)} s, so the ` +
            'migration could not add its filter data column (pg_locks and pg_stat_activity show which); end ' +
            'that transaction and start Shapio again',
          { cause: error },
        );
      }
    }
    await pause(attempt);
  }
  // Released, the savepoint's `set local` stays for the transaction: put the setting back.
  await sql`select pg_catalog.set_config('lock_timeout', ${previous}, true)`.execute(db);
};

/** Whether `entry_heads` has a row (an ACCESS SHARE lock, which only ACCESS EXCLUSIVE waits for). */
const hasHeads = async (db: Kysely<unknown>): Promise<boolean> => {
  const { rows } = await sql<{
    present: boolean;
  }>`select exists (select 1 from entry_heads) as present`.execute(db);
  return rows[0]?.present ?? false;
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  // A SQL-standard body is parsed now, with its dependencies recorded, so it never depends on search_path.
  // Strings: `length` counts characters (code points), as `FILTER_STRING_MAX_CHARS` in the compiler does.
  await sql`
    create function ${sql.id(FUNCTION)}(data jsonb) returns jsonb
    language sql immutable strict parallel safe
    return case when pg_catalog.jsonb_typeof(data) = 'object' then (
      select coalesce(pg_catalog.jsonb_object_agg(f.key, f.value), '{}'::jsonb)
      from (
        select e.key, case pg_catalog.jsonb_typeof(e.value)
          when 'object' then null
          when 'null' then null
          when 'string' then case when pg_catalog.length(e.value #>> '{}') <= 1000 then e.value end
          when 'array' then (
            select pg_catalog.jsonb_agg(x.value)
            from pg_catalog.jsonb_array_elements(e.value) as x(value)
            where case pg_catalog.jsonb_typeof(x.value)
              when 'object' then false
              when 'array' then false
              when 'string' then pg_catalog.length(x.value #>> '{}') <= 1000
              else true end
          )
          else e.value end as value
        from pg_catalog.jsonb_each(data) as e(key, value)
      ) as f
      where f.value is not null
    ) else '{}'::jsonb end
  `.execute(db);
  const { rows: schemas } = await sql<{ schema: string }>`select current_schema() as schema`.execute(db);
  const schema = schemas[0]?.schema ?? 'public';
  // Schema-qualified: a writer with another search_path (a restore, a maintenance session) still finds it.
  await sql`
    create function ${sql.id(TRIGGER_FUNCTION)}() returns trigger language plpgsql as $body$
    begin
      new.filter_data := ${sql.id(schema, FUNCTION)}(new.data);
      return new;
    end
    $body$
  `.execute(db);
  // An empty table (a new install) is locked and finished here; a populated one is left to the job.
  if (!(await hasHeads(db))) {
    await lockEntryHeads(db);
    // A head written before the lock was granted leaves the table to the job after all.
    if (!(await hasHeads(db))) {
      await sql`alter table entry_heads add column filter_data jsonb`.execute(db);
      await sql`
        create trigger ${sql.id(TRIGGER)} before insert or update of data, filter_data on entry_heads
        for each row execute function ${sql.id(TRIGGER_FUNCTION)}()
      `.execute(db);
      await sql`alter table entry_heads add constraint ${sql.id(CHECK)} check (filter_data is not null)`.execute(
        db,
      );
      await sql`create index ${sql.id(FILTER_INDEX)} on entry_heads using gin (filter_data jsonb_path_ops)`.execute(
        db,
      );
      await sql`drop index if exists ${sql.id(DOCUMENT_INDEX)}`.execute(db);
      return;
    }
  }
  await sql`
    insert into jobs (type, payload, max_attempts, idempotency_key)
    values (${CONTENT_FILTER_INDEX_JOB}, '{}'::jsonb, 5, ${CONTENT_FILTER_INDEX_KEY})
    on conflict do nothing
  `.execute(db);
};

/**
 * Back to the whole-document index. With heads present its build blocks writes until it finishes (a
 * downgrade only; the code before this migration has no job to build it).
 */
export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`delete from jobs where idempotency_key in (${CONTENT_FILTER_INDEX_KEY}, ${CONTENT_DOCUMENT_INDEX_DROP_KEY})`.execute(
    db,
  );
  await sql`create index if not exists ${sql.id(DOCUMENT_INDEX)} on entry_heads using gin (data jsonb_path_ops)`.execute(
    db,
  );
  await sql`drop index if exists ${sql.id(FILTER_INDEX)}`.execute(db);
  await sql`drop index if exists ${sql.id(DRAFT_SCALARS_INDEX)}`.execute(db);
  await sql`drop trigger if exists ${sql.id(TRIGGER)} on entry_heads`.execute(db);
  await sql`drop function if exists ${sql.id(TRIGGER_FUNCTION)}()`.execute(db);
  await sql`alter table entry_heads drop constraint if exists ${sql.id(CHECK)}`.execute(db);
  await sql`alter table entry_heads drop column if exists filter_data`.execute(db);
  await sql`drop function if exists ${sql.id(FUNCTION)}(jsonb)`.execute(db);
};
