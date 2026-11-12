import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { expectStatus } from './content.js';
import {
  answerShape,
  differences,
  instancesOf,
  outcomeOf,
  readAs,
  refusedForMissingTarget,
  send,
  storedView,
  type Problem,
  type Random,
  type Transport,
  targetsOnlyChanged,
} from './itemModelRun.js';
import {
  eventCount,
  headsOf,
  revisionCount,
  setHeadData,
  type Caller,
  type World,
} from './itemModelWorld.js';

/**
 * Review 7 probes for the model-based item-write fuzz: relation candidates (N1), identical re-saves (N2), and
 * the helpers of the fixed cases for round trips through a version, GraphQL literals, and copies (N3 to N5).
 */

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const listOf = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isRecord) : []);

// ---------------------------------------------------------------------------------------------------------
// N1: relation candidates

/** A candidate relation target and what is true of it. */
type Candidate = {
  label: string;
  id: string;
  /** Its content type: a thing, a plain entry, or no entry at all. */
  kind: 'thing' | 'plain' | 'none';
  /** A delivery caller that may read things and plains sees it (published, not deleted). */
  shown: boolean;
};

/** Where a relation sits: its API path, whether it is in a card item, its target, single or many. */
type Position = { name: string; inCard: boolean; key: string; any: boolean; many: boolean };

export const POSITIONS: readonly Position[] = [
  { name: 'ref', inCard: false, key: 'ref', any: false, many: false },
  { name: 'refs', inCard: false, key: 'refs', any: true, many: true },
  { name: 'cards[].rel', inCard: true, key: 'rel', any: false, many: false },
  { name: 'cards[].rels', inCard: true, key: 'rels', any: false, many: true },
  { name: 'cards[].anyRels', inCard: true, key: 'anyRels', any: true, many: true },
];

const thingOf = async (w: World, name: string, publish: boolean) => {
  const id = expectStatus(await w.admin.post('/api/admin/content/thing', { data: { name } }), 201).json<{
    id: string;
  }>().id;
  if (publish) {
    expectStatus(await w.admin.post(`/api/admin/content/thing/${id}/publish`, {}), 200);
  }
  return id;
};

const plainOf = async (w: World) => {
  const id = expectStatus(
    await w.admin.post('/api/admin/content/plain', { data: { title: 'p' } }),
    201,
  ).json<{
    id: string;
  }>().id;
  expectStatus(await w.admin.post(`/api/admin/content/plain/${id}/publish`, {}), 200);
  return id;
};

/** A doc whose hidden places (a private top-level relation, a private relation in a card) hold `hidden`. */
const docHolding = async (w: World, hidden: string) => {
  const id = expectStatus(
    await w.admin.post(`/api/admin/content/${w.docKey}?locale=en`, {
      locale: 'en',
      data: {
        title: 't',
        secretRef: hidden,
        cards: [{ heading: 'A', note: 'n', secretRel: hidden }],
      },
    }),
    201,
  ).json<{ id: string }>().id;
  if (w.draftAndPublish) {
    expectStatus(
      await w.admin.post(`/api/admin/content/${w.docKey}/${id}/publish`, { locales: ['en'] }),
      200,
    );
  }
  return id;
};

/** The body that puts `target` at `position`, from what the caller read (IDs echoed). */
const bodyFor = (read: Json | null, position: Position, target: string): Json => {
  const value = position.many ? [target] : target;
  if (!position.inCard) {
    return { [position.key]: value };
  }
  const cards = listOf(read?.cards).map((card) => ({ id: card.id, heading: card.heading }));
  return { cards: [...cards, { id: null, heading: 'P', [position.key]: value }] };
};

/** Every relation target stored in a doc's draft, by position (`ref`, `cards/<id>/rel`, ...). */
const storedTargets = (w: World, data: Json | undefined): Map<string, string[]> => {
  const targets = new Map<string, string[]>();
  const add = (where: string, value: unknown) => {
    const ids = (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]).map(
      String,
    );
    if (ids.length > 0) {
      targets.set(where, ids);
    }
  };
  if (!data) {
    return targets;
  }
  add('ref', data[w.doc.ref]);
  add('refs', data[w.doc.refs]);
  listOf(data[w.doc.cards]).forEach((card) => {
    const id = typeof card.__id === 'string' ? card.__id : '?';
    add(`cards/${id}/rel`, card[w.card.rel]);
    add(`cards/${id}/rels`, card[w.card.rels]);
    add(`cards/${id}/anyRels`, card[w.card.anyRels]);
  });
  return targets;
};

