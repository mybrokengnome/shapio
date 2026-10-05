import { describe, expect, it } from 'vitest';
import { DeliveryRuntimeError } from './errors.js';
import { createDeliveryRuntime } from './runtime.js';

describe('createDeliveryRuntime', () => {
  it('refuses SQLite, which only one process may serve', async () => {
    await expect(createDeliveryRuntime({ databaseUrl: 'sqlite:./shapio.db' })).rejects.toThrow(
      /needs PostgreSQL or MySQL/,
    );
  });

  it('refuses a URL that names no supported database', async () => {
    await expect(createDeliveryRuntime({ databaseUrl: 'redis://localhost' })).rejects.toBeInstanceOf(
      DeliveryRuntimeError,
    );
  });

  it("refuses onVersionSkew: 'http' without the server's URL", async () => {
    await expect(
      createDeliveryRuntime({ databaseUrl: 'postgres://localhost/shapio', onVersionSkew: 'http' }),
    ).rejects.toThrow(/fallbackUrl/);
  });

  it('shares one runtime per database and refuses a second database in the process', async () => {
    // Pools connect on first query only; nothing here reaches a server.
    const first = await createDeliveryRuntime({ databaseUrl: 'postgres://user:secret@localhost/one' });
    try {
      expect(await createDeliveryRuntime({ databaseUrl: 'postgres://user:secret@localhost/one' })).toBe(
        first,
      );
      const refusal = createDeliveryRuntime({ databaseUrl: 'postgres://localhost/two' });
      await expect(refusal).rejects.toThrow(/one Shapio database per process/);
      await expect(refusal).rejects.not.toThrow(/secret/);
    } finally {
      await first.close();
    }
    const again = await createDeliveryRuntime({ databaseUrl: 'postgres://localhost/two' });
    expect(again).not.toBe(first);
    await again.close();
  });
});
