import { shapioTags as clientTags } from '@shapio/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import packageJson from '../package.json' with { type: 'json' };
import { createLocalClient, DeliveryRuntimeError, SHAPIO_VERSION } from './index.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createLocalClient', () => {
  it('refuses SQLite with an error users can recognise', () => {
    const create = () => createLocalClient({ databaseUrl: 'sqlite:./shapio.db' });
    expect(create).toThrow(DeliveryRuntimeError);
    expect(create).toThrow(/PostgreSQL or MySQL/);
  });

  it('refuses the Edge runtime before touching the database', () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    expect(() => createLocalClient({ databaseUrl: 'postgres://localhost/shapio' })).toThrow(
      /Node\.js runtime/,
    );
  });

  it("gives the client's delivery, site and snapshot groups, and a close that shares the pool", async () => {
    // Nothing connects until the first read.
    const first = createLocalClient({ databaseUrl: 'postgres://localhost/local-unit' });
    const second = createLocalClient({ databaseUrl: 'postgres://localhost/local-unit', token: 'shp_x' });
    expect(Object.keys(first).sort()).toEqual(['close', 'delivery', 'site', 'snapshots']);
    await first.close();
    await second.close();
  });

  it('in drafts mode, refuses a pinned snapshot before touching the database', async () => {
    const client = createLocalClient({ databaseUrl: 'postgres://localhost/local-unit', drafts: true });
    await expect(client.delivery.list('articles', { snapshot: 2 })).rejects.toThrow(/snapshot/);
    await client.close();
  });

  it('reads the release it is published as (the server must run the same one)', () => {
    expect(SHAPIO_VERSION).toBe(packageJson.version);
  });
});

describe('@shapio/local/next', () => {
  it('re-exports the cache tags HTTP reads carry', async () => {
    const next = await import('./next.js');
    expect(next.shapioTags).toBe(clientTags);
  });

  it('refuses to load on the Edge runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.resetModules();
    await expect(import('./next.js')).rejects.toThrow(/Node\.js runtime/);
  });
});
