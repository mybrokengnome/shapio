import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as postgresMigration from '../src/db/migrations/20261110120000_schema_lenses.js';
import * as mysqlMigration from '../src/db/migrations/mysql/20261110120000_schema_lenses.js';
import * as sqliteMigration from '../src/db/migrations/sqlite/20261110120000_schema_lenses.js';
import * as jobsRepository from '../src/repositories/jobs.js';
import { getSchemaId } from '../src/repositories/schemaVersions.js';
import { LENS_HISTORY_BACKFILL_JOB, LENS_HISTORY_BACKFILL_KEY } from '../src/schema/lens/history.js';
import { expectStatus } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { testDialect } from './helpers/dialect.js';
import { createRoleToken, schemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const MIGRATIONS = { postgres: postgresMigration, mysql: mysqlMigration, sqlite: sqliteMigration } as const;

/**
 * The schema lenses migration on every dialect: a baseline history row per live definition (backfilled, in
 * the definition's scope), the backfill job enqueued once, a schema ID written once, and a `down` that
 * removes all of it.
 */
describe('migration: schema lenses', () => {
  const database = useTestDatabase();
  const { up, down } = MIGRATIONS[testDialect()];
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('writes the baseline, enqueues the backfill once and rolls back', async () => {
    const { db } = database.current;
    const admin = schemaClient(testApp.app, await createRoleToken(db));
    const created = expectStatus(
      await admin.post('/api/admin/models', {
        definition: {
          kind: 'collection',
          apiKey: 'post',
          label: 'Post',
          fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
        },
      }),
      201,
    ).json<{ definitionId: string }>();
    const pointer = await db
      .selectFrom('model_active_versions')
      .selectAll()
      .where('model_id', '=', created.definitionId)
      .executeTakeFirstOrThrow();
    const model = await db
      .selectFrom('models')
      .select('site_id')
      .where('id', '=', created.definitionId)
      .executeTakeFirstOrThrow();
    const schemaId = await getSchemaId(db);

    const migrationDb = db as unknown as Kysely<unknown>;
    await down(migrationDb);
    await up(migrationDb);

    expect(
      await db
        .selectFrom('schema_activations')
        .select(['model_id', 'schema_version', 'site_id', 'revision_id', 'backfilled'])
        .execute(),
    ).toEqual([
      {
        model_id: created.definitionId,
        schema_version: pointer.schema_version,
        site_id: model.site_id,
        revision_id: pointer.revision_id,
        backfilled: true,
      },
    ]);
    expect(await jobsRepository.findByIdempotencyKey(LENS_HISTORY_BACKFILL_KEY, db)).toMatchObject({
      type: LENS_HISTORY_BACKFILL_JOB,
      status: 'pending',
    });
    const newId = await getSchemaId(db);
    expect(newId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(newId).not.toBe(schemaId);
    expect(await db.selectFrom('token_reads').select('last_schema_version').limit(1).execute()).toEqual([]);

    // Running up again (after down) keeps one job.
    await down(migrationDb);
    expect(await jobsRepository.findByIdempotencyKey(LENS_HISTORY_BACKFILL_KEY, db)).toBeUndefined();
    await up(migrationDb);
    const jobs = await db
      .selectFrom('jobs')
      .select('id')
      .where('idempotency_key', '=', LENS_HISTORY_BACKFILL_KEY)
      .execute();
    expect(jobs).toHaveLength(1);

    // A finished backfill does not stop the next `up` from enqueueing it again.
    await db
      .updateTable('jobs')
      .set({ status: 'succeeded' })
      .where('idempotency_key', '=', LENS_HISTORY_BACKFILL_KEY)
      .execute();
    await down(migrationDb);
    expect(await jobsRepository.findByIdempotencyKey(LENS_HISTORY_BACKFILL_KEY, db)).toBeUndefined();
    await up(migrationDb);
    expect(await jobsRepository.findByIdempotencyKey(LENS_HISTORY_BACKFILL_KEY, db)).toMatchObject({
      status: 'pending',
    });
  });

  it.runIf(testDialect() === 'mysql')(
    'runs up again on MySQL after an interrupted run (DDL is not transactional)',
    async () => {
      const { db } = database.current;
      const migrationDb = db as unknown as Kysely<unknown>;
      const schemaId = await getSchemaId(db);
      // An interrupted run left the table and the first column; up finishes without redoing or failing.
      await db.schema.alterTable('token_reads').dropColumn('last_schema_version').execute();
      await up(migrationDb);
      await up(migrationDb);
      expect(await getSchemaId(db)).toBe(schemaId);
      expect(await db.selectFrom('token_reads').select('last_schema_version').limit(1).execute()).toEqual([]);
    },
  );
});
