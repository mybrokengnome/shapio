import { resolve } from 'node:path';
import { sql } from 'kysely';
import type { Database } from '../../src/db/index.js';
import type { Worker } from '../../src/jobs/worker.js';
import { testColumnTypes } from './dialect.js';
import { API_ROOT } from './env.js';
import { waitFor } from './waitFor.js';

/** The extension-point test project (package K): every hook records itself in `ext_hook_log`. */
export const FIXTURE_CONFIG = resolve(API_ROOT, 'test/fixtures/extensionProject/shapio.config.ts');
export const REPO_ROOT = resolve(API_ROOT, '../..');

export const createHookLog = (db: Database) => {
  const types = testColumnTypes();
  return sql`
    create table ext_hook_log (
      id ${types.serialKey}, hook text not null, entry_id ${types.uuid} not null, locale text, principal text not null,
      data ${types.jsonb}, ${sql.id('before')} ${types.jsonb}, event_id text
    )
  `.execute(db);
};

/** Hook names recorded for an entry, in the order they ran. */
export const hooksOf = async (db: Database, entryId: string) =>
  (
    await sql<{
      hook: string;
    }>`select hook from ext_hook_log where entry_id = ${entryId} order by id`.execute(db)
  ).rows.map((row) => row.hook);

/** Ticks the worker (relay + jobs) until no job is due or running and every outbox event is dispatched. */
export const drainWorker = (worker: Worker, db: Database) =>
  waitFor(
    async () => {
      await worker.tick();
      await waitFor(async () => worker.runningJobIds.size === 0);
      const open = await db
        .selectFrom('jobs')
        .select('id')
        .where((eb) =>
          eb.or([
            eb('status', '=', 'running'),
            eb.and([eb('status', '=', 'pending'), eb('run_at', '<=', new Date())]),
          ]),
        )
        .execute();
      const undispatched = await db
        .selectFrom('outbox_events')
        .select('id')
        .where('dispatched_at', 'is', null)
        .execute();
      return open.length === 0 && undispatched.length === 0;
    },
    { timeoutMs: 15_000 },
  );
