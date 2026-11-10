import type * as CmsDelivery from '@shapio/cms/delivery';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Records the credentials each local client hands the in-process transport, without touching a database. */
const transportCredentials: CmsDelivery.CallCredentials[] = [];

vi.mock('@shapio/cms/delivery', async (importOriginal) => {
  const original = await importOriginal<typeof CmsDelivery>();
  return {
    ...original,
    createInProcessRequest: (...args: Parameters<typeof original.createInProcessRequest>) => {
      transportCredentials.push(args[1]);
      return original.createInProcessRequest(...args);
    },
  };
});

const { createLocalClient, DeliveryRuntimeError } = await import('./index.js');

const DATABASE_URL = 'postgres://localhost/local-workspace-unit';

afterEach(() => {
  transportCredentials.length = 0;
});

describe('createLocalClient workspace option', () => {
  it('names the workspace the same way with workspace and with site', async () => {
    const byWorkspace = createLocalClient({ databaseUrl: DATABASE_URL, token: 'shp_x', workspace: 'blog' });
    const bySite = createLocalClient({ databaseUrl: DATABASE_URL, token: 'shp_x', site: 'blog' });
    expect(transportCredentials).toEqual([
      { token: 'shp_x', site: 'blog' },
      { token: 'shp_x', site: 'blog' },
    ]);
    expect(byWorkspace.workspace).toBe(byWorkspace.site);
    expect(Object.keys(byWorkspace).sort()).toEqual(Object.keys(bySite).sort());
    await byWorkspace.close();
    await bySite.close();
  });

  it('accepts both when they agree, and refuses them when they differ', async () => {
    const agreeing = createLocalClient({ databaseUrl: DATABASE_URL, workspace: 'blog', site: 'blog' });
    expect(transportCredentials).toEqual([{ site: 'blog' }]);
    await agreeing.close();

    const create = () => createLocalClient({ databaseUrl: DATABASE_URL, workspace: 'blog', site: 'docs' });
    expect(create).toThrow(DeliveryRuntimeError);
    expect(create).toThrow(
      /createLocalClient: the workspace option \('blog'\) and the site option \('docs'\)/,
    );
    expect(transportCredentials).toEqual([{ site: 'blog' }]);
  });
});
