import type { RequestFn } from '@shapio/client';
import type * as CmsDelivery from '@shapio/cms/delivery';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** The paths each local client hands the in-process transport, answered without touching a database. */
const transportPaths: string[] = [];

vi.mock('@shapio/cms/delivery', async (importOriginal) => {
  const original = await importOriginal<typeof CmsDelivery>();
  return {
    ...original,
    createInProcessRequest: (() =>
      (async (path: string) => {
        transportPaths.push(path);
        return { data: [], meta: { locale: 'en', snapshot: 1, pagination: { pageCount: 1 } } };
      }) as RequestFn) satisfies (...args: Parameters<typeof original.createInProcessRequest>) => RequestFn,
  };
});

const { createLocalClient } = await import('./index.js');

const DATABASE_URL = 'postgres://localhost/local-schema-version-unit';
const TOKEN = '9f1c2a7e-0d3b-4c55-9a51-6b3f0e2d7c11:42';
const ENCODED = encodeURIComponent(TOKEN);

afterEach(() => {
  transportPaths.length = 0;
});

describe('createLocalClient schemaVersion option', () => {
  it('names the schema version in every path it hands the in-process transport', async () => {
    const client = createLocalClient({ databaseUrl: DATABASE_URL, workspace: 'blog', schemaVersion: TOKEN });
    await client.delivery.list('articles', { locale: 'fr' });
    await client.delivery.get('articles', 'e1');
    await client.workspace.get();
    await client.snapshots.current();
    expect(transportPaths).toEqual([
      `/api/content/articles?locale=fr&schemaVersion=${ENCODED}`,
      `/api/content/articles/e1?schemaVersion=${ENCODED}`,
      `/api/site?schemaVersion=${ENCODED}`,
      `/api/snapshots/current?schemaVersion=${ENCODED}`,
    ]);
    await client.close();
  });

  it('sends no schema version when none is named', async () => {
    const client = createLocalClient({ databaseUrl: DATABASE_URL });
    await client.delivery.list('articles');
    expect(transportPaths).toEqual(['/api/content/articles']);
    await client.close();
  });
});