/**
 * N1: a relation candidate never tells the caller what hidden places hold (twins), an accepted write never
 * stores a target of the wrong type or one the caller cannot see and was not shown, and the entry can still
 * be published.
 */
export const relationProbeProblems = async (
  w: World,
  random: Random,
  caller: Caller,
  version: boolean,
  transport: Transport = 'rest',
  fixed?: { candidate: string; position: string },
): Promise<Problem[]> => {
  const problems: Problem[] = [];
  const hidden = await thingOf(w, 'hidden', false);
  const other = await thingOf(w, 'other', false);
  const candidates: Candidate[] = [
    { label: 'shown', id: w.things.published, kind: 'thing', shown: true },
    { label: 'unpublished', id: w.things.draft, kind: 'thing', shown: false },
    { label: 'deleted', id: w.things.deleted, kind: 'none', shown: false },
    { label: 'wrongType', id: await plainOf(w), kind: 'plain', shown: true },
    { label: 'heldHere', id: hidden, kind: 'thing', shown: false },
    { label: 'nowhere', id: randomUUID(), kind: 'none', shown: false },
  ];
  const candidate = fixed
    ? (candidates.find((entry) => entry.label === fixed.candidate) as Candidate)
    : random.pick(candidates);
  const position = fixed
    ? (POSITIONS.find((entry) => entry.name === fixed.position) as Position)
    : random.pick(POSITIONS);
  const adminKind = caller.kind === 'admin' || caller.kind === 'adminToken' || caller.kind === 'pinned';
  // Twins: the same doc, whose hidden places hold the candidate (A) or another unpublished thing (B).
  const a = await docHolding(w, hidden);
  const b = await docHolding(w, other);
  // B takes A's item IDs, so the same body names the same items.
  const [headA] = (await headsOf(w, a)).filter((head) => head.state === 'draft');
  for (const head of await headsOf(w, b)) {
    const cards = listOf(head.data[w.doc.cards]).map((card, index) => ({
      ...card,
      __id: listOf(headA?.data[w.doc.cards])[index]?.__id ?? card.__id,
    }));
    await setHeadData(w, b, head.locale, head.state, { ...head.data, [w.doc.cards]: cards });
  }
  const read = caller.reads ? await readAs(w, caller, a, 'en', version) : null;
  const body = bodyFor(read, position, candidate.id);
  const before = await storedView(w, a, 'en');
  const known = new Set(instancesOf(w, before.draft?.data, before.admin).map((instance) => instance.id));
  const versionOf = async (id: string) =>
    (await headsOf(w, id)).find((head) => head.locale === 'en' && head.state === 'draft')?.version ?? null;
  const responseA = await send(w, {
    caller,
    transport,
    entryId: a,
    locale: 'en',
    version,
    expectedVersion: await versionOf(a),
    body,
  });
  const responseB = await send(w, {
    caller,
    transport,
    entryId: b,
    locale: 'en',
    version,
    expectedVersion: await versionOf(b),
    body,
  });
  const label = `${caller.name}${version ? '@V' : ''} ${transport} ${position.name} ← ${candidate.label}`;
  // Twins differ in hidden places only (the candidate is held in A's, another unpublished thing in B's).
  if (!adminKind) {
    const [shapeA, shapeB] = [answerShape(responseA, known), answerShape(responseB, known)];
    if (!isDeepStrictEqual(shapeA, shapeB)) {
      problems.push({
        property: '2 no oracle (N1)',
        detail: `${label}: ${JSON.stringify(shapeA)} vs ${JSON.stringify(shapeB)}`,
      });
    }
  }
  if (responseA.status >= 500) {
    problems.push({
      property: '4 order and status',
      detail: `${label}: ${responseA.status} ${responseA.raw.slice(0, 160)}`,
    });
  }
  // Parity with main for a value the body names: an unpublished entry of the right type is accepted; a deleted
  // entry, one of the wrong type, and an ID with no entry are 422 RELATION_TARGET_MISSING.
  const wrongTarget = candidate.kind === 'none' || (!position.any && candidate.kind !== 'thing');
  const outcome = outcomeOf(responseA);
  if (wrongTarget && responseA.status < 400) {
    problems.push({
      property: '4 order and status (N1)',
      detail: `${label}: accepted (${responseA.status})`,
    });
  }
  if (
    wrongTarget &&
    outcome.status === 422 &&
    !outcome.issues.some((issue) => issue.startsWith('RELATION_TARGET_MISSING'))
  ) {
    problems.push({
      property: '4 order and status (N1)',
      detail: `${label}: 422 without RELATION_TARGET_MISSING: ${outcome.issues.join(' ')}`,
    });
  }
  if (
    !wrongTarget &&
    candidate.kind === 'thing' &&
    caller.kind !== 'anon' &&
    caller.reads &&
    responseA.status === 422
  ) {
    problems.push({
      property: '4 order and status (N1)',
      detail: `${label}: a ${candidate.label} target of the right type refused: ${outcome.code} ${outcome.issues.join(' ')}`,
    });
  }
  if (!outcome.accepted) {
    return problems;
  }
  // What was stored: a new target the body named is an entry of the right type.
  const after = await storedView(w, a, 'en');
  const was = storedTargets(w, before.draft?.data);
  const now = storedTargets(w, after.draft?.data);
  const anyTarget = (where: string) => where === 'refs' || where.endsWith('/anyRels');
  for (const [where, ids] of now) {
    for (const id of ids) {
      if ((was.get(where) ?? []).includes(id)) {
        continue;
      }
      const known2 = candidates.find((entry) => entry.id === id);
      if (!known2) {
        continue;
      }
      const wrongType = known2.kind === 'none' || (!anyTarget(where) && known2.kind !== 'thing');
      if (wrongType) {
        problems.push({
          property: '1 conservation (N1)',
          detail: `${label}: stored ${known2.label} (${known2.kind}) at ${where}`,
        });
      }
    }
  }
  // The entry can still be published (a model without drafts publishes on every save).
  const published = w.draftAndPublish
    ? await w.admin.post(`/api/admin/content/${w.docKey}/${a}/publish`, { locales: ['en'] })
    : null;
  if (published && published.statusCode >= 300) {
    problems.push({
      property: '4 order and status (N1)',
      detail: `${label}: accepted, then the admin cannot publish: ${published.statusCode} ${published.body.slice(0, 200)}`,
    });
  }
  return problems;
};

