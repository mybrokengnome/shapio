import type { Kysely } from 'kysely';
import { db } from '../db/index.js';
import { getPendingMigrations } from '../db/migrator.js';
import { pingDatabase } from '../db/sql/health.js';
import type { DB } from '../db/types.js';

export const ping = (executor: Kysely<DB> = db): Promise<void> => pingDatabase(executor);

export const listPendingMigrations = (executor: Kysely<DB> = db): Promise<string[]> =>
  getPendingMigrations(executor);
