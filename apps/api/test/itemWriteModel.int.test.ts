import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { setPublicGrants } from './helpers/appUsers.js';
import { createDefinition, createRole, expectStatus, runContentSchemaJobs } from './helpers/content.js';
import { AHEAD_KINDS, aheadEntry, echoAheadProblems } from './helpers/itemModelEchoAhead.js';
import { craftBundle, exportBundle, importBundle } from './helpers/itemModelImports.js';
import { locCopyEntry, locCopyProblems } from './helpers/itemModelLocCopy.js';
import {
  CANDIDATE_LABELS,
  graphqlLiteral,
  nested,
  POSITIONS,
  echoThroughVersionProblems,
  noopProblems,
  relationProbeProblems,
  resaveProblems,
  versionOfResponse,
} from './helpers/itemModelProbes.js';
import {
  acceptedWriteProblems,
  answerShape,
  bodyOf,
  createEntry,
  idUniqueness,
  instancesOf,
  itemIdsProblems,
  legacyOf,
  localeProblems,
  outcomeOf,
  planBody,
  planEntry,
  prng,
  readAgreementProblems,
  readAs,
  refusalProblems,
  roundTripProblems,
  send,
  storedView,
  storeHeads,
  tag,
  type Problem,
  type Random,
  type Transport,
} from './helpers/itemModelRun.js';
import {
  STALE_LISTS,
  STALE_WAYS,
  staleRetryProblems,
  twinReorderProblems,
} from './helpers/itemModelStale.js';
import {
  eventCount,
  headsOf,
  itemModelWorld,
  revisionCount,
  setHeadData,
  withAnonymousDocGrants,
  type Caller,
  useModel,
  type World,
} from './helpers/itemModelWorld.js';

/**
 * Model-based fuzz of item writes at the HTTP and service level (review 6): every request goes through the real
 * app (REST, GraphQL, the admin API) on a real database (SQLite by default; PostgreSQL or MySQL through
 * `TEST_DATABASE_URL`), and every property is checked against raw storage and the admin API after it:
 *
 *   1 conservation, 2 no oracle, 3 ID integrity, 4 order and status, 5 round trip, 6 compatibility,
 *   7 multi-locale, 8 concurrency.
 *
 * `ITEM_MODEL_RUNS` (default 6) runs from `ITEM_MODEL_SEED` (default 1); `ITEM_MODEL_SEED=<n> ITEM_MODEL_RUNS=1`
 * replays one. The fixed cases below are the reviewer's repros, each named after the property that catches it.
 */

const RUNS = Number(process.env.ITEM_MODEL_RUNS ?? 6);
const BASE_SEED = Number(process.env.ITEM_MODEL_SEED ?? 1);

const report = (problems: readonly Problem[]) =>
  problems.map((problem) => `[${problem.property}] ${problem.detail}`);

/** Whether some list of `value` (at any depth) holds items with an `id` and items without one. */
const mixesIds = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    const records = value.filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && !Array.isArray(item),
    );
    const withId = records.filter((item) => 'id' in item).length;
    return (withId > 0 && withId < records.length) || value.some(mixesIds);
  }
  return typeof value === 'object' && value !== null ? Object.values(value).some(mixesIds) : false;
};

/** One request and every property it can break. */
const checkedWrite = async (
  w: World,
  {
    caller,
    transport,
    entryId,
    locale,
    version,
    expectedVersion,
    body,
    read,
  }: {
    caller: Caller;
    transport: Transport;
    entryId: string;
    locale: string;
    version: boolean;
    expectedVersion: number | null | undefined;
    body: Record<string, unknown>;
    read: Record<string, unknown> | null;
  },
) => {
  const before = await storedView(w, entryId, locale);
  const response = await send(w, { caller, transport, entryId, locale, version, expectedVersion, body });
  const after = await storedView(w, entryId, locale);
  if (process.env.ITEM_MODEL_DEBUG) {
    writeFileSync(
      process.env.ITEM_MODEL_DEBUG,
      JSON.stringify(
        {
          read,
          body,
          response: response.raw,
          before: before.draft?.data,
          after: after.draft?.data,
          adminBefore: before.admin,
          adminAfter: after.admin,
        },
        null,
        1,
      ),
    );
  }
  const problems = refusalProblems(response, before.heads, after.heads);
  if (outcomeOf(response).accepted) {
    const beforeInstances = instancesOf(w, before.draft?.data, before.admin);
    const afterInstances = instancesOf(w, after.draft?.data, after.admin);
    problems.push(
      ...acceptedWriteProblems(w, {
        before: beforeInstances,
        after: afterInstances,
        read,
        body,
        admin: caller.kind === 'admin',
        writesAll: caller.kind === 'admin' || caller.kind === 'adminToken' || caller.kind === 'pinned',
        version: version || caller.pinned === true,
      }),
      ...idUniqueness(after.heads),
      ...(transport === 'rest' ? itemIdsProblems(response, body, afterInstances) : []),
      ...localeProblems(w, before.heads, after.heads, locale, body),
    );
  }
  return { response, problems };
};

const CALLERS = [
  'admin',
  'adminToken',
  'reader',
  'updateOnly',
  'masked',
  'owner',
  'anon',
  'pinned',
  'limited',
] as const;

/** One random run: an entry, a caller, a body, a request; then round trip, no oracle, compatibility, concurrency. */
const runOnce = async (w: World, seed: number): Promise<{ problems: Problem[]; log: string[] }> => {
  const random = prng(seed);
  const caller = w.callers[random.pick(CALLERS)];
  // A third of the runs write a model without draft and publish (every write publishes).
  useModel(w, random.chance(0.33) ? 'ndoc' : 'doc');
  try {
    return await withAnonymousDocGrants(w, caller, () => runAs(w, seed, random, caller));
  } finally {
    useModel(w, 'doc');
  }
};

const runAs = async (
  w: World,
  seed: number,
  random: Random,
  caller: Caller,
): Promise<{ problems: Problem[]; log: string[] }> => {
  const log: string[] = [];
  const problems: Problem[] = [];
  const transport: Transport =
    caller.kind === 'admin' ? 'adminApi' : random.chance(0.15) ? 'graphql' : 'rest';
  const version = caller.kind !== 'admin' && (caller.pinned === true || random.chance(0.5));
  const locale = random.chance(0.2) ? 'fr' : 'en';
  const owner = caller.ownOnly ? (random.chance(0.7) ? caller.userId : w.stranger.user.id) : undefined;
  const entry = await createEntry(w, planEntry(w, random, owner), seed);
  const read = caller.reads ? await readAs(w, caller, entry.id, locale, version) : null;
  const plan = planBody(random);
  const foreignIds = [
    randomUUID(),
    ...(read
      ? (Array.isArray(read.lchips) ? read.lchips : []).map((item) => (item as { id: string }).id)
      : []),
  ];
  const body = bodyOf(random, read, plan, { admin: caller.kind === 'admin', foreignIds });
  const heads = await headsOf(w, entry.id);
  const draft = heads.find((head) => head.locale === locale && head.state === 'draft');
  const fresh = draft?.version ?? null;
  // A new locale is written with `expectedVersion: null`; an existing one with the version, fresh or stale.
  const expectedVersion =
    fresh === null ? null : random.chance(0.85) ? fresh : random.chance(0.5) ? fresh + 3 : null;
  const sentBody = body;
  const { response, problems: found } = await checkedWrite(w, {
    caller,
    transport,
    entryId: entry.id,
    locale,
    version,
    expectedVersion,
    body: sentBody,
    read,
  });
  problems.push(
    ...found.map((problem) => ({
      ...problem,
      detail: `${caller.name}${version ? '@V' : ''} ${transport}: ${problem.detail}`,
    })),
  );
  const outcome = outcomeOf(response);
  // N2: the very same body again is a no-op (bodies that name no new item by `id: null`).
  if (
    outcome.accepted &&
    plan.corrupt === null &&
    (plan.mode === 'echo' || plan.mode === 'none') &&
    !JSON.stringify(sentBody).includes('"id":null') &&
    // In a list sent with IDs an item without one is new every time: only lists all with or all without IDs.
    // Documented (delivery-api.md:551): in a list sent with IDs, every item without a string id is new, so a
    // repeat of such a list adds new items again; only lists all with or all without IDs are repeat no-ops.
    !mixesIds(sentBody)
  ) {
    problems.push(
      ...(await resaveProblems(
        w,
        { caller, transport, entryId: entry.id, locale, version, expectedVersion, body: sentBody },
        response,
      )),
    );
  }
  // 9: no-op bodies on a fresh entry (legacy, partly, or with IDs; one or two locales), by this caller and route.
  {
    const noopEntry = await createEntry(
      w,
      { ...planEntry(w, random, caller.ownOnly ? caller.userId : undefined), draftEdit: false },
      seed + 11_000_000,
    );
    problems.push(...(await noopProblems(w, random, caller, noopEntry.id, { version, transport })));
  }
  // 10: echo through V at the top level, by a caller that reads.
  // (Not the admin API: its reads ignore schemaVersion, decision (b).)
  if (caller.reads && caller.kind !== 'admin' && random.chance(0.5)) {
    const echoEntry = await createEntry(
      w,
      { ...planEntry(w, random, caller.ownOnly ? caller.userId : undefined), draftEdit: false },
      seed + 12_000_000,
    );
    problems.push(...(await echoThroughVersionProblems(w, caller, echoEntry.id)));
  }
  // ECHOAHEAD (review 9): an old client saves the whole read back, `id`s and all, while the draft may be ahead.
  if (caller.reads && caller.updates && random.chance(0.4)) {
    const kind = w.draftAndPublish ? random.pick(AHEAD_KINDS) : 'equal';
    const view =
      (caller.kind === 'adminToken' || caller.kind === 'pinned') && random.chance(0.5) ? 'draft' : 'default';
    const ahead = await aheadEntry(w, kind, {
      legacy: random.pick(['all', 'partial', 'with'] as const),
      ownerId: caller.ownOnly ? caller.userId : undefined,
    });
    problems.push(
      ...(await echoAheadProblems(w, caller, ahead.id, { locale: ahead.locale, version, view, kind })),
    );
  }
  // STALERETRY (review 11): a stale write retried with the version its 409 named.
  if (caller.reads && caller.updates && caller.name !== 'limited' && random.chance(0.3)) {
    problems.push(
      ...(await staleRetryProblems(w, caller, {
        list: random.pick(STALE_LISTS),
        way: random.pick(STALE_WAYS),
        publish: random.chance(0.5),
        version,
        legacy: random.pick(['all', 'with'] as const),
      })),
    );
  }
  // N1: relation candidates.
  if (random.chance(0.3)) {
    problems.push(
      ...(await relationProbeProblems(
        w,
        random,
        caller,
        version,
        transport === 'adminApi' ? 'adminApi' : 'rest',
      )),
    );
  }
  log.push(
    `seed ${seed}: ${caller.name} ${transport}${version ? '@V' : ''} ${locale} plan ${JSON.stringify(plan)} → ${outcome.status} ${outcome.code} ${outcome.issues.join(' ')}`,
  );
  // 4: existence and ownership first: an entry the caller does not own answers 404/403 whatever the body.
  if (
    caller.ownOnly &&
    owner !== caller.userId &&
    ![403, 404].includes(response.status) &&
    transport === 'rest'
  ) {
    problems.push({
      property: '4 order and status',
      detail: `${caller.name} on another's entry answered ${response.status} ${outcome.code}`,
    });
  }
  // 4: parity: a refusal is the same with and without a version (bodies valid in both shapes).
  if (
    !outcome.accepted &&
    transport === 'rest' &&
    !caller.pinned &&
    response.status < 500 &&
    !/"(old|extra)"/.test(JSON.stringify(sentBody))
  ) {
    const other = await send(w, {
      caller,
      transport,
      entryId: entry.id,
      locale,
      version: !version,
      expectedVersion,
      body: sentBody,
    });
    const flipped = outcomeOf(other);
    // Status and code the same, except LENS_WRITE_UNSUPPORTED through V (a field changed since the version).
    const atV = version ? outcome : flipped;
    const lensOnly = atV.code === 'LENS_WRITE_UNSUPPORTED';
    if (!lensOnly && (flipped.status !== outcome.status || flipped.code !== outcome.code)) {
      problems.push({
        property: '4 order and status',
        detail: `${caller.name}: ${version ? 'through V' : 'today'} ${outcome.status} ${outcome.code} ${outcome.issues.join(' ')}; ${version ? 'today' : 'through V'} ${flipped.status} ${flipped.code} ${flipped.issues.join(' ')}`,
      });
    }
  }
  if (random.chance(0.3)) {
    problems.push(...(await readAgreementProblems(w, entry.id)));
  }
  // 3 on create: the same body as a new entry (IDs it names are the server's to replace): unique IDs, itemIds as stored.
  if (random.chance(0.25) && caller.updates) {
    const created = await withAnonymousDocGrants(w, caller, () =>
      send(w, {
        caller,
        transport,
        entryId: null,
        locale: 'en',
        version,
        expectedVersion: undefined,
        body: sentBody,
      }),
    );
    if (created.status >= 500) {
      problems.push({
        property: '4 order and status',
        detail: `${caller.name} create: ${created.status} ${created.raw.slice(0, 200)}`,
      });
    }
    const createdBody = created.body as { id?: string; data?: { id?: string; createDoc?: { id?: string } } };
    const newId = createdBody.data?.id ?? createdBody.id ?? createdBody.data?.createDoc?.id;
    if (created.status < 300 && typeof newId === 'string') {
      const view = await storedView(w, newId, 'en');
      problems.push(
        ...idUniqueness(view.heads).map((problem) => ({
          ...problem,
          detail: `${caller.name} create: ${problem.detail}`,
        })),
        ...(transport === 'rest'
          ? itemIdsProblems(created, sentBody, instancesOf(w, view.draft?.data, view.admin))
          : []),
      );
    }
  }
  // 5: round trip by a caller that reads.
  if (random.chance(0.4)) {
    const reader =
      w.callers[random.pick(['admin', 'adminToken', 'reader', 'masked', 'pinned', 'limited'] as const)];
    const fresh2 = await createEntry(w, planEntry(w, random), seed + 7_000_000);
    problems.push(
      ...(await roundTripProblems(w, reader, fresh2.id, 'en', reader.kind !== 'admin' && random.chance(0.5))),
    );
  }
  // 2: no oracle.
  if (random.chance(0.35)) {
    problems.push(...(await noOracleProblems(w, random, seed)));
  }
  // 6: compatibility.
  if (random.chance(0.4)) {
    problems.push(...(await compatibilityProblems(w, random)));
  }
  // 8: concurrency.
  if (random.chance(0.15)) {
    problems.push(...(await concurrencyProblems(w, random, seed)));
  }
  return { problems, log };
};