// ---------------------------------------------------------------------------------------------------------
// N2: identical re-save

/** The version a write response names (REST, the admin API, GraphQL). */
export const versionOfResponse = (body: unknown): number | null => {
  if (!isRecord(body)) {
    return null;
  }
  if (typeof body.version === 'number') {
    return body.version;
  }
  const data = isRecord(body.data) ? body.data : null;
  if (data && typeof data.version === 'number') {
    return data.version;
  }
  for (const value of Object.values(data ?? {})) {
    if (isRecord(value) && typeof value.version === 'number') {
      return value.version;
    }
  }
  return null;
};

/**
 * N2: after an accepted write, the very same body sent again (with the version the first write answered) is a
 * no-op: 2xx, the same version, no revision, no event, the stored heads unchanged.
 */
export const resaveProblems = async (
  w: World,
  request: Parameters<typeof send>[1] & { entryId: string },
  first: { status: number; body: unknown },
): Promise<Problem[]> => {
  const version = versionOfResponse(first.body);
  if (version === null) {
    return [];
  }
  const heads = await headsOf(w, request.entryId);
  const [revisions, events] = [await revisionCount(w, request.entryId), await eventCount(w, request.entryId)];
  const again = await send(w, { ...request, expectedVersion: version });
  const label = `${request.caller.name}${request.version ? '@V' : ''} ${request.transport}`;
  // By design: a delivery reader whose draft is now ahead of what it reads re-sending a no-ID list that can hold
  // hidden values is 422 AMBIGUOUS_ITEMS; the first write's `itemIds`, sent back, are accepted.
  const againOutcome = outcomeOf(again);
  if (
    !againOutcome.accepted &&
    againOutcome.issues.length > 0 &&
    againOutcome.issues.every((issue) => issue.startsWith('AMBIGUOUS_ITEMS'))
  ) {
    if (request.transport === 'graphql') {
      return []; // The mutation here selects no itemIds; the 422 is the documented answer.
    }
    const tree = isRecord(first.body) && isRecord(first.body.data) ? first.body.data.itemIds : undefined;
    if (!isRecord(tree)) {
      return [
        {
          property: '5 round trip (N2)',
          detail: `${label}: the re-save is ambiguous, and the first write named no itemIds`,
        },
      ];
    }
    // Through a version, fields read-only there are left out (an echoed null for one is refused while the entry
    // has unpublished changes, by design: "leave it out to keep the stored value").
    const readOnly = request.version ? ['count', 'ratio', 'old'] : [];
    const strip = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(strip)
        : isRecord(value)
          ? Object.fromEntries(
              Object.entries(value)
                .filter(([key]) => !readOnly.includes(key))
                .map(([key, entry]) => [key, strip(entry)]),
            )
          : value;
    const withIds = strip(withTreeIds(request.body, tree)) as Json;
    const third = await send(w, { ...request, body: withIds, expectedVersion: version });
    return third.status < 300
      ? []
      : [
          {
            property: '5 round trip (N2)',
            detail: `${label}: sending the first write's itemIds back answered ${third.status} ${third.raw.slice(0, 700)}; body ${JSON.stringify(withIds).slice(0, 500)}`,
          },
        ];
  }
  // Documented (schema-lenses.md:318): through a version, a component field the caller cannot write is refused
  // NOT_ALLOWED "while the entry has unpublished changes"; left out it keeps its stored value. So a re-save that
  // sends one is refused, and the same body without those fields is then the no-op.
  if (
    request.version &&
    againOutcome.code === 'LENS_WRITE_UNSUPPORTED' &&
    againOutcome.issues.length > 0 &&
    againOutcome.issues.every((issue) => /^NOT_ALLOWED \S*\/(count|ratio|old)$/.test(issue))
  ) {
    const withoutReadOnly = stripKeys(request.body, ['count', 'ratio', 'old']) as Json;
    const resent = await send(w, { ...request, body: withoutReadOnly, expectedVersion: version });
    const after2 = await headsOf(w, request.entryId);
    const [revisions2, events2] = [
      await revisionCount(w, request.entryId),
      await eventCount(w, request.entryId),
    ];
    return resent.status < 300 &&
      versionOfResponse(resent.body) === version &&
      isDeepStrictEqual(
        after2.map((head) => head.data),
        heads.map((head) => head.data),
      ) &&
      revisions2 === revisions &&
      events2 === events
      ? []
      : [
          {
            property: '5 round trip (N2)',
            detail: `${label}: the same body without the fields read-only through V answered ${resent.status} v${String(versionOfResponse(resent.body))}, revisions ${revisions} → ${revisions2}, events ${events} → ${events2}`,
          },
        ];
  }
  if (refusedForMissingTarget(again)) {
    return []; // decision (c): the body names a target that no longer exists; refused as on main
  }
  if (again.status >= 300 || !againOutcome.accepted) {
    return [
      {
        property: '5 round trip (N2)',
        detail: `${label}: the same body again answered ${again.status} ${again.raw.slice(0, 200)}`,
      },
    ];
  }
  const problems: Problem[] = [];
  const after = await headsOf(w, request.entryId);
  if (process.env.ITEM_MODEL_DEBUG) {
    writeFileSync(
      `${process.env.ITEM_MODEL_DEBUG}.resave`,
      JSON.stringify(
        {
          request: { ...request, caller: request.caller.name },
          first: first.body,
          again: again.raw,
          heads,
          after,
        },
        null,
        1,
      ),
    );
  }
  const changed = after.filter(
    (head) =>
      !isDeepStrictEqual(
        head.data,
        heads.find((old) => old.locale === head.locale && old.state === head.state)?.data,
      ),
  );
  if (changed.length > 0) {
    const old = heads.find(
      (head) => head.locale === changed[0]?.locale && head.state === changed[0]?.state,
    )?.data;
    problems.push({
      property: '5 round trip (N2)',
      detail: `${label}: the same body again changed ${changed.map((head) => `${head.locale}/${head.state}`).join(',')}: ${differences(old, changed[0]?.data).slice(0, 3).join('; ')}`,
    });
  }
  // Items stored without an ID (legacy) before the re-save: the LEGACYLOC class.
  const legacy = heads.some((head) => {
    const walk = (value: unknown, inList: boolean): boolean =>
      Array.isArray(value)
        ? value.some((item) => walk(item, true))
        : isRecord(value)
          ? (inList && !('__id' in value)) || Object.values(value).some((entry) => walk(entry, false))
          : false;
    return Object.values(head.data).some((value) => walk(value, false));
  });
  const legacyNote = legacy ? ' (legacy items stored)' : '';
  if (versionOfResponse(again.body) !== null && versionOfResponse(again.body) !== version) {
    problems.push({
      property: '5 round trip (N2)',
      detail: `${label}: the same body again bumped the version ${version} → ${String(versionOfResponse(again.body))}${legacyNote}`,
    });
  }
  if ((await revisionCount(w, request.entryId)) !== revisions) {
    problems.push({ property: '5 round trip (N2)', detail: `${label}: the same body again made a revision` });
  }
  if ((await eventCount(w, request.entryId)) !== events) {
    problems.push({ property: '5 round trip (N2)', detail: `${label}: the same body again fired an event` });
  }
  return problems;
};

