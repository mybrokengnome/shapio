import { normalizeDefinition } from '@shapio/schema';
import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../../../../test/helpers/silentLogger.js';
import { buildNetworkSchema, type SchemaSnapshot } from '../../snapshot.js';
import { buildGraphqlSchema, type BuildOptions } from './schemaBuilder.js';
import { createGraphqlSchemaCache, lensViewKey } from './schemaCache.js';
import { FULL_VISIBILITY, type SchemaVisibility } from './visibility.js';

const SITE_A = 'site-a';
const SITE_B = 'site-b';
const view = (version: number, siteId: string) => buildNetworkSchema(version, [], []).forSite(siteId);
const masked = (key: string): SchemaVisibility => ({ key, models: new Map(), componentFields: 'public' });

const setup = (options: { idleMs?: number; maxEntries?: number; maxLensEntries?: number } = {}) => {
  let time = 0;
  const builds: Array<{ siteId: string | null; version: number; visibility?: string; lens?: true }> = [];
  let failNext = false;
  const cache = createGraphqlSchemaCache({
    log: silentLogger,
    now: () => time,
    ...options,
    build: (snapshot: SchemaSnapshot, visibility: SchemaVisibility, buildOptions?: BuildOptions) => {
      if (failNext) {
        failNext = false;
        throw new Error('build failed');
      }
      builds.push({
        siteId: snapshot.siteId,
        version: snapshot.version,
        ...(visibility === FULL_VISIBILITY ? {} : { visibility: visibility.key }),
        ...(buildOptions?.lens ? { lens: true as const } : {}),
      });
      return buildGraphqlSchema(snapshot, visibility, buildOptions);
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

  it('builds once per visibility: callers with the same masks share a schema, other masks get their own', async () => {
    const { cache, builds } = setup();
    const [full, a1, a2, b] = await Promise.all([
      cache.get(view(1, SITE_A)),
      cache.get(view(1, SITE_A), masked('delivery:a')),
      cache.get(view(1, SITE_A), masked('delivery:a')),
      cache.get(view(1, SITE_A), masked('delivery:b')),
    ]);
    expect(builds).toHaveLength(3);
    expect(a1).toBe(a2);
    expect(new Set([full, a1, b]).size).toBe(3);
    expect(cache.peek(SITE_A, 'delivery:a')).toBe(a1);
    expect(cache.peek(SITE_A)).toBe(full);
    // A newer version rebuilds the masked schema on its next request.
    expect((await cache.get(view(2, SITE_A), masked('delivery:a'))).version).toBe(2);
  });

  it('keeps at most maxEntries schemas, dropping the least recently used', async () => {
    const { cache } = setup({ maxEntries: 2 });
    await cache.get(view(1, SITE_A), masked('delivery:a'));
    await cache.get(view(1, SITE_A), masked('delivery:b'));
    await cache.get(view(1, SITE_A), masked('delivery:a'));
    await cache.get(view(1, SITE_A), masked('delivery:c'));
    expect(cache.peek(SITE_A, 'delivery:a')).toBeDefined();
    expect(cache.peek(SITE_A, 'delivery:b')).toBeUndefined();
    expect(cache.peek(SITE_A, 'delivery:c')).toBeDefined();
  });

  it('refreshes only full schemas in the background; masked ones wait for their next request', async () => {
    const { cache, builds } = setup();
    await cache.get(view(1, SITE_A));
    await cache.get(view(1, SITE_A), masked('delivery:a'));
    cache.refresh(buildNetworkSchema(2, [], []));
    await waitForBuilds(builds, 3);
    expect(builds[2]).toEqual({ siteId: SITE_A, version: 2 });
    expect(cache.peek(SITE_A, 'delivery:a')?.version).toBe(1);
  });

  describe('lens schemas', () => {
    const NOTE = normalizeDefinition({
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'collection',
      apiKey: 'note',
      label: 'Note',
      fields: [{ id: '00000000-0000-4000-8000-000000000011', apiKey: 'text', label: 'Text', type: 'string' }],
    });
    /** A client's version of SITE_A whose one definition is at revision `revision`. */
    const lensView = (version: number, revision: number) =>
      buildNetworkSchema(
        version,
        [
          {
            definition: NOTE,
            version: revision,
            revisionId: `00000000-0000-4000-8000-${revision.toString(16).padStart(12, '0')}`,
            hash: 'h',
            activatedAt: new Date(0),
            siteId: SITE_A,
          },
        ],
        [],
      ).forSite(SITE_A);

    it('builds one read-only schema per view, shared by versions with the same revisions', async () => {
      const { cache, builds } = setup();
      const [a, b] = await Promise.all([
        cache.getLens(lensView(3, 1), FULL_VISIBILITY),
        cache.getLens(lensView(4, 1), FULL_VISIBILITY),
      ]);
      expect(a).toBe(b);
      expect(builds).toEqual([{ siteId: SITE_A, version: 3, lens: true }]);
      expect(a.schema.getMutationType()).toBeUndefined();
      expect(await cache.getLens(lensView(3, 2), FULL_VISIBILITY)).not.toBe(a);
      expect(await cache.getLens(lensView(3, 1), masked('lens:x'))).not.toBe(a);
      expect(cache.listLens().map((entry) => entry.view)).toEqual([
        lensViewKey(lensView(3, 1)),
        lensViewKey(lensView(3, 2)),
        lensViewKey(lensView(3, 1)),
      ]);
    });

    it('keeps at most maxLensEntries, apart from the current schemas, and retries a failed build', async () => {
      const { cache, failNextBuild } = setup({ maxEntries: 1, maxLensEntries: 2 });
      const current = await cache.get(view(9, SITE_A));
      for (const revision of [1, 2, 3]) {
        await cache.getLens(lensView(5, revision), FULL_VISIBILITY);
      }
      expect(cache.listLens().map((entry) => entry.view)).toEqual([
        lensViewKey(lensView(5, 2)),
        lensViewKey(lensView(5, 3)),
      ]);
      expect(cache.peek(SITE_A)).toBe(current);
      expect(cache.list()).toHaveLength(1);
      failNextBuild();
      await expect(cache.getLens(lensView(5, 4), FULL_VISIBILITY)).rejects.toThrow('build failed');
      await expect(cache.getLens(lensView(5, 4), FULL_VISIBILITY)).resolves.toBeDefined();
    });
  });
});