/**
 * 2: two entries whose stored states differ only in what the caller cannot see answer the same body the same.
 * The twins share every item ID (copied raw), so the same body names the same items in both.
 */
const noOracleProblems = async (w: World, random: Random, seed: number): Promise<Problem[]> => {
  const caller =
    w.callers[random.pick(['reader', 'masked', 'updateOnly', 'anon', 'owner', 'limited'] as const)];
  const version = random.chance(0.5);
  const plan = planEntry(w, random);
  // Legacy twins (no stored IDs) are sent no IDs: their derived IDs differ with what the items hold.
  const a = await createEntry(w, { ...plan, draftEdit: false }, seed + 1);
  const b = await createEntry(w, { ...plan, draftEdit: false }, seed + 1);
  // B: A's storage, then everything A's caller cannot see changed.
  const perturb = (value: unknown, unreadable: boolean): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => perturb(item, unreadable));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => {
          const apiKey = w.apiKeyOf.get(key);
          if (typeof entry === 'string' && entry.startsWith('§')) {
            return [key, tag('twin')];
          }
          if (apiKey === 'rel' && entry === w.things.draft) {
            return [key, w.things.deleted];
          }
          if (unreadable && (apiKey === 'zv' || apiKey === 'label' || apiKey === 'heading')) {
            return [key, `${String(entry)}~`];
          }
          return [key, perturb(entry, unreadable)];
        }),
      );
    }
    return value;
  };
  // A copied item takes new IDs throughout, nested items included, so B never stores one ID twice.
  const freshItemIds = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(freshItemIds)
      : typeof value === 'object' && value !== null
        ? Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [
              key,
              key === '__id' ? randomUUID().replaceAll('-', '').slice(0, 12) : freshItemIds(entry),
            ]),
          )
        : value;
  const unseen = !caller.reads;
  for (const head of await headsOf(w, a.id)) {
    const data = Object.fromEntries(
      Object.entries(head.data).map(([fieldId, value]) => {
        // Unreadable to the caller: everything (no read), or the masked caller's hero and secretCard.
        const unreadable =
          unseen || (caller.name === 'masked' && (fieldId === w.doc.hero || fieldId === w.doc.secretCard));
        if (unreadable && random.chance(0.3) && Array.isArray(value)) {
          return [
            fieldId,
            [...(value as unknown[]), ...(value as unknown[]).slice(0, 1).map((item) => freshItemIds(item))],
          ];
        }
        return [fieldId, perturb(value, unreadable)];
      }),
    );
    await setHeadData(w, b.id, head.locale, head.state, data);
    await setHeadData(w, a.id, head.locale, head.state, head.data);
  }
  // Draft-only differences: both twins get a new draft through the admin API (same versions), then B's draft
  // alone has its hidden values changed raw: a caller that reads the published head sees the same of both.
  if (random.chance(0.4)) {
    for (const id of [a.id, b.id]) {
      const view = await w.request('GET', `/api/admin/content/doc/${id}?locale=en`, w.adminToken);
      if (view.status === 200) {
        await w.admin.put(`/api/admin/content/doc/${id}?locale=en`, {
          locale: 'en',
          expectedVersion: (view.body as { version: number }).version,
          data: { title: 'draft-only' },
        });
      }
    }
    for (const head of (await headsOf(w, b.id)).filter((candidate) => candidate.state === 'draft')) {
      await setHeadData(
        w,
        b.id,
        head.locale,
        head.state,
        perturb(head.data, false) as Record<string, unknown>,
      );
    }
  }
  if (caller.ownOnly) {
    const owner = random.chance(0.5) ? caller.userId : w.stranger.user.id;
    for (const id of [a.id, b.id]) {
      await w.db
        .updateTable('entries')
        .set({ owner_app_user_id: owner ?? null })
        .where('id', '=', id)
        .execute();
    }
  }
  const read = caller.reads ? await readAs(w, caller, a.id, 'en', version) : null;
  const readB = caller.reads ? await readAs(w, caller, b.id, 'en', version) : null;
  // The precondition: the caller sees the same of both (up to the entry's own ID).
  if (JSON.stringify(read) !== JSON.stringify(readB)) {
    return [];
  }
  const bodyPlan = planBody(random);
  const body = bodyOf(random, read, plan.legacy === 'with' ? bodyPlan : { ...bodyPlan, mode: 'none' }, {
    admin: false,
    foreignIds: [randomUUID()],
  });
  const versionOf = async (id: string) =>
    (await headsOf(w, id)).find((head) => head.locale === 'en' && head.state === 'draft')?.version ?? null;
  const known = new Set(
    instancesOf(
      w,
      (await headsOf(w, a.id)).find((head) => head.state === 'draft')?.data,
      await readAs(w, w.callers.admin, a.id, 'en', false),
    ).map((instance) => instance.id),
  );
  const answer = async (id: string) =>
    answerShape(
      await send(w, {
        caller,
        transport: 'rest',
        entryId: id,
        locale: 'en',
        version,
        expectedVersion: await versionOf(id),
        body,
      }),
      known,
    );
  const [first, second] = await withAnonymousDocGrants(w, caller, async () => [
    await answer(a.id),
    await answer(b.id),
  ]);
  return isDeepStrictEqual(first, second)
    ? []
    : [
        {
          property: '2 no oracle',
          detail: `${caller.name}${version ? '@V' : ''} body ${JSON.stringify(body).slice(0, 300)}: ${JSON.stringify(first)} vs ${JSON.stringify(second)}`,
        },
      ];
};

/** 6: a type with nothing hidden from the caller: a no-version, no-ID write is never refused. */
const compatibilityProblems = async (w: World, random: Random): Promise<Problem[]> => {
  const caller = w.callers[random.pick(['reader', 'updateOnly', 'anon', 'adminToken'] as const)];
  const created = expectStatus(
    await w.admin.post('/api/admin/content/plain', {
      data: { title: 't', links: [{ label: 'x' }, { label: 'x' }, { label: 'y' }], one: { label: 'o' } },
    }),
    201,
  ).json<{ id: string; version: number }>();
  if (random.chance(0.7)) {
    expectStatus(await w.admin.post(`/api/admin/content/plain/${created.id}/publish`, {}), 200);
  }
  const labels = ['x', 'y', 'z'];
  const links = Array.from({ length: random.int(4) }, () => ({ label: random.pick(labels) }));
  const data = random.chance(0.5) ? { links } : { one: { label: random.pick(labels) }, links };
  const response = await w.request('PUT', `/api/content/plains/${created.id}`, caller.token, {
    expectedVersion: created.version,
    data,
  });
  return response.status < 300
    ? []
    : [
        {
          property: '6 compatibility',
          detail: `${caller.name}: ${JSON.stringify(data)} → ${response.status} ${response.raw.slice(0, 200)}`,
        },
      ];
};

/** 8: concurrent writers on one version: one winner, and the winner's write keeps every property. */
const concurrencyProblems = async (w: World, random: Random, seed: number): Promise<Problem[]> => {
  const caller = w.callers.reader;
  const entry = await createEntry(w, { ...planEntry(w, random), publish: true, draftEdit: false }, seed + 3);
  const read = await readAs(w, caller, entry.id, 'en', false);
  const before = await storedView(w, entry.id, 'en');
  const version = before.draft?.version ?? null;
  const bodies = [0, 1, 2].map(() =>
    bodyOf(
      random,
      read,
      { ...planBody(random), corrupt: null, forbidden: false },
      { admin: false, foreignIds: [] },
    ),
  );
  const responses = await Promise.all(
    bodies.map((body) =>
      send(w, {
        caller,
        transport: 'rest',
        entryId: entry.id,
        locale: 'en',
        version: false,
        expectedVersion: version,
        body,
      }),
    ),
  );
  const problems: Problem[] = [];
  const winners = responses.filter((response) => response.status < 300);
  // One winner that changes the entry; another 200 must have changed nothing (it answers the version it read).
  const versionOf = (response: (typeof responses)[number]) =>
    (response.body as { data?: { version?: number } }).data?.version;
  const effective = winners.filter((response) => versionOf(response) !== version);
  if (effective.length > 1) {
    problems.push({
      property: '8 concurrency',
      detail: `${effective.length} writers on version ${String(version)} each wrote (answered ${effective.map(versionOf).join(', ')})`,
    });
  }
  for (const response of responses) {
    if (response.status >= 500) {
      problems.push({
        property: '8 concurrency',
        detail: `${response.status} ${response.raw.slice(0, 200)}`,
      });
    }
  }
  // The write that changed the entry (a 200 answering a new version); the post-checks are against its body.
  const winner = responses.findIndex(
    (response) =>
      response.status < 300 && (response.body as { data?: { version?: number } }).data?.version !== version,
  );
  if (winner !== -1) {
    const after = await storedView(w, entry.id, 'en');
    if (process.env.ITEM_MODEL_DEBUG) {
      writeFileSync(
        `${process.env.ITEM_MODEL_DEBUG}.race`,
        JSON.stringify(
          {
            read,
            bodies,
            winner,
            responses: responses.map((r) => r.raw.slice(0, 300)),
            adminBefore: before.admin,
            adminAfter: after.admin,
            rawBefore: before.draft?.data,
          },
          null,
          1,
        ),
      );
    }
    problems.push(
      ...acceptedWriteProblems(w, {
        before: instancesOf(w, before.draft?.data, before.admin),
        after: instancesOf(w, after.draft?.data, after.admin),
        read,
        body: bodies[winner] as Record<string, unknown>,
        admin: false,
      }).map((problem) => ({ ...problem, property: `8 concurrency / ${problem.property}` })),
      ...idUniqueness(after.heads),
    );
  }
  return problems;
};

