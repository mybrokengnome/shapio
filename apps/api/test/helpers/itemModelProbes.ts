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
  send,
  storedView,
  type Problem,
  type Random,
  type Transport,
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
    await w.admin.post('/api/admin/content/doc?locale=en', {
      locale: 'en',
      data: {
        title: 't',
        secretRef: hidden,
        cards: [{ heading: 'A', note: 'n', secretRel: hidden }],
      },
    }),
    201,
  ).json<{ id: string }>().id;
  expectStatus(await w.admin.post(`/api/admin/content/doc/${id}/publish`, { locales: ['en'] }), 200);
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
  // The entry can still be published.
  const published = await w.admin.post(`/api/admin/content/doc/${a}/publish`, { locales: ['en'] });
  if (published.statusCode >= 300) {
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
    const readOnly = request.version ? ['count', 'old'] : [];
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
  // Known and pinned by the fixed case LEGACYLOC: with legacy items stored, an identical re-save that changes no
  // stored data still makes a revision. The random runs skip that class (set ITEM_MODEL_LEGACY_RESAVE=1 to see it).
  if (legacy && changed.length === 0 && !process.env.ITEM_MODEL_LEGACY_RESAVE) {
    return problems;
  }
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
