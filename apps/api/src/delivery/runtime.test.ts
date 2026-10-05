import { describe, expect, it } from 'vitest';
import { DeliveryRuntimeError } from './errors.js';
import { createDeliveryRuntime } from './runtime.js';

describe('createDeliveryRuntime', () => {
  it('refuses SQLite, which only one process may serve', () => {
    expect(() => createDeliveryRuntime({ databaseUrl: 'sqlite:./shapio.db' })).toThrow(
      /needs PostgreSQL or MySQL/,
    );
  });

  it('refuses a URL that names no supported database', () => {
    expect(() => createDeliveryRuntime({ databaseUrl: 'redis://localhost' })).toThrow(DeliveryRuntimeError);
  });

  it("refuses onVersionSkew: 'http' without the server's URL", () => {
    expect(() =>
      createDeliveryRuntime({ databaseUrl: 'postgres://localhost/shapio', onVersionSkew: 'http' }),
    ).toThrow(/fallbackUrl/);
  });

  it('shares one runtime per database and refuses a second database in the process', async () => {
    // Pools connect on first query only; nothing here reaches a server.
    const first = createDeliveryRuntime({ databaseUrl: 'postgres://user:secret@localhost/one' });
    try {
      expect(createDeliveryRuntime({ databaseUrl: 'postgres://user:secret@localhost/one' })).toBe(first);
      const refusal = () => createDeliveryRuntime({ databaseUrl: 'postgres://localhost/two' });
      expect(refusal).toThrow(/one Shapio database per process/);
      expect(refusal).not.toThrow(/secret/);
    } finally {
      await first.close();
    }
    const again = createDeliveryRuntime({ databaseUrl: 'postgres://localhost/two' });
    expect(again).not.toBe(first);
    await again.close();
  });
});

describe('a shared runtime', () => {
  it('closes when its last user releases it', async () => {
    const runtime = createDeliveryRuntime({ databaseUrl: 'postgres://localhost/shared' });
    const releaseA = runtime.retain();
    const releaseB = runtime.retain();
    await releaseA();
    await releaseA();
    expect(createDeliveryRuntime({ databaseUrl: 'postgres://localhost/shared' })).toBe(runtime);
    await releaseB();
    const next = createDeliveryRuntime({ databaseUrl: 'postgres://localhost/shared' });
    expect(next).not.toBe(runtime);
    await next.close();
  });
});