describe('item writes, model-based (HTTP and services, real database)', { timeout: 600_000 }, () => {
  const w = itemModelWorld();
  const seeds = Array.from({ length: RUNS }, (_, run) => BASE_SEED + run);
  it.each(seeds)('run %i', async (seed) => {
    const { problems, log } = await runOnce(w, seed);
    expect(report(problems), log.join('\n')).toEqual([]);
  });

  // -------------------------------------------------------------------------------------------------------
  // The reviewer's repros (review 6), each checked by the property that should catch it.

  const putAs = async (
    caller: Caller,
    id: string,
    data: Record<string, unknown>,
    version = false,
    locale = 'en',
  ) => {
    const heads = await headsOf(w, id);
    const draft = heads.find((head) => head.locale === locale && head.state === 'draft');
    return send(w, {
      caller,
      transport: caller.kind === 'admin' ? 'adminApi' : 'rest',
      entryId: id,
      locale,
      version,
      expectedVersion: draft?.version ?? null,
      body: data,
    });
  };
  const adminCreate = async (data: Record<string, unknown>, publish = true) => {
    const id = expectStatus(
      await w.admin.post('/api/admin/content/doc?locale=en', { locale: 'en', data }),
      201,
    ).json<{ id: string }>().id;
    if (publish) {
      expectStatus(await w.admin.post(`/api/admin/content/doc/${id}/publish`, { locales: ['en'] }), 200);
    }
    return id;
  };
  /** Twins: the same entry twice, B's hidden or unreadable parts changed raw; same body; answers compared. */
  const twinAnswers = async (
    caller: Caller,
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    body: Record<string, unknown>,
    version = false,
  ) => {
    const ids = [await adminCreate(a), await adminCreate(b)];
    // Same item IDs in both: B takes A's IDs place by place.
    const [headA] = (await headsOf(w, ids[0] as string)).filter((head) => head.state === 'draft');
    for (const head of await headsOf(w, ids[1] as string)) {
      const copyIds = (from: unknown, to: unknown): unknown =>
        Array.isArray(to)
          ? to.map((item, index) => copyIds(Array.isArray(from) ? from[index] : undefined, item))
          : typeof to === 'object' && to !== null
            ? Object.fromEntries(
                Object.entries(to).map(([key, value]) => [
                  key,
                  key === '__id' && typeof from === 'object' && from !== null && '__id' in from
                    ? from.__id
                    : copyIds((from as Record<string, unknown> | undefined)?.[key], value),
                ]),
              )
            : to;
      await setHeadData(
        w,
        ids[1] as string,
        head.locale,
        head.state,
        copyIds(headA?.data, head.data) as Record<string, unknown>,
      );
    }
    const known = new Set(
      instancesOf(w, headA?.data, await readAs(w, w.callers.admin, ids[0] as string, 'en', false)).map(
        (instance) => instance.id,
      ),
    );
    const answers = [];
    for (const id of ids) {
      answers.push(answerShape(await putAs(caller, id, body, version), known));
    }
    return answers;
  };
  const noOracle = (answers: unknown[]): Problem[] =>
    isDeepStrictEqual(answers[0], answers[1])
      ? []
      : [
          {
            property: '2 no oracle',
            detail: `${JSON.stringify(answers[0])} vs ${JSON.stringify(answers[1])}`,
          },
        ];

  it('hidden2 (2 no oracle): a write-only caller through V: pairing a hidden nested list does not depend on the hidden note', async () => {
    const problems: Problem[] = [];
    for (const version of [false, true]) {
      problems.push(
        ...noOracle(
          await twinAnswers(
            w.callers.updateOnly,
            { title: 't', hero: { label: 'L', items: [{ zv: 'A', zh: 'n1' }, { zv: 'A' }] } },
            { title: 't', hero: { label: 'L', items: [{ zv: 'A' }, { zv: 'A', zh: 'n2' }] } },
            { hero: { label: 'L', items: [{ zv: 'A' }] } },
            version,
          ),
        ),
      );
    }
    expect(report(problems)).toEqual([]);
  });

  it('V1 (2 no oracle): a caller that may write but not read the single component cannot test a guess of its nested items', async () => {
    const problems: Problem[] = [];
    for (const version of [false, true]) {
      problems.push(
        ...noOracle(
          await twinAnswers(
            w.callers.masked,
            {
              title: 't',
              hero: {
                label: 'L',
                items: [
                  { zv: 'secret-A', zh: 'n1' },
                  { zv: 'secret-B', zh: 'n2' },
                ],
              },
            },
            {
              title: 't',
              hero: {
                label: 'L',
                items: [
                  { zv: 'other', zh: 'n1' },
                  { zv: 'other2', zh: 'n2' },
                ],
              },
            },
            { hero: { label: 'L', items: [{ zv: 'secret-A' }, { zv: 'secret-B' }] } },
            version,
          ),
        ),
      );
    }
    expect(report(problems)).toEqual([]);
  });

  it('K1 (2 no oracle): look-alikes that differ only in a relation to an unpublished entry', async () => {
    const answers = await twinAnswers(
      w.callers.reader,
      {
        title: 't',
        cards: [
          { heading: 'X', note: 'n-first', rel: w.things.draft },
          { heading: 'X', note: 'n-second' },
        ],
      },
      {
        title: 't',
        cards: [
          { heading: 'X', note: 'n-first' },
          { heading: 'X', note: 'n-second' },
        ],
      },
      { cards: [{ heading: 'X' }] },
    );
    expect(report(noOracle(answers))).toEqual([]);
  });

  it('K2 (4 order and status): not the owner: 404/403 before any item or body issue', async () => {
    const id = await adminCreate({
      title: 't',
      cards: [
        { heading: 'A', note: 'n1' },
        { heading: 'B', note: 'n2' },
      ],
    });
    await w.db
      .updateTable('entries')
      .set({ owner_app_user_id: w.stranger.user.id })
      .where('id', '=', id)
      .execute();
    const problems: Problem[] = [];
    for (const data of [
      { title: 'x' },
      { cards: [{ heading: 'A2' }, { heading: 'B' }] },
      { cards: [{ id: randomUUID(), heading: 'A' }] },
      { cards: 'nope' },
    ]) {
      const response = await putAs(w.callers.owner, id, data);
      const missing = await w.request('PUT', `/api/content/docs/${randomUUID()}`, w.callers.owner.token, {
        expectedVersion: 1,
        data,
      });
      if (![403, 404].includes(response.status) || response.status !== missing.status) {
        problems.push({
          property: '4 order and status',
          detail: `${JSON.stringify(data)}: another's entry ${response.status} ${outcomeOf(response).code}, a missing one ${missing.status} ${outcomeOf(missing).code}`,
        });
      }
    }
    expect(report(problems)).toEqual([]);
  });

  it('DUPID (3 ID integrity): a create body that repeats an ID never stores two items under one ID', async () => {
    const problems: Problem[] = [];
    const x = randomUUID();
    const bodies = [
      {
        title: 'mine',
        cards: [
          { id: x, heading: 'A' },
          { id: x, heading: 'B' },
        ],
      },
      {
        title: 'mine',
        cards: [{ id: x, heading: 'A' }],
        hero: { id: x, label: 'H' },
        lchips: [{ id: x, zv: 'c' }],
      },
    ];
    for (const data of bodies) {
      for (const [who, created] of [
        [
          'delivery',
          await w.request('POST', '/api/content/docs?locale=en', w.callers.reader.token, {
            locale: 'en',
            data,
          }),
        ],
        [
          'admin',
          await w.request('POST', '/api/admin/content/doc?locale=en', w.adminToken, { locale: 'en', data }),
        ],
      ] as const) {
        const body = created.body as { id?: string; data?: { id?: string } };
        const id = body.data?.id ?? body.id;
        if (created.status < 300 && id) {
          problems.push(
            ...idUniqueness(await headsOf(w, id)).map((problem) => ({
              ...problem,
              detail: `${who} create: ${problem.detail}`,
            })),
          );
        }
      }
    }
    expect(report(problems)).toEqual([]);
  });

  it('ADM2/5/6 (3 ID integrity): an admin write without IDs never reuses an ID for different content', async () => {
    const problems: Problem[] = [];
    const A = { heading: 'A', note: 'n1' };
    const B = { heading: 'B', note: 'n2' };
    const C = { heading: 'C', note: 'n3' };
    const D = { heading: 'D', note: 'n4' };
    for (const [name, start, sent] of [
      ['ADM2', [A, B, C], [A, { heading: 'C2', note: 'n3' }]],
      ['ADM5', [A, B, C], [A, D]],
      ['ADM6', [A, B], [D, { heading: 'A2', note: 'n1' }, B]],
    ] as const) {
      const id = await adminCreate({ title: 't', cards: start });
      const before = await storedView(w, id, 'en');
      const response = await putAs(w.callers.admin, id, { cards: sent });
      const after = await storedView(w, id, 'en');
      if (response.status < 300) {
        const beforeIds = new Map(
          instancesOf(w, before.draft?.data, before.admin).map((instance) => [instance.id, instance]),
        );
        for (const instance of instancesOf(w, after.draft?.data, after.admin)) {
          const was = beforeIds.get(instance.id);
          if (was && was.raw[w.card.heading] !== instance.raw[w.card.heading]) {
            problems.push({
              property: '3 ID integrity',
              detail: `${name}: ID of ${String(was.raw[w.card.heading])} now holds ${String(instance.raw[w.card.heading])}`,
            });
          }
        }
      }
    }
    expect(report(problems)).toEqual([]);
  });

  it('VER1 (5 round trip): a delivery reader sends back what it read, with the version a 409 tells it', async () => {
    // A delivery read never shows the entry's version (as on main): the client learns it from its last write
    // response, or from a 409's details.currentVersion. Then sending back what it read is accepted unchanged.
    const id = await adminCreate({
      title: 't',
      cards: [
        { heading: 'A', note: 'n1' },
        { heading: 'B', note: 'n2' },
      ],
    });
    expect(report(await roundTripProblems(w, w.callers.reader, id, 'en', false))).toEqual([]);
    expect(report(await roundTripProblems(w, w.callers.reader, id, 'en', true))).toEqual([]);
  });

  it('shape500 (4 order and status): no body shape answers 5xx, on any route', async () => {
    const id = await adminCreate({
      title: 't',
      cards: [{ heading: 'A', chips: [{ zv: 'a' }] }],
      hero: { label: 'L', items: [{ zv: 'i' }] },
    });
    const plain = expectStatus(
      await w.admin.post('/api/admin/content/plain', {
        data: { title: 't', links: [{ label: 'x' }], one: { label: 'o' } },
      }),
      201,
    ).json<{ id: string }>().id;
    const shapes: unknown[] = [
      { cards: 'nope' },
      { cards: { heading: 'x' } },
      { cards: 5 },
      { cards: true },
      { cards: ['a'] },
      { cards: [[]] },
      { cards: '' },
      { hero: [{ label: 'x' }] },
      { hero: 'x' },
      { hero: [] },
      { hero: 0 },
      { hero: false },
      { hero: '' },
      { zone: 'x' },
      { zone: { __component: 'card' } },
      { zone: ['x'] },
      { cards: [{ heading: 'b', chips: 'nope' }] },
      { cards: [{ heading: 'b', chips: { zv: 'i' } }] },
      { hero: { label: 'b', items: 'nope' } },
      { zone: [{ __component: 'card', chips: 'nope' }] },
    ];
    const problems: Problem[] = [];
    for (const data of shapes) {
      for (const [route, response] of [
        [
          'delivery PUT',
          await w.request('PUT', `/api/content/docs/${id}`, w.callers.reader.token, {
            expectedVersion: 1,
            data,
          }),
        ],
        [
          'delivery PUT @V',
          await w.request(
            'PUT',
            `/api/content/docs/${id}?schemaVersion=${encodeURIComponent(w.versionToken)}`,
            w.callers.reader.token,
            { expectedVersion: 1, data },
          ),
        ],
        ['delivery POST', await w.request('POST', '/api/content/docs', w.callers.reader.token, { data })],
        [
          'admin PUT',
          await w.request('PUT', `/api/admin/content/doc/${id}`, w.adminToken, { expectedVersion: 1, data }),
        ],
        [
          'admin autosave',
          await w.request('PUT', `/api/admin/content/doc/${id}`, w.adminToken, {
            expectedVersion: 1,
            data,
            autosave: true,
          }),
        ],
        ['admin POST', await w.request('POST', '/api/admin/content/doc', w.adminToken, { data })],
        [
          'plain PUT',
          await w.request('PUT', `/api/content/plains/${plain}`, w.callers.reader.token, {
            expectedVersion: 1,
            data: { links: (data as { cards?: unknown }).cards ?? 'x' },
          }),
        ],
      ] as const) {
        if (response.status >= 500) {
          problems.push({
            property: '4 order and status',
            detail: `${route} ${JSON.stringify(data)} → ${response.status}`,
          });
        }
      }
    }
    expect(report(problems)).toEqual([]);
  });

  it('noread (6 compatibility): a type with nothing hidden: callers that cannot read still write without IDs', async () => {
    const problems: Problem[] = [];
    for (const caller of [w.callers.updateOnly, w.callers.anon, w.callers.reader]) {
      for (const data of [
        { links: [{ label: 'x' }, { label: 'y' }] },
        { links: [{ label: 'x2' }, { label: 'y' }] },
        { links: [{ label: 'x' }, { label: 'y' }, { label: 'z' }] },
        { links: [{ label: 'p' }] },
        { links: [] },
        { one: { label: 'o2' } },
      ]) {
        const id = expectStatus(
          await w.admin.post('/api/admin/content/plain', {
            data: { title: 't', links: [{ label: 'x' }, { label: 'y' }], one: { label: 'o' } },
          }),
          201,
        ).json<{ id: string }>().id;
        expectStatus(await w.admin.post(`/api/admin/content/plain/${id}/publish`, {}), 200);
        const response = await w.request('PUT', `/api/content/plains/${id}`, caller.token, {
          expectedVersion: 1,
          data,
        });
        if (response.status >= 300) {
          problems.push({
            property: '6 compatibility',
            detail: `${caller.name} ${JSON.stringify(data)} → ${response.status} ${outcomeOf(response).code} ${outcomeOf(response).issues.join(' ')}`,
          });
        }
      }
    }
    expect(report(problems)).toEqual([]);
  });

  it('CONV5 (3 ID integrity): a legacy single component made a list reads with one ID in the draft and the published head', async () => {
    const conv = await createDefinition(w.admin, {
      kind: 'collection',
      apiKey: `conv${seedSuffix()}`,
      label: 'Conv',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        {
          apiKey: 'hero',
          label: 'Hero',
          type: 'component',
          settings: { component: w.components.chip.definition.id },
        },
      ],
    });
    const key = conv.definition.apiKey;
    const id = expectStatus(
      await w.admin.post(`/api/admin/content/${key}`, { data: { title: 't', hero: { zv: 'H', zh: 'nh' } } }),
      201,
    ).json<{ id: string }>().id;
    expectStatus(await w.admin.post(`/api/admin/content/${key}/${id}/publish`, {}), 200);
    for (const head of await headsOf(w, id)) {
      const strip = (value: unknown): unknown =>
        Array.isArray(value)
          ? value.map(strip)
          : typeof value === 'object' && value !== null
            ? Object.fromEntries(
                Object.entries(value)
                  .filter(([k]) => k !== '__id')
                  .map(([k, v]) => [k, strip(v)]),
              )
            : value;
      await setHeadData(w, id, head.locale, head.state, strip(head.data) as Record<string, unknown>);
    }
    const current = expectStatus(await w.admin.get(`/api/admin/models/${conv.definition.id}`), 200).json<{
      definition: { fields: Array<Record<string, unknown>> };
      version: number;
    }>();
    const changed = await w.admin.put(`/api/admin/models/${conv.definition.id}`, {
      definition: {
        ...current.definition,
        fields: current.definition.fields.map((field) =>
          field.apiKey === 'hero'
            ? { ...field, settings: { ...(field.settings as object), repeatable: true } }
            : field,
        ),
      },
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    expect(changed.statusCode).toBeLessThan(300);
    await runContentSchemaJobs(w.db);
    const admin = (await w.request('GET', `/api/admin/content/${key}/${id}`, w.adminToken)).body as {
      data: { hero: Array<{ id: string }> };
    };
    const delivered = (await w.request('GET', `/api/content/${key}s/${id}`, w.adminToken)).body as {
      data: { hero: Array<{ id: string }> };
    };
    const problems: Problem[] =
      admin.data.hero[0]?.id === delivered.data.hero[0]?.id
        ? []
        : [
            {
              property: '3 ID integrity',
              detail: `draft reads ${String(admin.data.hero[0]?.id)}, published ${String(delivered.data.hero[0]?.id)}`,
            },
          ];
    expect(report(problems)).toEqual([]);
  });

  it('DEP1 (1 conservation): an admin saving back what it read keeps the values of a field deprecated since', async () => {
    const id = await adminCreate({ title: 't', cards: [{ heading: 'A' }, { heading: 'B' }] });
    for (const head of await headsOf(w, id)) {
      const cards = (head.data[w.doc.cards] as Array<Record<string, unknown>>).map((card, index) => ({
        ...card,
        [w.card.old]: `§old${index}`,
      }));
      await setHeadData(w, id, head.locale, head.state, { ...head.data, [w.doc.cards]: cards });
    }
    const read = await readAs(w, w.callers.admin, id, 'en', false);
    const before = await storedView(w, id, 'en');
    const cards = (read?.cards as Array<Record<string, unknown>>).map((card, index) =>
      index === 0 ? { ...card, heading: 'A2' } : card,
    );
    const { problems } = await checkedWrite(w, {
      caller: w.callers.admin,
      transport: 'adminApi',
      entryId: id,
      locale: 'en',
      version: false,
      expectedVersion: before.draft?.version ?? null,
      body: { cards },
      read,
    });
    expect(report(problems)).toEqual([]);
  });

  it('RELNULL (1 conservation, 5 round trip): sending back a relation read as null (its target unpublished) keeps it', async () => {
    // Found by run seed 5 (a round trip through V by the limited caller). The relation's target is unpublished,
    // so a delivery read shows it as null; sent back as read, with the item's ID, it must stay stored.
    const problems: Problem[] = [];
    for (const version of [false, true]) {
      const id = await adminCreate({ title: 't', cards: [{ heading: 'A', rel: w.things.draft }] });
      const read = await readAs(w, w.callers.reader, id, 'en', version);
      const before = await storedView(w, id, 'en');
      const { problems: found } = await checkedWrite(w, {
        caller: w.callers.reader,
        transport: 'rest',
        entryId: id,
        locale: 'en',
        version,
        expectedVersion: before.draft?.version ?? null,
        body: { cards: read?.cards },
        read,
      });
      problems.push(
        ...found.map((problem) => ({ ...problem, detail: `${version ? '@V ' : ''}${problem.detail}` })),
      );
    }
    expect(report(problems)).toEqual([]);
  });

  it('LOOKSWAP (3 ID integrity): swapping two items by their IDs is a no-op when they are identical in full stored content, and a change when they differ in anything stored', async () => {
    // Review 11 refinement: a swap of identical items by id is a no-op only where the caller sees everything
    // stored (a list with nothing hidden from it, and the admin API); on a list that can hold hidden values it is
    // always a change, so the response is not an oracle.
    const problems: Problem[] = [];
    for (const differ of [false, true]) {
      const id = await adminCreate({
        title: 't',
        cards: [
          {
            heading: 'A',
            chips: differ
              ? [
                  { zv: 'a', zh: '1' },
                  { zv: 'a', zh: '2' },
                ]
              : [{ zv: 'a' }, { zv: 'a' }],
          },
        ],
      });
      const read = await readAs(w, w.callers.reader, id, 'en', false);
      const card = (
        read?.cards as Array<{ id: string; heading: string; chips: Array<{ id: string; zv: string }> }>
      )[0];
      const swapped = [...(card?.chips ?? [])].reverse();
      const [revisions, beforeHeads] = [await revisionCount(w, id), await headsOf(w, id)];
      const zh = (heads: typeof beforeHeads) =>
        (
          ((
            heads.find((head) => head.locale === 'en' && head.state === 'draft')?.data[w.doc.cards] as
              Array<Record<string, unknown>> | undefined
          )?.[0]?.[w.card.chips] as Array<Record<string, unknown>> | undefined) ?? []
        ).map((chip) => [chip.__id, chip[w.chip.zh]]);
      const response = await putAs(w.callers.reader, id, {
        cards: [{ id: card?.id, heading: 'A', chips: swapped }],
      });
      const afterHeads = await headsOf(w, id);
      if (response.status >= 300) {
        problems.push({
          property: '3 ID integrity',
          detail: `differ=${differ}: answered ${response.status}`,
        });
      } else if (
        (await revisionCount(w, id)) === revisions ||
        !isDeepStrictEqual(zh(afterHeads), [...zh(beforeHeads)].reverse())
      ) {
        // The chip list can hold a value hidden from the reader (private `zh`): a swap by id is always a change,
        // stored in the order sent, whether or not the hidden values differ (review 11 refinement).
        problems.push({
          property: '3 ID integrity (LOOKSWAP)',
          detail: `differ=${differ}: the swap by id stored ${JSON.stringify(zh(afterHeads))}, revisions ${revisions} → ${await revisionCount(w, id)}`,
        });
      }
    }
    // On a list that holds nothing hidden from the caller (`plain.links`), swapping two identical items by id is a
    // no-op (main: no change).
    const plainId = expectStatus(
      await w.admin.post('/api/admin/content/plain?locale=en', {
        locale: 'en',
        data: { title: 'p', links: [{ label: 'x' }, { label: 'x' }] },
      }),
      201,
    ).json<{ id: string }>().id;
    const links = (await w.request('GET', `/api/admin/content/plain/${plainId}?locale=en`, w.adminToken))
      .body as {
      version: number;
      data: { links: Array<{ id: string; label: string }> };
    };
    const plainRevisions = await revisionCount(w, plainId);
    const plainHeads = await headsOf(w, plainId);
    const swapped = await w.request(
      'PUT',
      `/api/content/plains/${plainId}?locale=en`,
      w.callers.reader.token,
      {
        locale: 'en',
        expectedVersion: links.version,
        data: { links: [...links.data.links].reverse() },
      },
    );
    if (
      swapped.status >= 300 ||
      (await revisionCount(w, plainId)) !== plainRevisions ||
      !isDeepStrictEqual(await headsOf(w, plainId), plainHeads)
    ) {
      problems.push({
        property: '9 no-op (LOOKSWAP)',
        detail: `reader on plain.links: swapping two identical items answered ${swapped.status}, revisions ${plainRevisions} → ${await revisionCount(w, plainId)}`,
      });
    }
    expect(report(problems)).toEqual([]);
  });

  it('NOOP (5 round trip): a write that changes nothing makes no revision and fires no event', async () => {
    const problems: Problem[] = [];
    for (const data of [{}, { title: 't' }]) {
      const id = await adminCreate({ title: 't', cards: [{ heading: 'A', note: 'n1' }] });
      const [revisions, events] = [await revisionCount(w, id), await eventCount(w, id)];
      const response = await putAs(w.callers.reader, id, data);
      if (response.status >= 300) {
        problems.push({ property: '5 round trip', detail: `${JSON.stringify(data)}: ${response.status}` });
      }
      if ((await revisionCount(w, id)) !== revisions || (await eventCount(w, id)) !== events) {
        problems.push({
          property: '5 round trip',
          detail: `${JSON.stringify(data)}: revisions ${revisions} → ${await revisionCount(w, id)}, events ${events} → ${await eventCount(w, id)}, answered version ${String((response.body as { data?: { version?: number } }).data?.version)}`,
        });
      }
    }
    expect(report(problems)).toEqual([]);
  });

  // -------------------------------------------------------------------------------------------------------
  // Review 7

  it('N1 (relation candidates): every candidate in every relation position, for every reading caller', async () => {
    const problems: Problem[] = [];
    const random = prng(7);
    // Every caller (with and without a version) meets every candidate and every position; across callers every
    // candidate meets every position (a rotation, not the whole product, to keep the default run short).
    const callers = ['reader', 'masked', 'owner', 'updateOnly', 'adminToken', 'admin'] as const;
    let turn = 0;
    for (const name of callers) {
      const caller = w.callers[name];
      for (const version of caller.kind === 'admin' ? [false] : [false, true]) {
        for (const [index, candidate] of CANDIDATE_LABELS.entries()) {
          const position = POSITIONS[(index + turn) % POSITIONS.length] as (typeof POSITIONS)[number];
          problems.push(
            ...(await relationProbeProblems(
              w,
              random,
              caller,
              version,
              caller.kind === 'admin' ? 'adminApi' : 'rest',
              {
                candidate,
                position: position.name,
              },
            )),
          );
        }
        turn += 1;
      }
    }
    expect(report(problems)).toEqual([]);
  });

  it('N2 (identical re-save): for every caller kind, the same body twice: the second is a no-op', async () => {
    const problems: Problem[] = [];
    for (const name of CALLERS) {
      const caller = w.callers[name];
      await withAnonymousDocGrants(w, caller, async () => {
        if (caller.reads && caller.kind !== 'anon') {
          for (const withIds of [true, false]) {
            // Distinct items: with IDs (an edit), and without (a reorder).
            const id = await adminCreate({
              title: 't',
              cards: [
                { heading: 'A', note: 'n1' },
                { heading: 'B', note: 'n2' },
              ],
            });
            if (caller.ownOnly) {
              await w.db
                .updateTable('entries')
                .set({ owner_app_user_id: caller.userId ?? null })
                .where('id', '=', id)
                .execute();
            }
            const read = await readAs(w, caller, id, 'en', caller.pinned === true);
            const cards = (read?.cards as Array<Record<string, unknown>> | undefined) ?? [];
            const body = {
              cards: withIds
                ? cards.map((card, index) => ({
                    id: card.id,
                    heading: index === 0 ? `${String(card.heading)}+` : card.heading,
                  }))
                : [...cards]
                    .reverse()
                    .map((card) =>
                      Object.fromEntries(
                        Object.entries(card).filter(
                          ([key, value]) =>
                            key !== 'id' && value !== null && !(Array.isArray(value) && value.length === 0),
                        ),
                      ),
                    ),
            };
            const request = {
              caller,
              transport: (caller.kind === 'admin' ? 'adminApi' : 'rest') as Transport,
              entryId: id,
              locale: 'en',
              version: caller.pinned === true,
              body,
            };
            const heads = await headsOf(w, id);
            const first = await send(w, {
              ...request,
              expectedVersion:
                heads.find((head) => head.state === 'draft' && head.locale === 'en')?.version ?? null,
            });
            if (first.status >= 300) {
              problems.push({
                property: '5 round trip (N2)',
                detail: `${caller.name} first write ${withIds ? 'with' : 'without'} IDs: ${first.status} ${first.raw.slice(0, 160)}`,
              });
              continue;
            }
            problems.push(
              ...(await resaveProblems(w, { ...request, expectedVersion: null }, first)).map((problem) => ({
                ...problem,
                detail: `${withIds ? 'IDs' : 'no IDs'}: ${problem.detail}`,
              })),
            );
          }
        } else {
          // A caller that cannot read: a list it may write completely (a plain list), sent twice in full.
          const id = expectStatus(
            await w.admin.post('/api/admin/content/plain', { data: { title: 't', links: [{ label: 'x' }] } }),
            201,
          ).json<{ id: string; version: number }>();
          const body = { links: [{ label: 'a' }, { label: 'b' }] };
          const first = await w.request('PUT', `/api/content/plains/${id.id}`, caller.token, {
            expectedVersion: id.version,
            data: body,
          });
          const version = versionOfResponse(first.body);
          const [revisions] = [await revisionCount(w, id.id)];
          const linkIds = async () =>
            (
              (await w.request('GET', `/api/admin/content/plain/${id.id}`, w.adminToken)).body as {
                data: { links: Array<{ id: string }> };
              }
            ).data.links.map((link) => link.id);
          const idsBefore = await linkIds();
          const again = await w.request('PUT', `/api/content/plains/${id.id}`, caller.token, {
            expectedVersion: version,
            data: body,
          });
          if (JSON.stringify(await linkIds()) !== JSON.stringify(idsBefore)) {
            problems.push({
              property: '5 round trip (N2)',
              detail: `${caller.name} (cannot read): the same full list again changed the item IDs`,
            });
          }
          if (
            first.status >= 300 ||
            again.status >= 300 ||
            versionOfResponse(again.body) !== version ||
            (await revisionCount(w, id.id)) !== revisions
          ) {
            problems.push({
              property: '5 round trip (N2)',
              detail: `${caller.name} (cannot read) plain links twice: ${first.status} v${String(version)}, then ${again.status} v${String(versionOfResponse(again.body))}, revisions ${revisions} → ${await revisionCount(w, id.id)}`,
            });
          }
        }
      });
    }
    expect(report(problems)).toEqual([]);
  });

  it('N3 (round trip through V with IDs): fields that cannot be written through the version, sent back unchanged with their IDs, are a no-op', async () => {
    const one = await createDefinition(
      w.admin,
      {
        kind: 'component',
        apiKey: `vone${seedSuffix()}`,
        label: 'Vone',
        fields: [
          { apiKey: 'label', label: 'Label', type: 'string' },
          { apiKey: 'n', label: 'N', type: 'number' },
        ],
      },
      'components',
    );
    const two = await createDefinition(
      w.admin,
      {
        kind: 'component',
        apiKey: `vtwo${seedSuffix()}`,
        label: 'Vtwo',
        fields: [{ apiKey: 'label', label: 'Label', type: 'string' }],
      },
      'components',
    );
    const box = await createDefinition(
      w.admin,
      {
        kind: 'component',
        apiKey: `vbox${seedSuffix()}`,
        label: 'Vbox',
        fields: [
          { apiKey: 'label', label: 'Label', type: 'string' },
          {
            apiKey: 'items',
            label: 'Items',
            type: 'component',
            settings: { component: one.definition.id, repeatable: true },
          },
        ],
      },
      'components',
    );
    const model = await createDefinition(w.admin, {
      kind: 'collection',
      apiKey: `vdoc${seedSuffix()}`,
      label: 'Vdoc',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'zone', label: 'Zone', type: 'dynamiczone', settings: { components: [one.definition.id] } },
        { apiKey: 'single', label: 'Single', type: 'component', settings: { component: one.definition.id } },
        {
          apiKey: 'list',
          label: 'List',
          type: 'component',
          settings: { component: one.definition.id, repeatable: true },
        },
        { apiKey: 'nest', label: 'Nest', type: 'component', settings: { component: box.definition.id } },
      ],
    });
    const key = model.definition.apiKey;
    const plural = `${key}s`;
    const item = { label: 'a', n: 1 };
    const id = expectStatus(
      await w.admin.post(`/api/admin/content/${key}`, {
        data: {
          title: 't',
          zone: [{ __component: one.definition.apiKey, ...item }],
          single: item,
          list: [item, { label: 'b', n: 2 }],
          nest: { label: 'L', items: [item] },
        },
      }),
      201,
    ).json<{ id: string }>().id;
    expectStatus(await w.admin.post(`/api/admin/content/${key}/${id}/publish`, {}), 200);
    const v2 = expectStatus(await w.admin.get('/api/snapshots/current'), 200).json<{
      schemaVersionToken: string;
    }>().schemaVersionToken;
    // Since V2: the zone allows another component; the item's number became an integer (read-only through V2).
    const edit = async (
      definitionId: string,
      path: 'models' | 'components',
      change: (fields: Array<Record<string, unknown>>) => Array<Record<string, unknown>>,
    ) => {
      const current = expectStatus(await w.admin.get(`/api/admin/${path}/${definitionId}`), 200).json<{
        definition: { fields: Array<Record<string, unknown>> };
        version: number;
      }>();
      const changed = await w.admin.put(`/api/admin/${path}/${definitionId}`, {
        definition: { ...current.definition, fields: change(current.definition.fields) },
        expectedVersion: current.version,
        acknowledgeBreaking: true,
        acknowledgeDestructive: true,
      });
      expect(changed.statusCode, changed.body).toBeLessThan(300);
      await runContentSchemaJobs(w.db);
    };
    await edit(model.definition.id, 'models', (fields) =>
      fields.map((field) =>
        field.apiKey === 'zone'
          ? { ...field, settings: { components: [one.definition.id, two.definition.id] } }
          : field,
      ),
    );
    await edit(one.definition.id, 'components', (fields) =>
      fields.map((field) => (field.apiKey === 'n' ? { ...field, type: 'integer' } : field)),
    );
    const user = await (async () => {
      const { signUp, createAppRole } = await import('./helpers/appUsers.js');
      const session = await signUp(w.testApp.app);
      expectStatus(
        await w.admin.request({
          method: 'PATCH',
          url: `/api/admin/app-users/${session.user.id}`,
          payload: {
            roleIds: [
              await createAppRole(w.db, [
                { action: 'read', modelId: model.definition.id },
                { action: 'update', modelId: model.definition.id },
              ]),
            ],
          },
        }),
        200,
      );
      return session.accessToken;
    })();
    const problems: Problem[] = [];
    for (const [who, token] of [
      ['user', user],
      ['adminToken', w.adminToken],
    ] as const) {
      for (const field of ['zone', 'single', 'list', 'nest'] as const) {
        const query = `?schemaVersion=${encodeURIComponent(v2)}`;
        const read = (await w.request('GET', `/api/content/${plural}/${id}${query}`, token)).body as {
          data: Record<string, unknown>;
        };
        const before = await headsOf(w, id);
        const revisions = await revisionCount(w, id);
        const version = before.find((head) => head.state === 'draft')?.version ?? null;
        const response = await w.request('PUT', `/api/content/${plural}/${id}${query}`, token, {
          expectedVersion: version,
          data: { [field]: read.data[field] },
        });
        const after = await headsOf(w, id);
        if (response.status >= 300) {
          problems.push({
            property: '5 round trip (N3)',
            detail: `${who} ${field} through V2: ${response.status} ${response.raw.slice(0, 200)}`,
          });
        } else if (
          !isDeepStrictEqual(
            after.map((head) => head.data),
            before.map((head) => head.data),
          ) ||
          (await revisionCount(w, id)) !== revisions
        ) {
          problems.push({
            property: '5 round trip (N3)',
            detail: `${who} ${field} through V2: accepted but not a no-op`,
          });
        }
      }
    }
    expect(report(problems)).toEqual([]);
  });

  it('N4 (GraphQL literals): inline literals answer as variables do; a body deeper than 64 is BODY_TOO_DEEP, never 500', async () => {
    const problems: Problem[] = [];
    const id = await adminCreate({ title: 't', cards: [{ heading: 'A', note: 'n1' }] });
    const read = await readAs(w, w.callers.reader, id, 'en', false);
    const card = (read?.cards as Array<{ id: string }>)[0];
    for (const data of [
      { title: 'x' },
      { cards: [{ id: card?.id, heading: 'A2' }] },
      { cards: [{ heading: 'X' }, { heading: 'X' }] },
      { cards: [{ id: 'unknown-id-12', heading: 'A' }] },
    ]) {
      const version = (await headsOf(w, id)).find((head) => head.state === 'draft')?.version ?? 1;
      const literal = await w.gql(
        `mutation { updateDoc(id: "${id}", expectedVersion: ${version}, data: ${graphqlLiteral(data)}) { id version } }`,
        {},
        w.callers.reader.token,
        false,
      );
      const variables = await w.gql(
        `mutation ($id: ID!, $v: Int, $data: DocInput) { updateDoc(id: $id, expectedVersion: $v, data: $data) { id version } }`,
        { id, v: version, data },
        w.callers.reader.token,
        false,
      );
      const [a, b] = [outcomeOf(literal), outcomeOf(variables)];
      if (a.code !== b.code || a.status !== b.status) {
        // The first may have been accepted; then the second answers a stale version. Compare refusals only.
        if (!(a.code === 'OK' && b.code === 'CONTENT_VERSION_CONFLICT')) {
          problems.push({
            property: '4 order and status (N4)',
            detail: `${JSON.stringify(data)}: literal ${a.status} ${a.code}, variables ${b.status} ${b.code}`,
          });
        }
      }
    }
    // Decision (e): a document over GRAPHQL_MAX_TOKENS (5,000 tokens) is 400 QUERY_TOO_LARGE.
    const largeDocument = `{ docs { ${'id '.repeat(5200)}} }`; // flat: many tokens, no depth
    const tooLarge = await w.gql(largeDocument, {}, w.callers.reader.token, false);
    if (tooLarge.status !== 400 || outcomeOf(tooLarge).code !== 'QUERY_TOO_LARGE') {
      problems.push({
        property: '4 order and status (N4)',
        detail: `a flat document of over 5,200 tokens: ${tooLarge.status} ${outcomeOf(tooLarge).code} ${tooLarge.raw.slice(0, 160)}`,
      });
    }
    // Decision (e): bodies up to 100 levels (MySQL counting) are accepted; deeper is 422 BODY_TOO_DEEP, the same on
    // REST, GraphQL variables, and literals. 90 levels of JSON inside a card is accepted; 110 is refused.
    for (const [depth, refused] of [
      [90, false],
      [110, true],
    ] as const) {
      const deep = { cards: [{ heading: 'D', data: nested(depth) }] };
      const version = (await headsOf(w, id)).find((head) => head.state === 'draft')?.version ?? 1;
      for (const [route, response] of [
        [
          'GraphQL literal',
          await w.gql(
            `mutation { updateDoc(id: "${id}", expectedVersion: ${version}, data: ${graphqlLiteral(deep)}) { id } }`,
            {},
            w.callers.reader.token,
            false,
          ),
        ],
        [
          'GraphQL variables',
          await w.gql(
            `mutation ($id: ID!, $v: Int, $data: DocInput) { updateDoc(id: $id, expectedVersion: $v, data: $data) { id } }`,
            { id, v: version, data: deep },
            w.callers.reader.token,
            false,
          ),
        ],
        [
          'REST',
          await w.request('PUT', `/api/content/docs/${id}`, w.callers.reader.token, {
            expectedVersion: version,
            data: deep,
          }),
        ],
        [
          'admin REST',
          await w.request('PUT', `/api/admin/content/doc/${id}`, w.adminToken, {
            expectedVersion: version,
            data: deep,
          }),
        ],
      ] as const) {
        const outcome = outcomeOf(response);
        // Not refused: anything but BODY_TOO_DEEP (and no 5xx); refused: exactly 422 BODY_TOO_DEEP.
        if (
          response.status >= 500 ||
          (refused
            ? outcome.code !== 'BODY_TOO_DEEP' || (route.includes('REST') && response.status !== 422)
            : outcome.code === 'BODY_TOO_DEEP')
        ) {
          problems.push({
            property: '4 order and status (N4)',
            detail: `${route} depth ${depth}: ${response.status} ${outcome.code} ${response.raw.slice(0, 160)}`,
          });
        }
      }
    }
    expect(report(problems)).toEqual([]);
  });

  it('N5 (copies): a duplicate and a restored revision hold unique IDs, and writes to them keep every property', async () => {
    const problems: Problem[] = [];
    const source = await adminCreate({
      title: 't',
      cards: [
        { heading: 'A', note: 'n1', chips: [{ zv: 'a', zh: 'z1' }] },
        { heading: 'B', note: 'n2' },
      ],
      hero: { label: 'L', items: [{ zv: 'i', zh: 'zi' }] },
    });
    // Duplicate.
    const duplicated = await w.request(
      'POST',
      `/api/admin/content/doc/${source}/duplicate`,
      w.adminToken,
      {},
    );
    const copyId = (duplicated.body as { id?: string }).id;
    if (duplicated.status >= 300 || !copyId) {
      problems.push({
        property: '3 ID integrity (N5)',
        detail: `duplicate: ${duplicated.status} ${duplicated.raw.slice(0, 160)}`,
      });
    } else {
      problems.push(...idUniqueness(await headsOf(w, copyId)));
      const sourceIds = new Set(
        instancesOf(
          w,
          (await storedView(w, source, 'en')).draft?.data,
          (await storedView(w, source, 'en')).admin,
        ).map((instance) => instance.id),
      );
      const shared = instancesOf(
        w,
        (await storedView(w, copyId, 'en')).draft?.data,
        (await storedView(w, copyId, 'en')).admin,
      ).filter((instance) => sourceIds.has(instance.id));
      if (shared.length > 0) {
        problems.push({
          property: '3 ID integrity (N5)',
          detail: `the duplicate shares ${shared.length} item IDs with its source`,
        });
      }
      expectStatus(await w.admin.post(`/api/admin/content/doc/${copyId}/publish`, { locales: ['en'] }), 200);
      const read = await readAs(w, w.callers.reader, copyId, 'en', false);
      const before = await storedView(w, copyId, 'en');
      const cards = (read?.cards as Array<Record<string, unknown>>).map((card) => ({
        id: card.id,
        heading: `${String(card.heading)}2`,
      }));
      problems.push(
        ...(
          await checkedWrite(w, {
            caller: w.callers.reader,
            transport: 'rest',
            entryId: copyId,
            locale: 'en',
            version: false,
            expectedVersion: before.draft?.version ?? null,
            body: { cards },
            read,
          })
        ).problems,
      );
    }
    // Restore an older revision, then write.
    const first = (await headsOf(w, source)).find((head) => head.state === 'draft');
    const view = (await w.request('GET', `/api/admin/content/doc/${source}?locale=en`, w.adminToken))
      .body as { version: number; data: { cards: Array<Record<string, unknown>> } };
    expectStatus(
      await w.admin.put(`/api/admin/content/doc/${source}?locale=en`, {
        locale: 'en',
        expectedVersion: view.version,
        data: { cards: view.data.cards.slice(1) },
      }),
      200,
    );
    const current = (await headsOf(w, source)).find((head) => head.state === 'draft');
    const restored = await w.request(
      'POST',
      `/api/admin/content/doc/${source}/revisions/${first?.revision}/restore`,
      w.adminToken,
      { expectedVersion: current?.version },
    );
    if (restored.status >= 300) {
      problems.push({
        property: '3 ID integrity (N5)',
        detail: `restore: ${restored.status} ${restored.raw.slice(0, 160)}`,
      });
    } else {
      problems.push(...idUniqueness(await headsOf(w, source)));
      expectStatus(await w.admin.post(`/api/admin/content/doc/${source}/publish`, { locales: ['en'] }), 200);
      const read = await readAs(w, w.callers.reader, source, 'en', false);
      const before = await storedView(w, source, 'en');
      const cards = (read?.cards as Array<Record<string, unknown>>).map((card) => ({
        id: card.id,
        heading: card.heading,
      }));
      problems.push(
        ...(
          await checkedWrite(w, {
            caller: w.callers.reader,
            transport: 'rest',
            entryId: source,
            locale: 'en',
            version: false,
            expectedVersion: before.draft?.version ?? null,
            body: { cards: [...cards].reverse() },
            read,
          })
        ).problems,
      );
    }
    expect(report(problems)).toEqual([]);
  });

  it('ATRELS (decision (a)): an admin token sending back a delivery read replaces the targets that read left out, as on main', async () => {
    // Was: the unpublished target kept. Decision (a): a caller that may read drafts is treated as shown every
    // target, so what it sends replaces them, as on main; the rest of the entry stays.
    const id = await adminCreate({
      title: 't',
      cards: [{ heading: 'A', rels: [w.things.draft, w.things.published] }],
    });
    expect(report(await roundTripProblems(w, w.callers.adminToken, id, 'en', false))).toEqual([]);
    const stored = JSON.stringify((await headsOf(w, id)).find((head) => head.state === 'draft')?.data ?? {});
    expect(stored.includes(w.things.draft)).toBe(false);
  });

  it('LEGACYRT (5 round trip): sending back what was read of legacy items (no stored IDs) makes no revision', async () => {
    // Found by run seed 4: the round trip persisted the derived IDs of legacy items, a revision and an event
    // for a write that changed nothing (main made it a no-op).
    const id = await adminCreate({ title: 't', cards: [{ heading: 'A' }, { heading: 'B' }] });
    for (const head of await headsOf(w, id)) {
      const strip = (value: unknown): unknown =>
        Array.isArray(value)
          ? value.map(strip)
          : typeof value === 'object' && value !== null
            ? Object.fromEntries(
                Object.entries(value)
                  .filter(([key]) => key !== '__id')
                  .map(([key, entry]) => [key, strip(entry)]),
              )
            : value;
      await setHeadData(w, id, head.locale, head.state, strip(head.data) as Record<string, unknown>);
    }
    expect(report(await roundTripProblems(w, w.callers.reader, id, 'en', false))).toEqual([]);
  });

  it("IDTYPES (4 order and status): a badly typed id is the body's own 422 INVALID_TYPE; an unknown string is UNKNOWN_ITEM_ID after the 409", async () => {
    const problems: Problem[] = [];
    const id = await adminCreate({ title: 't', cards: [{ heading: 'A', note: 'n1' }] });
    const version = (await headsOf(w, id)).find((head) => head.state === 'draft')?.version ?? 1;
    for (const bad of [5, '', 'x'.repeat(65), true, { a: 1 }]) {
      for (const stale of [false, true]) {
        const response = await w.request('PUT', `/api/content/docs/${id}`, w.callers.reader.token, {
          expectedVersion: version + (stale ? 3 : 0),
          data: { cards: [{ id: bad, heading: 'A' }] },
        });
        const outcome = outcomeOf(response);
        if (response.status !== 422 || !outcome.issues.includes('INVALID_TYPE /cards/0/id')) {
          problems.push({
            property: '4 order and status',
            detail: `id ${JSON.stringify(bad).slice(0, 20)}${stale ? ' (stale version)' : ''}: ${response.status} ${outcome.code} ${outcome.issues.join(' ')}`,
          });
        }
      }
    }
    // Decision (h): on create, a non-string `id` is 422 INVALID_TYPE; a well-formed one is ignored (a new ID).
    for (const [bad, want] of [
      [5, 422],
      ['wellFormedId', 201],
    ] as const) {
      const created = await w.request('POST', '/api/content/docs?locale=en', w.callers.reader.token, {
        locale: 'en',
        data: { title: 't', cards: [{ id: bad, heading: 'A' }] },
      });
      const createdId = (created.body as { data?: { id?: string } }).data?.id;
      const storedIds = createdId
        ? JSON.stringify((await headsOf(w, createdId)).map((head) => head.data))
        : '';
      if (
        created.status !== want ||
        (want === 422 && !outcomeOf(created).issues.includes('INVALID_TYPE /cards/0/id')) ||
        storedIds.includes('wellFormedId')
      ) {
        problems.push({
          property: '4 order and status',
          detail: `create with id ${JSON.stringify(bad)}: ${created.status} ${outcomeOf(created).issues.join(' ')}${storedIds.includes('wellFormedId') ? ' (stored the sent id)' : ''}`,
        });
      }
    }
    for (const [stale, want] of [
      [true, '409'],
      [false, '422 UNKNOWN_ITEM_ID'],
    ] as const) {
      const response = await w.request('PUT', `/api/content/docs/${id}`, w.callers.reader.token, {
        expectedVersion: version + (stale ? 3 : 0),
        data: { cards: [{ id: 'unknownIdAbc', heading: 'A' }] },
      });
      const outcome = outcomeOf(response);
      const got =
        response.status === 409
          ? '409'
          : `${response.status} ${outcome.issues.map((issue) => issue.split(' ')[0]).join(',')}`;
      if (got !== want) {
        problems.push({
          property: '4 order and status',
          detail: `an unknown string id${stale ? ' with a stale version' : ''}: ${got}, expected ${want}`,
        });
      }
    }
    expect(report(problems)).toEqual([]);
  });

  it('LEGACYLOC (5 round trip, N2): after a write adds a locale to an entry with legacy items, the same body again is a no-op', async () => {
    // Found by run seed 1,000,408 (updateOnly through V) and 1,000,159 (anonymous, GraphQL): the second identical
    // write makes a revision and bumps the version though the stored data is unchanged.
    const problems: Problem[] = [];
    for (const version of [false, true]) {
      const id = await adminCreate({ title: 't', cards: [{ heading: 'A' }] });
      for (const head of await headsOf(w, id)) {
        const strip = (value: unknown): unknown =>
          Array.isArray(value)
            ? value.map(strip)
            : typeof value === 'object' && value !== null
              ? Object.fromEntries(
                  Object.entries(value)
                    .filter(([key]) => key !== '__id')
                    .map(([key, entry]) => [key, strip(entry)]),
                )
              : value;
        await setHeadData(w, id, head.locale, head.state, strip(head.data) as Record<string, unknown>);
      }
      const request = {
        caller: w.callers.reader,
        transport: 'rest' as Transport,
        entryId: id,
        locale: 'fr',
        version,
        expectedVersion: null,
        body: { title: 'x' },
      };
      const first = await send(w, request);
      problems.push(
        ...(await resaveProblems(w, request, first)).map((problem) => ({
          ...problem,
          detail: `${version ? '@V ' : ''}${problem.detail}`,
        })),
      );
    }
    expect(report(problems)).toEqual([]);
  });

  // -------------------------------------------------------------------------------------------------------
  // Review 8: legacy content first-class, strict no-ops, echoes through V, drafts mode, new locales, imports

  /** An entry stored as 0.8.2 stored it (or partly, or with IDs), published where the model has a draft. */
  const legacyEntry = async (
    data: Record<string, unknown>,
    mode: 'with' | 'partial' | 'all',
    french = false,
  ) => {
    const id = expectStatus(
      await w.admin.post(`/api/admin/content/${w.docKey}?locale=en`, { locale: 'en', data }),
      201,
    ).json<{ id: string }>().id;
    if (french) {
      expectStatus(
        await w.admin.put(`/api/admin/content/${w.docKey}/${id}?locale=fr`, {
          locale: 'fr',
          expectedVersion: null,
          data: { title: 'fr', lchips: [{ zv: 'f', zh: 'fz' }] },
        }),
        200,
      );
    }
    if (w.draftAndPublish) {
      expectStatus(
        await w.admin.post(`/api/admin/content/${w.docKey}/${id}/publish`, {
          locales: french ? ['en', 'fr'] : ['en'],
        }),
        200,
      );
    }
    await storeHeads(w, id, (head) => legacyOf(head.data, mode, 99));
    return id;
  };
  const SEED = {
    title: 't',
    cards: [{ heading: 'A', note: 'n1', chips: [{ zv: 'a', zh: 'z1' }] }, { heading: 'B' }],
    hero: { label: 'L', items: [{ zv: 'i' }] },
    lchips: [{ zv: 'l' }],
    zone: [{ __component: 'tag', label: 'T' }],
  };
  const bothModels = async (run: () => Promise<void>) => {
    for (const key of ['doc', 'ndoc'] as const) {
      useModel(w, key);
      try {
        await run();
      } finally {
        useModel(w, 'doc');
      }
    }
  };

  it('STALERETRY (8 concurrency, review 11): a stale write retried with the version its 409 named keeps the ids it read', async () => {
    const problems: Problem[] = [];
    for (const model of ['doc', 'ndoc'] as const) {
      useModel(w, model);
      try {
        for (const name of ['admin', 'adminToken', 'reader', 'pinned'] as const) {
          for (const list of STALE_LISTS) {
            for (const way of STALE_WAYS) {
              for (const publish of model === 'doc' ? [false, true] : [false]) {
                problems.push(
                  ...(await staleRetryProblems(w, w.callers[name], {
                    list,
                    way,
                    publish,
                    version: name === 'reader' && way === 'deleteItem',
                    legacy: way === 'adminNoIds' ? 'with' : 'all',
                  })),
                );
              }
            }
          }
        }
      } finally {
        useModel(w, 'doc');
      }
    }
    expect(report(problems)).toEqual([]);
  });

  it('TWINREORDER (9 no-op, review 11): reordering two identical shared items with their ids leaves other locales alone', async () => {
    const problems: Problem[] = [];
    for (const name of ['admin', 'adminToken', 'reader'] as const) {
      problems.push(...(await twinReorderProblems(w, w.callers[name])));
      problems.push(...(await twinReorderProblems(w, w.callers[name], true)));
    }
    expect(report(problems)).toEqual([]);
  });

  it('LOCCOPY (5 round trip, review 10): items copied between locales with the ids read are accepted for a caller that sees the draft', async () => {
    const problems: Problem[] = [];
    // The anonymous caller gets a read and update grant on docs for this case.
    const probe = await locCopyEntry(w, 'published', 'with');
    const { model_id: modelId } = await w.db
      .selectFrom('entries')
      .select('model_id')
      .where('id', '=', probe)
      .executeTakeFirstOrThrow();
    await setPublicGrants(w.db, [
      { action: 'read', modelId },
      { action: 'update', modelId },
    ]);
    try {
      for (const name of ['reader', 'anon', 'adminToken'] as const) {
        const caller = { ...w.callers[name], reads: true };
        for (const kind of ['published', 'frAhead'] as const) {
          for (const variant of ['toFr', 'toEn'] as const) {
            for (const version of [false, true]) {
              for (const legacy of ['all', 'with'] as const) {
                const id = await locCopyEntry(w, kind, legacy);
                problems.push(
                  ...(await locCopyProblems(w, caller, id, { kind, variant, version })).map((problem) => ({
                    ...problem,
                    detail: `${legacy}: ${problem.detail}`,
                  })),
                );
              }
            }
          }
        }
      }
    } finally {
      await w.publicGrants(false);
    }
    expect(report(problems)).toEqual([]);
  });

  it('ECHOAHEAD (5 round trip, review 9): an old client sends the whole read back with its ids while the draft is ahead of what it read', async () => {
    const problems: Problem[] = [];
    const echoers = ['admin', 'adminToken', 'reader', 'masked', 'owner', 'pinned', 'limited'] as const;
    for (const name of echoers) {
      const caller = w.callers[name];
      const draftCapable = caller.kind === 'adminToken' || caller.kind === 'pinned';
      for (const kind of AHEAD_KINDS) {
        for (const legacy of ['all', 'with'] as const) {
          for (const version of caller.kind === 'admin' ? [false] : [false, true]) {
            for (const view of draftCapable ? (['default', 'draft'] as const) : (['default'] as const)) {
              const ahead = await aheadEntry(w, kind, {
                legacy,
                ownerId: caller.ownOnly ? caller.userId : undefined,
              });
              problems.push(
                ...(
                  await echoAheadProblems(w, caller, ahead.id, { locale: ahead.locale, version, view, kind })
                ).map((problem) => ({ ...problem, detail: `${legacy}: ${problem.detail}` })),
              );
            }
          }
        }
      }
    }
    expect(report(problems)).toEqual([]);
  });

  it('LEGACYRESAVE (9 no-op): on entries stored before 0.9.0, partly, and after, a save that changes nothing changes nothing', async () => {
    // Review 8 (mine/legacyresave): `PUT {title: same}` and `PUT {}` on an entry stored by 0.8.2 wrote a revision,
    // bumped the version, fired events, and flipped published to modified, every time.
    const problems: Problem[] = [];
    await bothModels(async () => {
      for (const mode of ['all', 'partial', 'with'] as const) {
        for (const french of [false, true]) {
          for (const name of ['admin', 'adminToken', 'reader', 'updateOnly'] as const) {
            const caller = w.callers[name];
            const id = await legacyEntry(SEED, mode, french);
            const found = await noopProblems(w, prng(5), caller, id, {
              version: false,
              transport: caller.kind === 'admin' ? 'adminApi' : 'rest',
            });
            problems.push(
              ...found.map((problem) => ({
                ...problem,
                detail: `${w.docKey} ${mode}${french ? ' en+fr' : ''}: ${problem.detail}`,
              })),
            );
          }
        }
      }
    });
    expect(report(problems)).toEqual([]);
  });

  it('ECHO (10 echo through V, H1): fields made private, deprecated, removed, retyped, or added since V: an echo is accepted and a no-op; one field edited, accepted', async () => {
    // Review 8 (mine/echo): an old client sending back the entry it read through its version was refused.
    const problems: Problem[] = [];
    await bothModels(async () => {
      for (const mode of ['all', 'with'] as const) {
        for (const name of ['reader', 'masked', 'limited', 'adminToken', 'pinned'] as const) {
          const plan = planEntry(w, prng(3));
          const id = (
            await createEntry(
              w,
              { ...plan, legacy: mode, draftEdit: false, oldValues: 1, deletedTargets: 0 },
              42,
            )
          ).id;
          problems.push(
            ...(await echoThroughVersionProblems(w, w.callers[name], id)).map((problem) => ({
              ...problem,
              detail: `${w.docKey} ${mode}: ${problem.detail}`,
            })),
          );
        }
      }
    });
    expect(report(problems)).toEqual([]);
  });

  it('NEWLOC (M2): the first write to a locale, for a localized list, is accepted without IDs', async () => {
    // Review 8 (mine/newloc): a 0.8.2 client translating an entry into a new locale.
    const problems: Problem[] = [];
    await bothModels(async () => {
      for (const mode of ['all', 'with'] as const) {
        for (const data of [
          { title: 'fr' },
          { title: 'fr', lchips: [{ zv: 'fr-a' }] },
          { title: 'fr', lchips: [{ zv: 'fr-a' }, { zv: 'fr-b' }] },
        ]) {
          const id = await legacyEntry(SEED, mode);
          const response = await w.request(
            'PUT',
            `/api/content/${w.docPlural}/${id}?locale=fr`,
            w.callers.reader.token,
            { locale: 'fr', expectedVersion: null, data },
          );
          if (response.status >= 300) {
            problems.push({
              property: 'M2 new locale',
              detail: `${w.docKey} ${mode} ${JSON.stringify(data)}: ${response.status} ${outcomeOf(response).code} ${outcomeOf(response).issues.join(' ')}`,
            });
          }
        }
      }
    });
    expect(report(problems)).toEqual([]);
  });

  it('DRAFTMODE (M1): a caller that reads drafts on the delivery route is shown draft targets and can remove them', async () => {
    // Review 8 (rel/kinds): an admin token on the delivery route with ?publicationState=draft.
    const problems: Problem[] = [];
    for (const mode of ['all', 'with'] as const) {
      const id = await legacyEntry(
        {
          title: 't',
          refs: [w.things.published, w.things.draft],
          ref: w.things.draft,
          cards: [{ heading: 'a', note: 'n', rels: [w.things.draft, w.things.published] }],
        },
        mode,
      );
      const read = (await w.request('GET', `/api/content/docs/${id}?publicationState=draft`, w.adminToken))
        .body as { data?: Record<string, unknown> };
      const flat = (value: unknown) =>
        Array.isArray(value)
          ? value.map((entry) => (typeof entry === 'string' ? entry : (entry as { id: string }).id))
          : value && typeof value === 'object'
            ? (value as { id: string }).id
            : value;
      const shown = JSON.stringify(read.data ?? {});
      if (!shown.includes(w.things.draft)) {
        problems.push({
          property: 'M1 drafts mode',
          detail: `${mode}: a drafts-mode read does not show the draft target`,
        });
        continue;
      }
      const cards = (read.data?.cards as Array<Record<string, unknown>>).map((card) => ({
        id: card.id,
        heading: card.heading,
        rels: (flat(card.rels) as string[]).filter((target) => target !== w.things.draft),
      }));
      const version = (await headsOf(w, id)).find((head) => head.state === 'draft')?.version ?? null;
      const response = await w.request(
        'PUT',
        `/api/content/docs/${id}?publicationState=draft`,
        w.adminToken,
        {
          expectedVersion: version,
          data: {
            refs: (flat(read.data?.refs) as string[]).filter((target) => target !== w.things.draft),
            ref: null,
            cards,
          },
        },
      );
      const stored = JSON.stringify(
        (await headsOf(w, id)).find((head) => head.state === 'draft')?.data ?? {},
      );
      if (response.status >= 300 || stored.includes(w.things.draft)) {
        problems.push({
          property: 'M1 drafts mode',
          detail: `${mode}: removing the draft targets answered ${response.status}; still stored: ${stored.includes(w.things.draft)}`,
        });
      }
    }
    expect(report(problems)).toEqual([]);
  });

  it('CR (4 order and status): a GraphQL document over the token limit is QUERY_TOO_LARGE, after any comment', async () => {
    // Review 8 (mine/cr): a comment ended by a bare CR hid the depth from the check.
    const problems: Problem[] = [];
    for (const prefix of ['', '#c\n', '#c\r', '#c\r\n']) {
      const query = `${prefix}${'{a'.repeat(3000)}${'}'.repeat(3000)}`;
      const response = await w.request('POST', '/api/graphql', null, { query });
      if (response.status !== 400 || outcomeOf(response).code !== 'QUERY_TOO_DEEP') {
        problems.push({
          property: '4 order and status',
          detail: `prefix ${JSON.stringify(prefix)}: ${response.status} ${response.raw.slice(0, 120)}`,
        });
      }
    }
    expect(report(problems)).toEqual([]);
  });

  it('DEEP (4 order and status): a deep value stored before 0.9.0 reads, lists, exports, and re-saves without a 5xx', async () => {
    // Review 8 (compat/deep2), with a JSON value standing in for deep rich text: 36 levels stored raw.
    const deep = (depth: number): unknown =>
      depth <= 1 ? 1 : depth % 2 ? [deep(depth - 1)] : { a: deep(depth - 1) };
    const problems: Problem[] = [];
    const id = await legacyEntry({ title: 't', cards: [{ heading: 'A' }] }, 'all');
    await storeHeads(w, id, (head) => ({
      ...head.data,
      [w.doc.cards]: (head.data[w.doc.cards] as Array<Record<string, unknown>>).map((card) => ({
        ...card,
        [w.card.data]: deep(36),
      })),
    }));
    const read = (await w.request('GET', `/api/admin/content/doc/${id}`, w.adminToken)).body as {
      version?: number;
      data?: Record<string, unknown>;
    };
    for (const [route, response] of [
      ['delivery read', await w.request('GET', `/api/content/docs/${id}`, w.callers.reader.token)],
      ['delivery list', await w.request('GET', '/api/content/docs?pageSize=100', w.callers.reader.token)],
      ['admin read', await w.request('GET', `/api/admin/content/doc/${id}`, w.adminToken)],
      ['export', await w.request('GET', '/api/admin/transfer/export', w.adminToken)],
      [
        'admin re-save as read',
        await w.request('PUT', `/api/admin/content/doc/${id}`, w.adminToken, {
          expectedVersion: read.version,
          data: { cards: read.data?.cards },
        }),
      ],
    ] as const) {
      if (response.status >= 500) {
        problems.push({
          property: '4 order and status',
          detail: `${route}: ${response.status} ${response.raw.slice(0, 120)}`,
        });
      }
    }
    expect(report(problems)).toEqual([]);
  });

  it("IMPORTS (3 ID integrity): crafted bundles (repeated, moved, odd IDs; a stored ID equal to a legacy item's derived one; a shared ID reused in a localized list) never leave one ID on two items", async () => {
    // Review 8 (dup/imp1, dup/imp2, dup/loc2).
    const problems: Problem[] = [];
    const cardsOf = (data: Record<string, unknown>) => data[w.doc.cards] as Array<Record<string, unknown>>;
    const edits: Array<
      [string, (data: Record<string, unknown>, head: { locale: string }) => Record<string, unknown>]
    > = [
      [
        'repeated ID',
        (data) => ({
          ...data,
          [w.doc.cards]: cardsOf(data).map((card, _index, all) => ({ ...card, __id: all[0]?.__id })),
        }),
      ],
      [
        'ID moved to the zone',
        (data) => ({
          ...data,
          [w.doc.zone]: [
            { __component: w.components.tag.definition.id, __id: cardsOf(data)[0]?.__id, [w.tag.label]: 'Z' },
          ],
        }),
      ],
      [
        'odd IDs',
        (data) => ({
          ...data,
          [w.doc.cards]: cardsOf(data).map((card, index) => ({
            ...card,
            __id: [5, '', 'x'.repeat(80)][index % 3],
          })),
        }),
      ],
      [
        'id key instead of __id',
        (data) => ({
          ...data,
          [w.doc.cards]: cardsOf(data).map((card) => ({ ...card, id: 'imported-id1' })),
        }),
      ],
    ];
    for (const [label, edit] of edits) {
      const id = await legacyEntry(
        {
          title: 't',
          cards: [
            { heading: 'A', note: 'n1' },
            { heading: 'B', note: 'n2' },
          ],
        },
        'with',
      );
      const result = await importBundle(w, craftBundle(await exportBundle(w), id, edit));
      // Decision (h): a bad or repeated `__id` makes the bundle 400 BUNDLE_INVALID; others import. The ID moved
      // to the zone stays on its card too, so it is repeated.
      const mustRefuse = label === 'repeated ID' || label === 'odd IDs' || label === 'ID moved to the zone';
      if (mustRefuse) {
        if (!/^refused 400 .*BUNDLE_INVALID/.test(result)) {
          problems.push({
            property: '3 ID integrity',
            detail: `${label}: import answered ${result.slice(0, 160)}, not 400 BUNDLE_INVALID`,
          });
        }
        continue;
      }
      const other = /Entry ([0-9a-f-]{36}):/.exec(result)?.[1];
      if (!result.startsWith('succeeded') && other && other !== id) {
        // Another stored entry already holds a repeated item ID: a property-3 finding of its own.
        const heads = await headsOf(w, other);
        problems.push({
          property: '3 ID integrity',
          detail: `${label}: the bundle was refused for another entry ${other}, which stores a repeated item ID: ${JSON.stringify(heads.map((head) => [head.locale, head.state, head.data])).slice(0, 1500)}`,
        });
        continue;
      }
      if (!result.startsWith('succeeded')) {
        problems.push({
          property: '3 ID integrity',
          detail: `${label}: import answered ${result.slice(0, 400)}`,
        });
        continue;
      }
      problems.push(
        ...idUniqueness(await headsOf(w, id)).map((problem) => ({
          ...problem,
          detail: `${label}: ${problem.detail}`,
        })),
      );
      const read = (await w.request('GET', `/api/content/docs/${id}`, w.callers.reader.token)).body as {
        data?: { cards?: Array<{ id: string }>; zone?: Array<{ id: string }> };
      };
      const ids = [...(read.data?.cards ?? []), ...(read.data?.zone ?? [])].map((item) => item.id);
      if (new Set(ids).size !== ids.length) {
        problems.push({
          property: '3 ID integrity',
          detail: `${label}: a read shows one ID on two items: ${ids.join(',')}`,
        });
      }
    }
    // A stored ID equal to the derived ID of a legacy item in the same list.
    const legacy = await legacyEntry(
      {
        title: 't',
        cards: [
          { heading: 'A', note: 'n1' },
          { heading: 'B', note: 'n2' },
        ],
      },
      'all',
    );
    const derived = (
      (await w.request('GET', `/api/admin/content/doc/${legacy}`, w.adminToken)).body as {
        data: { cards: Array<{ id: string }> };
      }
    ).data.cards[0]?.id;
    const result = await importBundle(
      w,
      craftBundle(await exportBundle(w), legacy, (data) => ({
        ...data,
        [w.doc.cards]: cardsOf(data).map((card, index) => (index === 1 ? { ...card, __id: derived } : card)),
      })),
    );
    if (result.startsWith('succeeded')) {
      const read = (await w.request('GET', `/api/content/docs/${legacy}`, w.callers.reader.token)).body as {
        data?: { cards?: Array<{ id: string }> };
      };
      const ids = (read.data?.cards ?? []).map((item) => item.id);
      if (new Set(ids).size !== ids.length) {
        problems.push({
          property: '3 ID integrity',
          detail: `stored ID = a legacy item's derived ID: a read shows ${ids.join(',')}`,
        });
      }
    }
    expect(report(problems)).toEqual([]);
  });

  it('N5 (pinned delivery token): what a token of a delivery role pinned to V answers to a write', async () => {
    const role = await createRole(w.db, 'delivery', [
      { action: 'read', modelId: w.models.doc.definition.id },
      { action: 'update', modelId: w.models.doc.definition.id },
    ]);
    const created = await w.request('POST', '/api/admin/tokens', w.adminToken, {
      name: 'pinned delivery',
      roleId: role,
      pinnedSchemaVersion: w.versionNumber,
    });
    const token = (created.body as { token?: string }).token;
    const id = await adminCreate({ title: 't', cards: [{ heading: 'A', note: 'n1' }] });
    const response = token
      ? await w.request('PUT', `/api/content/docs/${id}`, token, { expectedVersion: 1, data: { title: 'x' } })
      : null;
    // Recorded, not asserted: whether a delivery-kind token can write at all.
    expect([created.status, response?.status ?? null, response ? outcomeOf(response).code : null]).toEqual(
      expect.any(Array),
    );
    writeFileSync(
      `${process.env.ITEM_MODEL_NOTES ?? '/dev/null'}`,
      JSON.stringify({
        tokenCreated: created.status,
        write: response?.status,
        code: response ? outcomeOf(response).code : null,
      }),
    );
  });

  it('out-order (4 order and status): the order of refusals is the same with and without a version', async () => {
    const problems: Problem[] = [];
    const parts: Record<string, Record<string, unknown>> = {
      SG: { bogus: 1, title: 'forbidden for limited' },
      FV: { hero: { label: 'H', items: [{ zv: 'i', zh: 'hack' }] } },
      FVI: {
        hero: { label: 'H', items: [{ zv: 'i', zh: 'hack' }] },
        cards: [{ heading: 'A2' }, { heading: 'B' }],
      },
    };
    for (const [name, data] of Object.entries(parts)) {
      const id = await adminCreate({
        title: 't',
        cards: [
          { heading: 'A', note: 'nA' },
          { heading: 'B', note: 'nB' },
        ],
        hero: { label: 'H', items: [{ zv: 'i', zh: 'z' }] },
      });
      const stale = name.includes('V');
      const answers = [];
      for (const version of [false, true]) {
        const heads = await headsOf(w, id);
        const draft = heads.find((head) => head.locale === 'en' && head.state === 'draft');
        const response = await send(w, {
          caller: w.callers.limited,
          transport: 'rest',
          entryId: id,
          locale: 'en',
          version,
          expectedVersion: (draft?.version ?? 1) + (stale ? 7 : 0),
          body: data,
        });
        answers.push(`${response.status} ${outcomeOf(response).code}`);
      }
      if (answers[0] !== answers[1]) {
        problems.push({
          property: '4 order and status',
          detail: `${name}: today ${String(answers[0])}, through V ${String(answers[1])}`,
        });
      }
    }
    expect(report(problems)).toEqual([]);
  });
});

let suffix = 0;
const seedSuffix = () =>
  `${Date.now().toString(36).replace(/[0-9]/g, '')}x${'abcdefghij'[(suffix += 1) % 10]}`;
