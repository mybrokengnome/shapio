import { describe, expect, it } from 'vitest';
import { resolveSigningSecret, SIGNING_SECRET_SETTING } from '../src/services/signingSecret.js';
import { createTestApp } from './helpers/createTestApp.js';
import { createLogCapture } from './helpers/logCapture.js';
import { createTestDatabase, useTestDatabase } from './helpers/testDatabase.js';

const GENERATED_LINE = 'Generated signing secret; set SESSION_SECRET to pin it';

describe('signing secret', () => {
  const database = useTestDatabase();

  const storedRows = () =>
    database.current.db
      .selectFrom('system_settings')
      .select('value')
      .where('key', '=', SIGNING_SECRET_SETTING)
      .execute();

  it('is generated once, stored, never logged, and stable across restarts', async () => {
    const logs = createLogCapture();
    const first = await createTestApp(database.current, { logger: logs.logger });
    const secret = first.app.signingSecret;
    await first.app.close();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await storedRows()).toEqual([{ value: secret }]);
    expect(logs.lines.filter((line) => line.includes(GENERATED_LINE))).toHaveLength(1);
    expect(logs.text()).not.toContain(secret);

    const restartLogs = createLogCapture();
    const second = await createTestApp(database.current, { logger: restartLogs.logger });
    expect(second.app.signingSecret).toBe(secret);
    await second.app.close();
    expect(restartLogs.text()).not.toContain(GENERATED_LINE);
  });

  it('uses SESSION_SECRET when set, without touching the stored one', async () => {
    const before = await storedRows();
    const pinned = 'p'.repeat(40);
    const { app } = await createTestApp(database.current, { env: { SESSION_SECRET: pinned } });
    expect(app.signingSecret).toBe(pinned);
    await app.close();
    expect(await storedRows()).toEqual(before);
  });

  it('gives concurrent first boots one value', async () => {
    const fresh = await createTestDatabase();
    try {
      const logs = createLogCapture();
      const secrets = await Promise.all(
        Array.from({ length: 8 }, () => resolveSigningSecret(fresh.db, undefined, logs.logger)),
      );
      expect(new Set(secrets).size).toBe(1);
      const rows = await fresh.db.selectFrom('system_settings').selectAll().execute();
      expect(rows).toHaveLength(1);
      expect(logs.lines.filter((line) => line.includes(GENERATED_LINE))).toHaveLength(1);
    } finally {
      await fresh.drop();
    }
  });
});
