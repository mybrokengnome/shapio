import { normalizeDefinition } from '@shapio/schema';
import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../../../../test/helpers/silentLogger.js';
import {
  GRAPHQL_LENS_SCHEMAS_PROBATION,
  GRAPHQL_LENS_SCHEMAS_PROTECTED,
} from '../../../constants/graphql.js';
import { buildNetworkSchema, type SchemaSnapshot } from '../../snapshot.js';
import { buildGraphqlSchema, type BuildOptions } from './schemaBuilder.js';
import { createGraphqlSchemaCache } from './schemaCache.js';
import { FULL_VISIBILITY, type SchemaVisibility } from './visibility.js';

const SITE_A = 'site-a';
const SITE_B = 'site-b';
const view = (version: number, siteId: string) => buildNetworkSchema(version, [], []).forSite(siteId);
const masked = (key: string): SchemaVisibility => ({ key, models: new Map(), componentFields: 'public' });

const setup = (
  options: {
    idleMs?: number;
    maxEntries?: number;
    maxLensSpacesPerWorkspace?: number;
    maxLensWorkspaces?: number;
    lensSegments?: { probation: number; protected: number };
  } = {},
) => {
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
    /** A model the masked visibility below never shows. */
    const SECRET = normalizeDefinition({
      id: '00000000-0000-4000-8000-000000000002',
      kind: 'collection',
      apiKey: 'secret',
      label: 'Secret',
      fields: [{ id: '00000000-0000-4000-8000-000000000021', apiKey: 'code', label: 'Code', type: 'string' }],
    });
    const revisionId = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
    const active = (definition: typeof NOTE, revision: number, siteId: string) => ({
      definition,
      version: revision,
      revisionId: revisionId(revision),
      hash: 'h',
      activatedAt: new Date(0),
      siteId,
    });
    /** A client's version of a workspace: the note at revision `note`, the secret at `secret`. */
    const lensView = (version: number, note: number, secret = 1000, siteId = SITE_A) =>
      buildNetworkSchema(version, [active(NOTE, note, siteId), active(SECRET, secret, siteId)], []).forSite(
        siteId,
      );
    /** A delivery caller that sees the note only. */
    const noteOnly: SchemaVisibility = {
      key: 'lens:note-only',
      models: new Map([
        [
          NOTE.id,
          { readable: true, readFields: new Set([NOTE.fields[0]?.id ?? '']), writeFields: new Set() },
        ],
      ]),
      componentFields: 'public',
    };
    const held = (cache: ReturnType<typeof setup>['cache']) =>
      cache
        .listLens()
        .map(({ siteId, visibility, view: key, segment }) => ({ siteId, visibility, key, segment }));

    it('builds one schema per look: versions differing only in what the caller never sees share it', async () => {
      const { cache, builds } = setup();
      const [a, b] = await Promise.all([
        cache.getLens(lensView(3, 1, 10), noteOnly),
        cache.getLens(lensView(4, 1, 11), noteOnly),
      ]);
      expect(a).toBe(b);
      expect(builds).toEqual([{ siteId: SITE_A, version: 3, visibility: 'lens:note-only', lens: true }]);
      // For an admin the secret shows, so those versions differ.
      const full1 = await cache.getLens(lensView(3, 1, 10), FULL_VISIBILITY);
      const full2 = await cache.getLens(lensView(4, 1, 11), FULL_VISIBILITY);
      expect(full1).not.toBe(full2);
      expect(full1.schema.getMutationType()?.getFields()).toHaveProperty('createNote');
      expect(await cache.getLens(lensView(3, 2, 10), noteOnly)).not.toBe(a);
    });

    it('keeps a version read twice while a caller walks fifty others, and leaves other workspaces alone', async () => {
      const { cache } = setup();
      const current = await cache.get(view(99, SITE_A));
      const kept = await cache.getLens(lensView(5, 1), noteOnly);
      expect(await cache.getLens(lensView(5, 1), noteOnly)).toBe(kept);
      const elsewhere = await cache.getLens(lensView(5, 1, 1000, SITE_B), noteOnly);
      for (let revision = 100; revision < 150; revision += 1) {
        await cache.getLens(lensView(6, revision), noteOnly);
      }
      expect(await cache.getLens(lensView(5, 1), noteOnly)).toBe(kept);
      expect(await cache.getLens(lensView(5, 1, 1000, SITE_B), noteOnly)).toBe(elsewhere);
      expect(cache.peek(SITE_A)).toBe(current);
      const inA = held(cache).filter((entry) => entry.siteId === SITE_A);
      expect(inA.length).toBeLessThanOrEqual(GRAPHQL_LENS_SCHEMAS_PROBATION + GRAPHQL_LENS_SCHEMAS_PROTECTED);
      expect(inA.filter((entry) => entry.segment === 'protected')).toHaveLength(1);
    });

    it('isolates workspaces and visibilities from a caller reading each of 100 versions twice', async () => {
      const { cache } = setup();
      const walker = { todayVisibilityKey: 'delivery:walker' };
      const other = { todayVisibilityKey: 'delivery:other' };
      // Promoted entries of another workspace and of another visibility in the walker's workspace.
      const inB = await cache.getLens(lensView(5, 1, 1000, SITE_B), noteOnly, walker);
      await cache.getLens(lensView(5, 1, 1000, SITE_B), noteOnly, walker);
      const otherInA = await cache.getLens(lensView(5, 1), noteOnly, other);
      await cache.getLens(lensView(5, 1), noteOnly, other);
      for (let revision = 100; revision < 200; revision += 1) {
        // Each version's lens visibility differs (its key varies with the version); today's does not.
        const visibility = { ...noteOnly, key: `lens:walk-${revision}` };
        await cache.getLens(lensView(6, revision), visibility, walker);
        await cache.getLens(lensView(6, revision), visibility, walker);
      }
      expect(await cache.getLens(lensView(5, 1, 1000, SITE_B), noteOnly, walker)).toBe(inB);
      expect(await cache.getLens(lensView(5, 1), noteOnly, other)).toBe(otherInA);
      const walkerEntries = held(cache).filter(
        (entry) => entry.siteId === SITE_A && entry.visibility === walker.todayVisibilityKey,
      );
      expect(walkerEntries.length).toBeLessThanOrEqual(
        GRAPHQL_LENS_SCHEMAS_PROBATION + GRAPHQL_LENS_SCHEMAS_PROTECTED,
      );
    });

    it('bounds visibilities per workspace and workspaces, dropping whole least recently used ones', async () => {
      const { cache } = setup({
        maxLensSpacesPerWorkspace: 2,
        maxLensWorkspaces: 2,
        lensSegments: { probation: 1, protected: 1 },
      });
      for (const todayVisibilityKey of ['delivery:a', 'delivery:b', 'delivery:c']) {
        await cache.getLens(lensView(5, 1), noteOnly, { todayVisibilityKey });
      }
      expect(new Set(held(cache).map((entry) => entry.visibility))).toEqual(
        new Set(['delivery:b', 'delivery:c']),
      );
      for (const site of [SITE_B, 'site-c']) {
        await cache.getLens(lensView(5, 1, 1000, site), noteOnly);
      }
      expect(new Set(held(cache).map((entry) => entry.siteId))).toEqual(new Set([SITE_B, 'site-c']));
      for (let revision = 1; revision <= 4; revision += 1) {
        await cache.getLens(lensView(5, revision, 1000, SITE_B), noteOnly);
      }
      expect(held(cache).filter((entry) => entry.siteId === SITE_B).length).toBeLessThanOrEqual(2);
    });

    it('retries a failed build', async () => {
      const { cache, failNextBuild } = setup();
      failNextBuild();
      await expect(cache.getLens(lensView(5, 4), FULL_VISIBILITY)).rejects.toThrow('build failed');
      await expect(cache.getLens(lensView(5, 4), FULL_VISIBILITY)).resolves.toBeDefined();
    });

    it('asks the build budget on a miss only, and refuses before touching any cache', async () => {
      const { cache, builds } = setup();
      let asked = 0;
      const admit = (answer: boolean) => () => {
        asked += 1;
        return answer;
      };
      await cache.getLens(lensView(6, 1), noteOnly, { admit: admit(true) });
      await cache.getLens(lensView(7, 1), noteOnly, { admit: admit(false) });
      expect(asked).toBe(1);
      const before = held(cache);
      await expect(cache.getLens(lensView(6, 2), noteOnly, { admit: admit(false) })).rejects.toMatchObject({
        statusCode: 429,
        code: 'LENS_BUDGET_EXCEEDED',
      });
      await expect(
        cache.getLens(lensView(6, 2, 1000, SITE_B), noteOnly, { admit: admit(false) }),
      ).rejects.toMatchObject({ statusCode: 429 });
      expect(asked).toBe(3);
      expect(builds).toHaveLength(1);
      expect(held(cache)).toEqual(before);
    });
  });
});
