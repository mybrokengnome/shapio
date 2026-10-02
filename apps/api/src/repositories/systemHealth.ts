import { sql, type Kysely } from 'kysely';
import { db } from '../db/index.js';
import { getPendingMigrations } from '../db/migrator.js';
import type { DB } from '../db/types.js';

export const ping = async (executor: Kysely<DB> = db): Promise<void> => {
  await sql`select 1`.execute(executor);
};

export const listPendingMigrations = (executor: Kysely<DB> = db): Promise<string[]> =>
  getPendingMigrations(executor);
