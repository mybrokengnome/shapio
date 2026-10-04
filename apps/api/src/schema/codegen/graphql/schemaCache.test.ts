import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../../../../test/helpers/silentLogger.js';
import { buildNetworkSchema, type SchemaSnapshot } from '../../snapshot.js';
import { buildGraphqlSchema } from './schemaBuilder.js';
import { createGraphqlSchemaCache } from './schemaCache.js';

const SITE_A = 'site-a';
const SITE_B = 'site-b';
const view = (version: number, siteId: string) => buildNetworkSchema(version, [], []).forSite(siteId);

const setup = (options: { idleMs?: number } = {}) => {
  let time = 0;
  const builds: Array<{ siteId: string | null; version: number }> = [];
  let failNext = false;
  const cache = createGraphqlSchemaCache({
    log: silentLogger,
    now: () => time,
    ...options,
    build: (snapshot: SchemaSnapshot) => {
      if (failNext) {
        failNext = false;
        throw new Error('build failed');
      }
      builds.push({ siteId: snapshot.siteId, version: snapshot.version });
      return buildGraphqlSchema(snapshot);
    },
  });
  return {
    cache,
    builds,
    advance: (ms: number) => {
      time += ms;
    },
    failNextBuild: () => {
      failNext = true;
    },
  };
};

/** Polls until the background refresh has built `count` schemas (it yields between sites). */
const waitForBuilds = (builds: readonly unknown[], count: number) =>
  vi.waitFor(() => expect(builds).toHaveLength(count));

describe('GraphQL schema cache', () => {
  it('builds once per (site, version) for concurrent requests and keeps sites apart', async () => {
    const { cache, builds } = setup();
    const [a1, a2, b1] = await Promise.all([
      cache.get(view(2, SITE_A)),
      cache.get(view(2, SITE_A)),
      cache.get(view(2, SITE_B)),
    ]);
    expect(builds).toEqual([
      { siteId: SITE_A, version: 2 },
      { siteId: SITE_B, version: 2 },
    ]);
    expect(a1).toBe(a2);
    expect(b1).not.toBe(a1);
    expect(cache.peek(SITE_A)?.version).toBe(2);
  });

  it('never moves a site backwards and replaces it with a newer version', async () => {
    const { cache, builds } = setup();
    const v2 = await cache.get(view(2, SITE_A));
    expect(await cache.get(view(1, SITE_A))).toBe(v2);
    expect(builds).toHaveLength(1);

    const [v3, v4] = await Promise.all([cache.get(view(3, SITE_A)), cache.get(view(4, SITE_A))]);
    expect(v3.version).toBeGreaterThanOrEqual(3);
    expect(v4.version).toBe(4);
    expect(cache.peek(SITE_A)).toBe(v4);
    expect(await cache.get(view(3, SITE_A))).toBe(v4);
  });

  it('keeps the older schema when a build fails, and the next request retries', async () => {
    const { cache, builds, failNextBuild } = setup();
    const v1 = await cache.get(view(1, SITE_A));
    failNextBuild();
    await expect(cache.get(view(2, SITE_A))).rejects.toThrow('build failed');
    expect(cache.peek(SITE_A)).toBe(v1);
    expect((await cache.get(view(2, SITE_A))).version).toBe(2);
    expect(builds).toHaveLength(2);
  });

  it('drops sites no request used for the idle period', async () => {
    const { cache, advance } = setup({ idleMs: 1000 });
    await cache.get(view(1, SITE_A));
    await cache.get(view(1, SITE_B));
    advance(600);
    await cache.get(view(1, SITE_A));
    advance(600);
    // The sweep runs on access: B was last used 1200 ms ago, A 600 ms ago.
    await cache.get(view(1, SITE_A));
    expect(cache.peek(SITE_A)).toBeDefined();
    expect(cache.peek(SITE_B)).toBeUndefined();
  });

  it('refreshes only the sites it already holds, in the background', async () => {
    const { cache, builds } = setup();
    await cache.get(view(1, SITE_A));
    cache.refresh(buildNetworkSchema(2, [], []));
    // Nothing is built synchronously on the change notification.
    expect(builds).toHaveLength(1);
    await waitForBuilds(builds, 2);
    expect(builds[1]).toEqual({ siteId: SITE_A, version: 2 });
    expect(cache.peek(SITE_A)?.version).toBe(2);
    expect(cache.peek(SITE_B)).toBeUndefined();
  });
});
