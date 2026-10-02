import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export const get = (executor: Executor = db) =>
  executor
    .selectFrom('schema_settings')
    .select(['read_only', 'read_only_reason', 'updated_at', 'updated_by_type', 'updated_by_id'])
    .executeTakeFirstOrThrow();

export type SchemaSettingsRow = Awaited<ReturnType<typeof get>>;

export const update = (
  settings: { readOnly: boolean; reason: string | null; byType: string; byId: string | null; now: Date },
  trx: Executor = db,
) =>
  trx
    .updateTable('schema_settings')
    .set({
      read_only: settings.readOnly,
      read_only_reason: settings.reason,
      updated_by_type: settings.byType,
      updated_by_id: settings.byId,
      updated_at: settings.now,
    })
    .execute();
