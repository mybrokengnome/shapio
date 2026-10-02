import { sql, type Kysely } from 'kysely';

/**
 * The snapshot diff (repositories/snapshotDiff.ts) finds the (entry, locale) pairs whose live period opened
 * or closed between two publication sequence numbers, then reads each pair's live revision at both ends.
 * - `to_seq` range: periods that closed in the range (the open ones have no `to_seq` and are left out).
 * - `(entry_id, locale, from_seq)`: "the row live at seq N" is the latest row starting at or before N.
 * Periods that opened in the range use the existing `(model_id, from_seq)` index.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`create index publication_log_to_seq_idx on publication_log (to_seq) where to_seq is not null`.execute(
    db,
  );
  await db.schema
    .createIndex('publication_log_entry_locale_from_idx')
    .on('publication_log')
    .columns(['entry_id', 'locale', 'from_seq'])
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropIndex('publication_log_entry_locale_from_idx').execute();
  await db.schema.dropIndex('publication_log_to_seq_idx').execute();
};
