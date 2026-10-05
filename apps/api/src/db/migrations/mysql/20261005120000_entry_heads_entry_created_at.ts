import { sql, type Kysely } from 'kysely';

/**
 * MySQL twin of `../20261005120000_entry_heads_entry_created_at.ts`. The column is added `ALGORITHM=INSTANT`
 * and backfilled in batches; the index is built online (`ALGORITHM=INPLACE, LOCK=NONE`), so writes continue.
 * It is one more index of `entry_heads`, which is why `MYSQL_MAX_FIELD_INDEXES` (db/limits.ts) went down by one.
 */
const INDEX = 'entry_heads_entry_order_idx';
const BATCH = 5000;

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table \`entry_heads\` add column \`entry_created_at\` datetime(6), algorithm=instant`.execute(
    db,
  );
  for (;;) {
    const result = await sql`update \`entry_heads\` set \`entry_created_at\` = (
      select e.\`created_at\` from \`entries\` e where e.\`id\` = \`entry_heads\`.\`entry_id\`
    ) where \`entry_created_at\` is null limit ${sql.lit(BATCH)}`.execute(db);
    if (Number(result.numAffectedRows ?? 0n) < BATCH) {
      break;
    }
  }
  await sql`create index ${sql.id(INDEX)} on \`entry_heads\`
    (\`site_id\`, \`model_id\`, \`state\`, \`entry_created_at\` desc, \`entry_id\`) algorithm=inplace lock=none`.execute(
    db,
  );
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop index ${sql.id(INDEX)} on \`entry_heads\``.execute(db);
  await sql`alter table \`entry_heads\` drop column \`entry_created_at\``.execute(db);
};
