import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDeliveryToken } from './helpers/content.js';
import { createRoleToken } from './helpers/schemaAdmin.js';
import { spawnServer, type SpawnedServer } from './helpers/spawnServer.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

const RATE_LIMIT_MAX = 300;
/**
 * A pathological request must be answered (refused) quickly, never tie up the process. Executing any of these
 * would take minutes or forever; the bound leaves room for a slow CI runner without hiding that.
 */
const QUICK_MS = 5000;

const measure = (name: string, value: number, unit = 'ms') =>
  process.stdout.write(`[measure] limits: ${name} = ${Math.round(value)} ${unit}\n`);

/**
 * Abuse limits against a real server process: GraphQL queries built to be expensive, and request bursts
 * over the rate limit. The process must refuse them promptly and keep serving everyone else.
 */
describe('limits under abuse', { timeout: 60_000 }, () => {
  const database = useTestDatabase();
  let server: SpawnedServer;
  let token: string;

  const graphql = async (query: string) => {
    const started = performance.now();
    const response = await fetch(`${server.url}/api/graphql`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json()) as { errors?: Array<{ extensions?: { code?: string } }> };
    return {
      status: response.status,
      codes: (body.errors ?? []).map((error) => error.extensions?.code ?? 'NONE'),
      ms: performance.now() - started,
    };
  };
  /** The status of a liveness probe after an abusive request: 200 means the process kept serving. */
  const healthStatus = async () => (await fetch(`${server.url}/api/health`)).status;

  beforeAll(async () => {
    server = await spawnServer({
      DATABASE_URL: database.current.url,
      MIGRATE_ON_START: 'false',
      RATE_LIMIT_MAX: String(RATE_LIMIT_MAX),
      // Longer than the whole file takes on a slow runner, so the window never resets mid-burst.
      RATE_LIMIT_WINDOW_MS: '600000',
    });
    const admin = await waitFor(async () => createRoleToken(database.current.db).catch(() => undefined), {
      description: 'an admin token (the server seeds the built-in roles at startup)',
    });
    const created = await fetch(`${server.url}/api/admin/models`, {
      method: 'POST',
      headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        definition: {
          kind: 'collection',
          apiKey: 'folder',
          label: 'Folder',
          fields: [{ apiKey: 'label', label: 'Label', type: 'string' }],
        },
      }),
    });
    const { definitionId } = (await created.json()) as { definitionId: string };
    token = await createDeliveryToken(database.current.db, [{ modelId: definitionId }]);
  });
  afterAll(async () => {
    await server?.stop('SIGTERM');
  });

  it('refuses a fragment bomb (each fragment spreads the next twice) quickly', async () => {
    const levels = 40;
    const fragments = Array.from({ length: levels }, (_, level) =>
      level === levels - 1
        ? `fragment F${level} on Folder { label }`
        : `fragment F${level} on Folder { ...F${level + 1} ...F${level + 1} }`,
    ).join('\n');
    const result = await graphql(`
      {
        folders {
          nodes {
            ...F0
          }
        }
      }
      ${fragments}
    `);
    measure('fragment bomb (40 levels, 2^40 expansions) answered in', result.ms);
    expect(result.ms).toBeLessThan(QUICK_MS);
    expect(result.status).toBe(400);
    expect(result.codes).toEqual(['QUERY_TOO_COMPLEX']);
    expect(await healthStatus(), 'liveness after the abusive requests').toBe(200);
  });

  it('refuses mass aliasing quickly: at most 30 aliases per selection, counts charged as queries', async () => {
    const aliases = (count: number, selection: string) =>
      Array.from({ length: count }, (_, i) => `a${i}: ${selection}`).join(' ');
    const counts = await graphql(`{ ${aliases(10_000, 'folders { totalCount }')} }`);
    measure('10,000 aliased counts refused in', counts.ms);
    expect(counts.ms).toBeLessThan(QUICK_MS);
    expect(counts.status).toBe(400);
    expect(counts.codes).toEqual(expect.arrayContaining(['QUERY_TOO_MANY_ALIASES', 'QUERY_TOO_COMPLEX']));

    const justOver = await graphql(`{ ${aliases(31, 'folders { totalCount }')} }`);
    expect(justOver.codes).toEqual(['QUERY_TOO_MANY_ALIASES']);
    const allowed = await graphql(`{ ${aliases(30, 'folders { totalCount }')} }`);
    measure('30 aliased counts (the cap) answered in', allowed.ms);
    expect(allowed.status).toBe(200);
    expect(await healthStatus(), 'liveness after the abusive requests').toBe(200);
  });

  it('refuses a deeply nested query before executing it', async () => {
    const nest = (levels: number): string => (levels === 0 ? 'label' : `nodes { ${nest(levels - 1)} }`);
    // Not valid against the schema either way; it must be refused without deep recursion trouble.
    const result = await graphql(`{ folders { ${nest(2000)} } }`);
    measure('2,000-level nesting answered in', result.ms);
    expect(result.ms).toBeLessThan(QUICK_MS);
    expect(result.status).toBe(400);
    expect(await healthStatus(), 'liveness after the abusive requests').toBe(200);
  });

  it('caps a burst at RATE_LIMIT_MAX per client and keeps health probes exempt', async () => {
    const burst = 1000;
    const started = performance.now();
    const statuses = await Promise.all(
      Array.from(
        { length: burst },
        async () =>
          (
            await fetch(`${server.url}/api/content/folders`, {
              headers: { authorization: `Bearer ${token}` },
            })
          ).status,
      ),
    );
    measure(`burst of ${burst} concurrent requests answered in`, performance.now() - started);
    const ok = statuses.filter((status) => status === 200).length;
    const limited = statuses.filter((status) => status === 429).length;
    measure('burst requests served', ok, 'requests');
    measure('burst requests refused with 429', limited, 'requests');
    // Earlier tests in this file used part of the window's budget.
    expect(ok).toBeLessThanOrEqual(RATE_LIMIT_MAX);
    expect(ok + limited).toBe(burst);
    expect(statuses.some((status) => status >= 500)).toBe(false);
    const limitedResponse = await fetch(`${server.url}/api/content/folders`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(await limitedResponse.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    // Liveness and readiness probes are never rate limited.
    expect(await healthStatus(), 'liveness after the abusive requests').toBe(200);
    expect((await fetch(`${server.url}/api/ready`)).status).toBe(200);
  });
});
