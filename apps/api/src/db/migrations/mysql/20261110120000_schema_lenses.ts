import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import {
  LENS_HISTORY_BACKFILL_JOB,
  LENS_HISTORY_BACKFILL_KEY,
  LENS_HISTORY_BACKFILL_KEYS,
} from '../20261110120000_schema_lenses.js';

/**
 * MySQL twin of `../20261110120000_schema_lenses.ts`. `insert ignore` stands in for `on conflict do nothing`
 * (the jobs' idempotency key).
 */
const UUID = sql.raw('char(36) character set ascii collate ascii_general_ci');

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table \`schema_activations\` (
      \`model_id\` ${UUID} not null,
      \`schema_version\` int not null,
      \`site_id\` ${UUID},
      \`revision_id\` ${UUID},
      \`backfilled\` tinyint(1) not null default 0,
      \`created_at\` datetime(6) not null default current_timestamp(6),
      constraint \`schema_activations_pkey\` primary key (\`model_id\`, \`schema_version\`),
      constraint \`schema_activations_model_id_fkey\` foreign key (\`model_id\`)
        references \`models\` (\`id\`) on delete cascade,
      constraint \`schema_activations_revision_id_fkey\` foreign key (\`revision_id\`)
        references \`schema_revisions\` (\`id\`)
    )
  `.execute(db);
  await sql`create index \`schema_activations_version_idx\` on \`schema_activations\` (\`schema_version\`)`.execute(
    db,
  );
  await sql`
    insert into \`schema_activations\`
      (\`model_id\`, \`schema_version\`, \`site_id\`, \`revision_id\`, \`backfilled\`, \`created_at\`)
    select active.\`model_id\`, active.\`schema_version\`, m.\`site_id\`, active.\`revision_id\`, 1, active.\`activated_at\`
    from \`model_active_versions\` active
    join \`models\` m on m.\`id\` = active.\`model_id\`
  `.execute(db);
  await sql`
    insert ignore into \`jobs\` (\`type\`, \`payload\`, \`max_attempts\`, \`idempotency_key\`)
    select ${LENS_HISTORY_BACKFILL_JOB}, json_object(), 5, ${LENS_HISTORY_BACKFILL_KEY}
    from dual
    where exists (select 1 from \`schema_activations\`)
  `.execute(db);
  // MySQL refuses to add a column whose default calls `uuid()` to a table with rows (unsafe for the binary
  // log), and its `uuid()` is time-based: the one row gets a random ID first, then the column its default.
  await sql`alter table \`system_versions\` add column \`schema_id\` ${UUID}`.execute(db);
  await sql`update \`system_versions\` set \`schema_id\` = ${randomUUID()}`.execute(db);
  await sql`alter table \`system_versions\` modify column \`schema_id\` ${UUID} not null default (uuid())`.execute(
    db,
  );
  await sql`alter table \`token_reads\` add column \`last_schema_version\` int`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table \`token_reads\` drop column \`last_schema_version\``.execute(db);
  await sql`alter table \`system_versions\` drop column \`schema_id\``.execute(db);
  await sql`delete from \`jobs\` where \`idempotency_key\` in (${sql.join([...LENS_HISTORY_BACKFILL_KEYS])})`.execute(
    db,
  );
  await sql`drop table \`schema_activations\``.execute(db);
};
