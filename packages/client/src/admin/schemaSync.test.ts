import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../client.js';

describe('schema sync api', () => {
  it('exports and applies through /api/admin/schema', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ schemaVersion: 2, definitions: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = createClient({ baseUrl: 'https://cms.test', fetch });
    await expect(client.admin.schema.export()).resolves.toEqual({ schemaVersion: 2, definitions: [] });
    const base = { formatVersion: 1 as const, schemaVersion: 2, definitions: {} };
    await client.admin.schema.apply({
      definitions: [],
      base,
      prune: false,
      dryRun: true,
      acknowledgeBreaking: false,
      acknowledgeDestructive: false,
    });
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]?.[0]).toBe('https://cms.test/api/admin/schema/export');
    expect(calls[1]?.[0]).toBe('https://cms.test/api/admin/schema/apply');
    expect(calls[1]?.[1].method).toBe('POST');
    expect(JSON.parse(calls[1]?.[1].body as string)).toMatchObject({ base, dryRun: true });
  });
});