// ---------------------------------------------------------------------------------------------------------
// N4: GraphQL literals

/** A JSON value as a GraphQL input literal (object keys bare, strings quoted). */
export const graphqlLiteral = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(graphqlLiteral).join(', ')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .map(([key, entry]) => `${key}: ${graphqlLiteral(entry)}`)
      .join(', ')}}`;
  }
  return value === undefined ? 'null' : JSON.stringify(value);
};

/** `depth` nested objects ({ a: { a: ... } }). */
export const nested = (depth: number): unknown => (depth <= 0 ? 'leaf' : { a: nested(depth - 1) });

export const CANDIDATE_LABELS = [
  'shown',
  'unpublished',
  'deleted',
  'wrongType',
  'heldHere',
  'nowhere',
] as const;

/** `body` with every item's `id` taken, place by place, from a write response's item ID tree. */
export const withTreeIds = (body: unknown, tree: unknown): unknown => {
  if (Array.isArray(body)) {
    return body.map((item: unknown, index) =>
      withTreeIds(item, Array.isArray(tree) ? (tree as unknown[])[index] : undefined),
    );
  }
  if (!isRecord(body)) {
    return body;
  }
  const node = isRecord(tree) ? tree : {};
  const output: Json = {};
  for (const [key, value] of Object.entries(body)) {
    output[key] =
      key === 'id' ? value : Array.isArray(value) || isRecord(value) ? withTreeIds(value, node[key]) : value;
  }
  if (typeof node.id === 'string') {
    output.id = node.id;
  }
  return output;
};

/** `value` without the given keys, at any depth. */
export const stripKeys = (value: unknown, keys: readonly string[]): unknown =>
  Array.isArray(value)
    ? value.map((item) => stripKeys(item, keys))
    : isRecord(value)
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => !keys.includes(key))
            .map(([key, entry]) => [key, stripKeys(entry, keys)]),
        )
      : value;

// ---------------------------------------------------------------------------------------------------------
// No-op writes (review 8): a body that changes no content changes nothing

/** What a no-op must leave alone: stored heads, version, revisions, events, and the admin's publish status. */
export const entryState = async (w: World, entryId: string) => {
  const heads = await headsOf(w, entryId);
  const view = await w.request('GET', `/api/admin/content/${w.docKey}/${entryId}?locale=en`, w.adminToken);
  const body = isRecord(view.body) ? view.body : {};
  return {
    heads: heads.map((head) => [head.locale, head.state, head.version, head.data]),
    revisions: await revisionCount(w, entryId),
    events: await eventCount(w, entryId),
    status: body.status,
    locales: body.locales,
  };
};

export type NoopBody = 'empty' | 'sameScalar' | 'readWithIds' | 'readWithoutIds' | 'subset';
export const NOOP_BODIES: readonly NoopBody[] = [
  'empty',
  'sameScalar',
  'readWithIds',
  'readWithoutIds',
  'subset',
];

/**
 * A body that changes no content, of one kind, from what the caller read (`read`, today's or V's shape) and what
 * is stored (`title`): empty; a scalar sent with its stored value; the components as read, with or without
 * their IDs; a random subset of the fields read.
 */
export const noopBody = (kind: NoopBody, read: Json | null, title: unknown, random: Random): Json => {
  const meta = new Set([
    'id',
    '__model',
    '__kinds',
    'locale',
    'createdAt',
    'updatedAt',
    'publishedAt',
    'version',
    'status',
    'itemIds',
  ]);
  const fields = read ? Object.fromEntries(Object.entries(read).filter(([key]) => !meta.has(key))) : {};
  const media = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(media)
      : isRecord(value)
        ? typeof value.id === 'string' && typeof value.mimeType === 'string'
          ? value.id
          : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, media(entry)]))
        : value;
  switch (kind) {
    case 'empty':
      return {};
    case 'sameScalar':
      return { title };
    case 'readWithIds':
      return media(
        Object.fromEntries(
          Object.entries(fields).filter(([, value]) => typeof value === 'object' && value !== null),
        ),
      ) as Json;
    case 'readWithoutIds':
      return stripKeys(
        media(
          Object.fromEntries(
            Object.entries(fields).filter(([, value]) => typeof value === 'object' && value !== null),
          ),
        ),
        ['id'],
      ) as Json;
    case 'subset':
      return media(Object.fromEntries(Object.entries(fields).filter(() => random.chance(0.5)))) as Json;
    default:
      return {};
  }
};

/**
 * No-op (strict, review 8): every no-op body, on this entry, by this caller and route: nothing about the entry
 * changes (heads, version, revisions, events, status), whether the write is accepted or refused.
 */
export const noopProblems = async (
  w: World,
  random: Random,
  caller: Caller,
  entryId: string,
  { version, transport }: { version: boolean; transport: Transport },
): Promise<Problem[]> => {
  const problems: Problem[] = [];
  const read = caller.reads ? await readAs(w, caller, entryId, 'en', version) : null;
  const admin = await readAs(w, w.callers.admin, entryId, 'en', false);
  for (const kind of NOOP_BODIES) {
    if ((kind === 'readWithIds' || kind === 'readWithoutIds' || kind === 'subset') && !read) {
      continue; // nothing read to send back
    }
    const before = await entryState(w, entryId);
    const body = noopBody(kind, read, admin?.title, random);
    const draft = before.heads.find((head) => head[0] === 'en' && head[1] === 'draft');
    if (process.env.ITEM_MODEL_DEBUG) {
      writeFileSync(
        `${process.env.ITEM_MODEL_DEBUG}.noop-${kind}`,
        JSON.stringify({ caller: caller.name, version, transport, read, body, heads: before.heads }, null, 1),
      );
    }
    const response = await send(w, {
      caller,
      transport,
      entryId,
      locale: 'en',
      version,
      expectedVersion: (draft?.[2] as number | undefined) ?? null,
      body,
    });
    const after = await entryState(w, entryId);
    // Decision (a): a caller that may read drafts is treated as shown every draft relation target and media, so
    // echoing a published read drops the draft-only targets it hid (as on main). That is a real change: the
    // write may make a revision, fire an event, move the status and store the items' IDs with it. Only the
    // targets (and stored `__id`s) may differ.
    const adminKind = caller.kind === 'adminToken' || caller.kind === 'pinned';
    const relationsOnly =
      adminKind &&
      kind !== 'empty' &&
      kind !== 'sameScalar' &&
      targetsOnlyChanged(
        w,
        before.heads.map((head) => head[3]),
        after.heads.map((head) => head[3]),
      );
    if (!isDeepStrictEqual(after, before) && !relationsOnly && !refusedForMissingTarget(response)) {
      const changed = [
        ...(after.revisions !== before.revisions
          ? [`revisions ${before.revisions} → ${after.revisions}`]
          : []),
        ...(after.events !== before.events ? [`events ${before.events} → ${after.events}`] : []),
        ...(after.status !== before.status
          ? [`status ${String(before.status)} → ${String(after.status)}`]
          : []),
        ...(!isDeepStrictEqual(
          after.heads.map((head) => head[2]),
          before.heads.map((head) => head[2]),
        )
          ? ['version bumped']
          : []),
        ...(!isDeepStrictEqual(
          after.heads.map((head) => head[3]),
          before.heads.map((head) => head[3]),
        )
          ? [
              `data: ${differences(
                before.heads.map((head) => head[3]),
                after.heads.map((head) => head[3]),
              )
                .slice(0, 2)
                .join('; ')}`,
            ]
          : []),
      ];
      problems.push({
        property: '9 no-op',
        detail: `${caller.name}${version ? '@V' : ''} ${transport} ${kind} (${response.status}): ${changed.join(', ')}; body ${JSON.stringify(body).slice(0, 160)}`,
      });
    }
  }
  return problems;
};

// ---------------------------------------------------------------------------------------------------------
// Echo through a version at the top level (review 8, H1)

/**
 * H1: a caller that reads through V sends back what it read, unchanged (accepted, and a no-op), and with one field
 * it may write edited (accepted). Fields made private, deprecated, removed, retyped, or added since V, at the top
 * level and inside components, are all in what it read.
 */
export const echoThroughVersionProblems = async (
  w: World,
  caller: Caller,
  entryId: string,
): Promise<Problem[]> => {
  const read = await readAs(w, caller, entryId, 'en', true);
  if (!read) {
    return [];
  }
  const media = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(media)
      : isRecord(value)
        ? typeof value.id === 'string' && typeof value.mimeType === 'string'
          ? value.id
          : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, media(entry)]))
        : value;
  const meta = new Set([
    'id',
    '__model',
    '__kinds',
    'locale',
    'createdAt',
    'updatedAt',
    'publishedAt',
    'version',
    'status',
    'itemIds',
  ]);
  const echoed = media(Object.fromEntries(Object.entries(read).filter(([key]) => !meta.has(key)))) as Json;
  // The limited caller's write grant names only the component fields.
  const unwritable =
    caller.name === 'limited'
      ? [
          'title',
          'secretCard',
          'ref',
          'refs',
          'secretRef',
          'madePrivate',
          'deprecatedTop',
          'removedTop',
          'retypedTop',
          'addedTop',
        ]
      : [];
  const body = Object.fromEntries(Object.entries(echoed).filter(([key]) => !unwritable.includes(key)));
  const problems: Problem[] = [];
  const draftVersion = async () =>
    (await headsOf(w, entryId)).find((head) => head.locale === 'en' && head.state === 'draft')?.version ??
    null;
  const before = await entryState(w, entryId);
  const unchanged = await send(w, {
    caller,
    transport: 'rest',
    entryId,
    locale: 'en',
    version: true,
    expectedVersion: await draftVersion(),
    body,
  });
  const adminKind = caller.kind === 'adminToken' || caller.kind === 'pinned';
  if (refusedForMissingTarget(unchanged)) {
    return problems; // decision (c): an echoed target that no longer exists is refused, as on main
  }
  if (unchanged.status >= 300) {
    problems.push({
      property: '10 echo through V (H1)',
      detail: `${caller.name}: sending back what it read through V answered ${unchanged.status} ${unchanged.raw.slice(0, 300)}`,
    });
  } else if (!adminKind && !isDeepStrictEqual(await entryState(w, entryId), before)) {
    // (An admin-kind caller replaces the targets and media its delivery read left out, as on main: decision (a).)
    problems.push({
      property: '10 echo through V (H1)',
      detail: `${caller.name}: sending back what it read through V changed the entry`,
    });
  }
  const cards = listOf(body.cards);
  const edited =
    caller.name === 'limited'
      ? cards.length > 0
        ? { ...body, cards: [{ ...cards[0], heading: `${String(cards[0]?.heading)}+` }, ...cards.slice(1)] }
        : null
      : { ...body, title: `${String(body.title)}+` };
  if (edited) {
    const response = await send(w, {
      caller,
      transport: 'rest',
      entryId,
      locale: 'en',
      version: true,
      expectedVersion: await draftVersion(),
      body: edited,
    });
    if (response.status >= 300 && !refusedForMissingTarget(response)) {
      problems.push({
        property: '10 echo through V (H1)',
        detail: `${caller.name}: what it read through V with one field edited answered ${response.status} ${response.raw.slice(0, 300)}`,
      });
    }
  }
  return problems;
};
