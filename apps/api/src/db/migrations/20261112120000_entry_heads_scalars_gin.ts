import { sql, type Kysely } from 'kysely';

/**
 * Filter data (ADR 0001, "Filter data"). Equality on a field without its own index is containment,
 * `{fieldId: scalar}` or `{fieldId: [scalar]}`, which a GIN `jsonb_path_ops` index serves. Indexing the whole
 * `data` also indexed every leaf of every component item, item IDs included, which no query can use, and
 * rechecking a match meant reading the whole document back. `entry_heads.filter_data` holds
 * `shapio_scalar_fields(data)`: the top-level fields such a document can match. The function drops a field
 * whose value is null, an object, or an array with no scalar element; keeping more is always safe, dropping
 * only those leaves every containment answer unchanged.
 *
 * - The column is added nullable (a catalog-only change). The trigger `entry_heads_filter_data` keeps it on
 *   every insert and on every update that names `data` or `filter_data`, whoever writes, so no application code
 *   maintains it and no write can store anything else in it.
 * - A new install (no heads) gets the check `entry_heads_filter_data_present` and the index
 *   `entry_heads_filter_data_gin` here, and loses the whole-document index.
 * - With heads present, the `schema.contentFilterIndex` job this migration enqueues fills the column on the rows
 *   written before the trigger, adds the check `NOT VALID` and validates it, and builds the index
 *   `CONCURRENTLY` (schema/planner/contentFilterIndex.ts), so writes continue throughout; queries keep the
 *   whole-document index until the check is validated and the new index is valid, and a later job drops it.
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

export const up = async (db: Kysely<unknown>): Promise<void> => {
  // A SQL-standard body is parsed now, with its dependencies recorded, so it never depends on search_path.
  await sql`
    create function ${sql.id(FUNCTION)}(data jsonb) returns jsonb
    language sql immutable strict parallel safe
    return (
      select coalesce(pg_catalog.jsonb_object_agg(e.key, e.value), '{}'::jsonb)
      from pg_catalog.jsonb_each(data) as e(key, value)
      where case pg_catalog.jsonb_typeof(e.value)
        when 'object' then false
        when 'null' then false
        when 'array' then pg_catalog.jsonb_path_exists(e.value,
          'strict $[*] ? (@.type() != "object" && @.type() != "array")')
        else true end
    )
  `.execute(db);
  await sql`alter table entry_heads add column filter_data jsonb`.execute(db);
  await sql`
    create function ${sql.id(TRIGGER_FUNCTION)}() returns trigger language plpgsql as $$
    begin
      new.filter_data := shapio_scalar_fields(new.data);
      return new;
    end
    $$
  `.execute(db);
  // Creating the trigger waits for writes in flight and holds later ones until this migration commits, so every
  // row written after it has its filter data.
  await sql`
    create trigger ${sql.id(TRIGGER)} before insert or update of data, filter_data on entry_heads
    for each row execute function ${sql.id(TRIGGER_FUNCTION)}()
  `.execute(db);
  const { rows } = await sql<{
    present: boolean;
  }>`select exists (select 1 from entry_heads) as present`.execute(db);
  if (rows[0]?.present) {
    await sql`
      insert into jobs (type, payload, max_attempts, idempotency_key)
      values (${CONTENT_FILTER_INDEX_JOB}, '{}'::jsonb, 5, ${CONTENT_FILTER_INDEX_KEY})
      on conflict do nothing
    `.execute(db);
    return;
  }
  await sql`alter table entry_heads add constraint ${sql.id(CHECK)} check (filter_data is not null)`.execute(
    db,
  );
  await sql`create index ${sql.id(FILTER_INDEX)} on entry_heads using gin (filter_data jsonb_path_ops)`.execute(
    db,
  );
  await sql`drop index if exists ${sql.id(DOCUMENT_INDEX)}`.execute(db);
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
