import { sql, type Kysely } from 'kysely';

/**
 * MySQL twin of `../20261003170000_audit_events_seq.ts`: `seq` is `AUTO_INCREMENT`, which InnoDB only allows
 * on an indexed column, hence `audit_events_seq_key` (MySQL only; PostgreSQL and SQLite need no index for a
 * tiebreaker). Existing rows are numbered in primary-key order. `db/mysql/tables.ts` lists `seq` as the
 * table's identity, so an insert's emulated RETURNING finds its row by `LAST_INSERT_ID()`.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table \`audit_events\`
    add column \`seq\` bigint not null auto_increment,
    add unique key \`audit_events_seq_key\` (\`seq\`)`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table \`audit_events\` drop column \`seq\``.execute(db);
};
