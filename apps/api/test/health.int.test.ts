import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { useTestDatabase } from './helpers/testDatabase.js';

describe('health endpoints', () => {
  const database = useTestDatabase();
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp(database.current);
  });
  afterAll(() => testApp.app.close());

  it('GET /api/health reports liveness', async () => {
    const response = await testApp.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/ready is 200 when the database answers and migrations are current', async () => {
    const response = await testApp.app.inject({ method: 'GET', url: '/api/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready', checks: { database: 'ok', migrations: 'ok' } });
  });

  it('GET /api/version reports the package version', async () => {
    const response = await testApp.app.inject({ method: 'GET', url: '/api/version' });
    expect(response.json()).toMatchObject({ name: 'shapio', version: expect.any(String) as unknown });
  });

  it('GET /api/ready is 503 NOT_READY when a migration is pending', async () => {
    const { db } = testApp;
    const [latest] = await sql<{ name: string; timestamp: string }>`
      select name, timestamp from kysely_migration order by name desc limit 1`
      .execute(db)
      .then((r) => r.rows);
    await sql`delete from kysely_migration where name = ${latest!.name}`.execute(db);
    try {
      const response = await testApp.app.inject({ method: 'GET', url: '/api/ready' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        error: { code: 'NOT_READY', details: { pendingMigrations: [latest!.name] } },
      });
    } finally {
      await sql`insert into kysely_migration (name, timestamp) values (${latest!.name}, ${latest!.timestamp})`.execute(
        db,
      );
    }
  });

  it('returns the standard error shape for unknown routes', async () => {
    const response = await testApp.app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /api/does-not-exist not found' },
    });
  });
});
