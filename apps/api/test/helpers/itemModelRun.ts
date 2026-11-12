import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { expectStatus } from './content.js';
import {
  eventCount,
  headsOf,
  revisionCount,
  type Caller,
  type Head,
  type Response,
  type World,
} from './itemModelWorld.js';

/**
 * One run of the model-based item-write fuzz: stored entries made through the API (plus the raw states no API
 * makes), a caller, a body built from what that caller read by an edit script, one request, and every property
 * checked against raw storage and the admin API. A run returns its problems, never throws on a property (so a
 * fixed case can say which property caught it).
 */

// ---------------------------------------------------------------------------------------------------------
// Randomness

export const prng = (seed: number) => {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => Math.floor(next() * max);
  const pick = <T>(items: readonly T[]): T => items[int(items.length)] as T;
  const chance = (p: number) => next() < p;
  const shuffle = <T>(items: readonly T[]): T[] => {
    const output = [...items];
    for (let index = output.length - 1; index > 0; index -= 1) {
      const other = int(index + 1);
      [output[index], output[other]] = [output[other] as T, output[index] as T];
    }
    return output;
  };
  return { int, pick, chance, shuffle };
};
export type Random = ReturnType<typeof prng>;

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const listOf = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isRecord) : []);

/** A media value as read (an object with its asset ID) is written back by its ID. */
const isMediaRead = (value: unknown): value is Json =>
  isRecord(value) && typeof value.id === 'string' && typeof value.mimeType === 'string';

// ---------------------------------------------------------------------------------------------------------
// Stored state

/** Hidden values carry a unique tag, so a value that moves to another item is seen moving. */
let tagCounter = 0;
export const tag = (kind: string) => `§${kind}${(tagCounter += 1)}`;
const isTag = (value: unknown): value is string => typeof value === 'string' && value.startsWith('§');

export type EntryPlan = {
  /** API-form data for the admin create (today's API IDs, private fields included). */
  data: Json;
  publish: boolean;
  /** Also a French draft (and published head, with `publish`). */
  french: boolean;
  /** Admin edits made to the draft after publishing (the published head then differs). */
  draftEdit: boolean;
  /** Owned by this app user. */
  ownerId?: string;
  /**
   * How the entry is stored (the upgrade case is first-class): every component item with its `__id`, some without
   * (`partial`), or none (`all`: stored before 0.9.0). Applied to every item at every depth, in every head.
   */
  legacy: 'with' | 'partial' | 'all';
  /** Values of the deprecated `old`; relations to a deleted target. */
  oldValues: number;
  deletedTargets: number;
};

const chipOf = (random: Random, look: string[]) => ({
  zv: random.pick(look),
  ...(random.chance(0.6) ? { zh: tag('zh') } : {}),
});

/** A card as the admin writes it: look-alike headings, hidden notes, every kind of value. */
const cardOf = (w: World, random: Random) => ({
  heading: random.pick(['A', 'B', 'S']),
  ...(random.chance(0.6) ? { note: tag('note') } : {}),
  ...(random.chance(0.4) ? { count: random.int(5) } : {}),
  ...(random.chance(0.4) ? { extra: tag('extra') } : {}),
  ...(random.chance(0.4) ? { rel: random.pick([w.things.published, w.things.draft]) } : {}),
  ...(random.chance(0.4)
    ? { rels: random.shuffle([w.things.published, w.things.draft]).slice(0, 1 + random.int(2)) }
    : {}),
  ...(random.chance(0.3) ? { pic: random.pick([w.media.public, w.media.private]) } : {}),
  ...(random.chance(0.4) ? { pvt: tag('pvt') } : {}),
  ...(random.chance(0.3) ? { data: { k: random.int(3) } } : {}),
  chips: Array.from({ length: random.int(3) }, () => chipOf(random, ['a', 'b'])),
});

export const planEntry = (w: World, random: Random, ownerId?: string): EntryPlan => ({
  data: {
    title: `t${random.int(100)}`,
    cards: Array.from({ length: random.int(4) }, () => cardOf(w, random)),
    lchips: Array.from({ length: random.int(3) }, () => chipOf(random, ['l', 'm'])),
    ...(random.chance(0.8)
      ? {
          hero: {
            label: random.pick(['L', 'M']),
            items: Array.from({ length: random.int(3) }, () => chipOf(random, ['i', 'j'])),
          },
        }
      : {}),
    zone: Array.from({ length: random.int(3) }, () =>
      random.chance(0.5)
        ? {
            __component: 'card',
            heading: random.pick(['Z', 'Y']),
            ...(random.chance(0.5) ? { note: tag('znote') } : {}),
          }
        : {
            __component: 'tag',
            label: random.pick(['T', 'U']),
            ...(random.chance(0.5) ? { tnote: tag('tnote') } : {}),
          },
    ),
    ...(random.chance(0.6) ? { secretCard: { heading: 'S', note: tag('secret') } } : {}),
    // Fields changed since V, at the top level: values a client on V reads (or does not) and sends back.
    ...(random.chance(0.6) ? { madePrivate: tag('mp') } : {}),
    ...(random.chance(0.6) ? { retypedTop: random.int(9) } : {}),
    ...(random.chance(0.6) ? { addedTop: tag('at') } : {}),
  },
  publish: random.chance(0.8),
  french: random.chance(0.4),
  draftEdit: random.chance(0.25),
  ...(ownerId ? { ownerId } : {}),
  legacy: random.pick(['with', 'partial', 'all'] as const),
  oldValues: random.chance(0.5) ? 0.5 : 0,
  deletedTargets: random.chance(0.3) ? 0.5 : 0,
});

const stripIds = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stripIds)
    : isRecord(value)
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== '__id')
            .map(([k, v]) => [k, stripIds(v)]),
        )
      : value;

/** Applies the raw-only parts of a plan to one head's storage (deterministically from `seed`). */
const rawTouches = (w: World, data: Json, plan: EntryPlan, seed: number): Json => {
  const random = prng(seed);
  const cards = listOf(data[w.doc.cards]).map((card, index) => {
    const next: Json = { ...card };
    if (plan.oldValues > 0 && random.chance(plan.oldValues)) {
      // The same value in every head (a value per entry and place, not per head).
      next[w.card.old] = `§old${seed}x${index}`;
    }
    if (plan.deletedTargets > 0 && random.chance(plan.deletedTargets)) {
      next[w.card.rel] = w.things.deleted;
    }
    return next;
  });
  const touched: Json = { ...data, ...(data[w.doc.cards] === undefined ? {} : { [w.doc.cards]: cards }) };
  // Values no API writes any more: a deprecated top-level field, a field removed since V (top and in a card).
  if (plan.oldValues > 0) {
    touched[w.doc.deprecatedTop] = `§dt${seed}`;
    touched[w.removed[w.docKey]] = `§rt${seed}`;
    const first = listOf(touched[w.doc.cards])[0];
    if (first) {
      first[w.removed.card] = `§rc${seed}`;
    }
  }
  return legacyOf(touched, plan.legacy, seed);
};

/**
 * `data` as 0.8.2 stored it: no `__id` on any component item (`all`), or on some (`partial`: chosen by a hash of
 * the item's content and place, so the same item is chosen in every head).
 */
export const legacyOf = (data: Json, mode: EntryPlan['legacy'], seed: number): Json => {
  if (mode === 'with') {
    return data;
  }
  const hash = (text: string) =>
    [...text].reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, seed >>> 0);
  const walk = (value: unknown, place: string): unknown => {
    if (Array.isArray(value)) {
      return value.map((item, index) => walk(item, `${place}/${index}`));
    }
    if (!isRecord(value)) {
      return value;
    }
    const strip =
      typeof value.__id === 'string' &&
      (mode === 'all' || hash(`${place}:${JSON.stringify(stripIds(value))}`) % 2 === 0);
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !(strip && key === '__id'))
        .map(([key, entry]) => [key, walk(entry, `${place}/${key}`)]),
    );
  };
  return walk(data, '') as Json;
};

/**
 * Rewrites an entry's heads as the server would have stored them: each new head data gets a revision of its own
 * (a copy of the head's revision with that data, its parent the old one), so heads and revisions agree.
 */
export const storeHeads = async (w: World, entryId: string, change: (head: Head) => Json) => {
  const made = new Map<string, string>();
  for (const head of await headsOf(w, entryId)) {
    const data = change(head);
    const key = `${head.revision}:${JSON.stringify(data)}`;
    let revision = made.get(key);
    if (!revision) {
      const old = await w.db
        .selectFrom('content_revisions')
        .selectAll()
        .where('id', '=', head.revision)
        .executeTakeFirstOrThrow();
      revision = randomUUID();
      await w.db
        .insertInto('content_revisions')
        .values({ ...old, id: revision, data: data as never, parent_revision_id: old.id })
        .execute();
      made.set(key, revision);
    }
    await w.db
      .updateTable('entry_heads')
      .set({ data: data as never, revision_id: revision })
      .where('entry_id', '=', entryId)
      .where('locale', '=', head.locale)
      .where('state', '=', head.state as never)
      .execute();
  }
};

export type Entry = { id: string; plan: EntryPlan };

/** Makes an entry from a plan, through the admin API, then the raw touches on every head. */
export const createEntry = async (w: World, plan: EntryPlan, seed: number): Promise<Entry> => {
  const created = expectStatus(
    await w.admin.post(`/api/admin/content/${w.docKey}?locale=en`, { locale: 'en', data: plan.data }),
    201,
  ).json<{ id: string }>();
  const id = created.id;
  if (plan.french) {
    expectStatus(
      await w.admin.put(`/api/admin/content/${w.docKey}/${id}?locale=fr`, {
        locale: 'fr',
        expectedVersion: null,
        data: { title: 'fr', lchips: [{ zv: 'f', zh: tag('frzh') }] },
      }),
      200,
    );
  }
  if (plan.publish && w.draftAndPublish) {
    expectStatus(
      await w.admin.post(`/api/admin/content/${w.docKey}/${id}/publish`, {
        locales: plan.french ? ['en', 'fr'] : ['en'],
      }),
      200,
    );
  }
  if (plan.draftEdit && plan.publish && w.draftAndPublish) {
    // A draft-only edit through the admin API (a new draft revision): the published head differs.
    const admin = await w.request('GET', `/api/admin/content/${w.docKey}/${id}?locale=en`, w.adminToken);
    const view = (admin.body as { version: number; data: Json }).data;
    const cards = listOf(view.cards).map((card) => asSent(card, true));
    expectStatus(
      await w.admin.put(`/api/admin/content/${w.docKey}/${id}?locale=en`, {
        locale: 'en',
        expectedVersion: (admin.body as { version: number }).version,
        data: { cards: [...cards.slice(1), { id: null, heading: 'D', note: tag('draftonly') }] },
      }),
      200,
    );
  }
  await storeHeads(w, id, (head) => rawTouches(w, head.data, plan, seed));
  if (plan.ownerId) {
    await w.db.updateTable('entries').set({ owner_app_user_id: plan.ownerId }).where('id', '=', id).execute();
  }
  return { id, plan };
};

// ---------------------------------------------------------------------------------------------------------
// Reading

const META = new Set([
  'id',
  '__model',
  '__kinds',
  'locale',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'version',
  'status',
]);

/** What a caller reads of an entry (API form with item IDs), or null when it may not read it. */
export const readAs = async (
  w: World,
  caller: Caller,
  entryId: string,
  locale: string,
  version: boolean,
): Promise<Json | null> => {
  if (caller.kind === 'admin') {
    const response = await w.request(
      'GET',
      `/api/admin/content/${w.docKey}/${entryId}?locale=${locale}`,
      caller.token,
    );
    return response.status === 200 && isRecord(response.body) && isRecord(response.body.data)
      ? response.body.data
      : null;
  }
  const query = `?locale=${locale}${version || caller.pinned ? `&schemaVersion=${encodeURIComponent(w.versionToken)}` : ''}`;
  const response = await w.request('GET', `/api/content/${w.docPlural}/${entryId}${query}`, caller.token);
  if (response.status !== 200 || !isRecord(response.body) || !isRecord(response.body.data)) {
    return null;
  }
  return Object.fromEntries(Object.entries(response.body.data).filter(([key]) => !META.has(key)));
};

/** The admin's view of the draft (every item with its ID, legacy ones derived), and the raw head beside it. */
export const storedView = async (w: World, entryId: string, locale: string) => {
  const heads = await headsOf(w, entryId);
  const draft = heads.find((head) => head.locale === locale && head.state === 'draft');
  const admin = await readAs(w, { ...w.callers.admin }, entryId, locale, false);
  return { heads, draft, admin };
};

/** Every component instance of a head with its ID (stored, or the admin read's derived one at the same place). */
export type Instance = {
  id: string;
  /** Where: `cards`, `cards/<parentId>/chips`, `hero`, `hero/<id>/items`, `zone`, `lchips`, `secretCard`. */
  list: string;
  raw: Json;
  api: Json;
};

const COMPONENT_LISTS: Array<
  [apiKey: 'cards' | 'lchips' | 'hero' | 'zone' | 'secretCard', nested: string | null]
> = [
  ['cards', 'chips'],
  ['lchips', null],
  ['hero', 'items'],
  ['zone', 'chips'],
  ['secretCard', 'chips'],
];

export const instancesOf = (w: World, raw: Json | undefined, api: Json | null): Instance[] => {
  const output: Instance[] = [];
  if (!raw || !api) {
    return output;
  }
  const nestedFieldId = (nested: string) => (nested === 'items' ? w.box.items : w.card.chips);
  for (const [apiKey, nested] of COMPONENT_LISTS) {
    const fieldId = w.doc[apiKey];
    const raws = Array.isArray(raw[fieldId])
      ? listOf(raw[fieldId])
      : isRecord(raw[fieldId])
        ? [raw[fieldId]]
        : [];
    const apis = Array.isArray(api[apiKey])
      ? listOf(api[apiKey])
      : isRecord(api[apiKey])
        ? [api[apiKey]]
        : [];
    raws.forEach((item, index) => {
      const apiItem = apis[index];
      const id =
        typeof item.__id === 'string'
          ? item.__id
          : typeof apiItem?.id === 'string'
            ? apiItem.id
            : `?${apiKey}${index}`;
      output.push({ id, list: apiKey, raw: item, api: apiItem ?? {} });
      if (nested) {
        const subRaws = listOf(item[nestedFieldId(nested)]);
        const subApis = listOf(apiItem?.[nested]);
        subRaws.forEach((sub, position) => {
          const subApi = subApis[position];
          const subId =
            typeof sub.__id === 'string'
              ? sub.__id
              : typeof subApi?.id === 'string'
                ? subApi.id
                : `?${id}/${position}`;
          output.push({ id: subId, list: `${apiKey}/${id}/${nested}`, raw: sub, api: subApi ?? {} });
        });
      }
    });
  }
  return output;
};

/** The instances of a caller's read (API form), by ID. */
const readInstances = (read: Json | null): Map<string, Json> => {
  const byId = new Map<string, Json>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (isRecord(value)) {
      if (
        typeof value.id === 'string' &&
        (value.__component !== undefined || Object.keys(value).length > 1)
      ) {
        byId.set(value.id, value);
      }
      Object.values(value).forEach(walk);
    }
  };
  if (read) {
    for (const [key, value] of Object.entries(read)) {
      if (key !== 'id') {
        walk(value);
      }
    }
  }
  return byId;
};

/** A component instance's own values in API form (no ID, no nested lists, no empties): what is compared. */
export const leafView = (item: Json): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(item)
        .map(([key, value]): [string, unknown] => [key, isMediaRead(value) ? value.id : value])
        .filter(
          ([key, value]) => key !== 'id' && !Array.isArray(value) && value !== null && value !== undefined,
        )
        .filter(([, value]) => !(isRecord(value) && 'id' in value))
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );

/** A component instance's whole value as compared by key (nested items included, no IDs, no empties). */
export const fullView = (item: Json): string => {
  const normal = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(normal)
      : isMediaRead(value)
        ? value.id
        : isRecord(value)
          ? Object.fromEntries(
              Object.entries(value)
                .filter(
                  ([key, entry]) =>
                    key !== 'id' &&
                    entry !== null &&
                    entry !== undefined &&
                    !(Array.isArray(entry) && entry.length === 0),
                )
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, entry]) => [key, normal(entry)]),
            )
          : value;
  return JSON.stringify(normal(item));
};

// ---------------------------------------------------------------------------------------------------------
// Bodies: edit scripts over what the caller read

export type IdMode = 'echo' | 'none' | 'mixed' | 'nullNew' | 'repeated' | 'foreign';
export type EditOp =
  | 'unchanged'
  | 'reorder'
  | 'delete'
  | 'insert'
  | 'edit'
  | 'duplicate'
  | 'moveAcross'
  | 'swapLookalikes'
  | 'replaceAll'
  | 'empty'
  | 'omit';

export const EDIT_OPS: readonly EditOp[] = [
  'unchanged',
  'reorder',
  'delete',
  'insert',
  'edit',
  'duplicate',
  'moveAcross',
  'swapLookalikes',
  'replaceAll',
  'empty',
  'omit',
];
export const ID_MODES: readonly IdMode[] = ['echo', 'none', 'mixed', 'nullNew', 'repeated', 'foreign'];

/** A read item as sent back: its values without nulls (and without `id` unless kept), nested lists likewise. */
const asSent = (item: Json, keepId: boolean, keepNulls = false): Json =>
  Object.fromEntries(
    Object.entries(item)
      .map(([key, value]): [string, unknown] => [key, isMediaRead(value) ? value.id : value])
      .filter(([key, value]) => (keepNulls || value !== null) && (keepId || key !== 'id'))
      .map(([key, value]): [string, unknown] => [
        key,
        Array.isArray(value)
          ? (value as unknown[]).map((entry) => (isRecord(entry) ? asSent(entry, keepId, keepNulls) : entry))
          : value,
      ]),
  );

const newCard = (random: Random, admin: boolean) => ({
  heading: random.pick(['A', 'B', 'N']),
  ...(admin && random.chance(0.5) ? { note: tag('newnote') } : {}),
  chips: random.chance(0.5) ? [{ zv: random.pick(['a', 'n']) }] : [],
});

/** One list edited by `op`, with IDs as `mode` says (`foreignIds`: IDs from elsewhere). */
const editList = (
  random: Random,
  items: Json[],
  op: EditOp,
  mode: IdMode,
  make: () => Json,
  foreignIds: readonly string[],
): Json[] | undefined => {
  let output = items.map((item) => ({ ...item }));
  switch (op) {
    case 'omit':
      return undefined;
    case 'empty':
      return [];
    case 'reorder':
      output = random.shuffle(output);
      break;
    case 'delete':
      output = output.filter(() => random.chance(0.6));
      break;
    case 'insert':
      output.splice(random.int(output.length + 1), 0, { ...make(), id: null });
      break;
    case 'edit':
      if (output.length > 0) {
        const at = random.int(output.length);
        const item = output[at] as Json;
        const key = ['heading', 'zv', 'label'].find((candidate) => candidate in item) ?? 'heading';
        output[at] = { ...item, [key]: `${typeof item[key] === 'string' ? item[key] : ''}*` };
      }
      break;
    case 'duplicate':
      if (output.length > 0) {
        output.splice(random.int(output.length + 1), 0, { ...random.pick<Json>(output) });
      }
      break;
    case 'swapLookalikes': {
      const views = output.map(leafView);
      const pairs = views.flatMap((view, a) =>
        views.flatMap((other, b) => (a < b && view === other ? [[a, b]] : [])),
      );
      if (pairs.length > 0) {
        const [a, b] = random.pick(pairs) as [number, number];
        [output[a], output[b]] = [output[b] as Json, output[a] as Json];
      }
      break;
    }
    case 'replaceAll':
      output = output.map(() => ({ ...make(), id: null }));
      break;
    default:
      break;
  }
  // IDs.
  return output.map((item, index) => {
    const known = typeof item.id === 'string' ? item.id : undefined;
    const { id: _ignored, ...rest } = item;
    switch (mode) {
      case 'none':
        return rest;
      case 'mixed':
        return known && random.chance(0.5) ? { ...rest, id: known } : rest;
      case 'nullNew':
      case 'echo':
        return known ? { ...rest, id: known } : mode === 'nullNew' ? { ...rest, id: null } : rest;
      case 'repeated':
        return known ? { ...rest, id: index === 0 ? known : ((output[0] as Json).id ?? known) } : rest;
      case 'foreign':
        return {
          ...rest,
          id: random.chance(0.5) && foreignIds.length > 0 ? random.pick(foreignIds) : randomUUID(),
        };
      default:
        return rest;
    }
  });
};

/** Bodies of a wrong shape, at every level. */
const CORRUPTIONS: Array<(body: Json) => Json> = [
  (body) => ({ ...body, cards: 'nope' }),
  (body) => ({ ...body, cards: { heading: 'x' } }),
  (body) => ({ ...body, cards: [5] }),
  (body) => ({ ...body, cards: [[]] }),
  (body) => ({ ...body, hero: [{ label: 'x' }] }),
  (body) => ({ ...body, hero: 'x' }),
  (body) => ({ ...body, hero: { label: 'x', items: 'nope' } }),
  (body) => ({ ...body, hero: { label: 'x', items: [{ zv: 5 }] } }),
  (body) => ({ ...body, zone: [{ heading: 'no component' }] }),
  (body) => ({ ...body, zone: [{ __component: 'nope' }] }),
  (body) => ({ ...body, zone: 'x' }),
  (body) => ({ ...body, cards: [{ heading: 'x', chips: 'nope' }] }),
  (body) => ({ ...body, cards: [{ heading: 'x', chips: [{ zv: { deep: true } }] }] }),
  (body) => ({ ...body, cards: [{ heading: 'x', count: 'many' }] }),
  (body) => ({ ...body, cards: [{ id: 5, heading: 'x' }] }),
  (body) => ({ ...body, lchips: null }),
  (body) => ({ ...body, unknownField: 1 }),
];

export type Plan = {
  op: EditOp;
  nestedOp: EditOp;
  mode: IdMode;
  corrupt: number | null;
  /** A value for a field the caller may not write (a private one). */
  forbidden: boolean;
  /** Send back the nulls it read too (an exact echo), not only the values. */
  echoNulls: boolean;
};

export const planBody = (random: Random): Plan => ({
  op: random.pick(EDIT_OPS),
  nestedOp: random.chance(0.5) ? 'unchanged' : random.pick(EDIT_OPS),
  mode: random.pick(ID_MODES),
  corrupt: random.chance(0.1) ? random.int(CORRUPTIONS.length) : null,
  forbidden: random.chance(0.08),
  echoNulls: random.chance(0.3),
});

/** The body a caller sends: what it read (or, a caller that cannot read, what it knows), edited by the plan. */
export const bodyOf = (
  random: Random,
  read: Json | null,
  plan: Plan,
  { admin, foreignIds }: { admin: boolean; foreignIds: readonly string[] },
): Json => {
  const base = read ?? { cards: [], lchips: [], zone: [] };
  const cards = listOf(base.cards).map((card) => asSent(card, true, plan.echoNulls));
  const editedCards = editList(random, cards, plan.op, plan.mode, () => newCard(random, admin), foreignIds);
  // Nested: the chips of each card, and one moved across cards.
  const withNested = editedCards?.map((card) => {
    const chips = listOf(card.chips);
    const next = editList(random, chips, plan.nestedOp, plan.mode, () => ({ zv: 'n' }), foreignIds);
    return next === undefined ? (({ chips: _c, ...rest }) => rest)(card) : { ...card, chips: next };
  });
  if (withNested && plan.nestedOp === 'moveAcross' && withNested.length > 1) {
    const from = withNested[0] as Json;
    const to = withNested[withNested.length - 1] as Json;
    const moved = listOf(from.chips)[0];
    if (moved) {
      from.chips = listOf(from.chips).slice(1);
      to.chips = [...listOf(to.chips), moved];
    }
  }
  const body: Json = {};
  if (withNested !== undefined) {
    body.cards = withNested;
  }
  if (random.chance(0.5)) {
    const lchips = editList(
      random,
      listOf(base.lchips).map((chip) => asSent(chip, true)),
      random.pick(EDIT_OPS),
      plan.mode,
      () => ({ zv: 'n' }),
      foreignIds,
    );
    if (lchips !== undefined) {
      body.lchips = lchips;
    }
  }
  if (random.chance(0.4) && isRecord(base.hero)) {
    const hero = asSent(base.hero, true);
    const items = editList(
      random,
      listOf(hero.items),
      random.pick(EDIT_OPS),
      plan.mode,
      () => ({ zv: 'n' }),
      foreignIds,
    );
    body.hero = { ...hero, ...(items === undefined ? {} : { items }) };
    if (plan.mode === 'none') {
      delete (body.hero as Json).id;
    }
  }
  if (random.chance(0.4)) {
    const zone = editList(
      random,
      listOf(base.zone).map((item) => asSent(item, true)),
      random.pick(EDIT_OPS),
      plan.mode,
      () => (random.chance(0.5) ? { __component: 'card', heading: 'Z' } : { __component: 'tag', label: 'T' }),
      foreignIds,
    );
    if (zone !== undefined) {
      body.zone = zone;
    }
  }
  if (random.chance(0.2)) {
    body.title = `t${random.int(100)}`;
  }
  if (plan.forbidden && !admin) {
    const cardsSent = listOf(body.cards);
    if (cardsSent.length > 0) {
      (cardsSent[0] as Json).note = random.chance(0.5) ? 'leak' : null;
    } else {
      body.cards = [{ heading: 'A', note: 'leak' }];
    }
  }
  return plan.corrupt === null ? body : (CORRUPTIONS[plan.corrupt] as (body: Json) => Json)(body);
};

// ---------------------------------------------------------------------------------------------------------
// Writing

export type Transport = 'rest' | 'graphql' | 'adminApi';

export type WriteRequest = {
  caller: Caller;
  transport: Transport;
  entryId: string | null;
  locale: string;
  version: boolean;
  expectedVersion: number | null | undefined;
  body: Json;
};

const graphqlUpdate = (
  w: World,
) => `mutation ($id: ID!, $v: Int, $data: ${w.gqlNames.input}, $locale: String) {
  ${w.gqlNames.update}(id: $id, expectedVersion: $v, data: $data, locale: $locale) { id version }
}`;
const graphqlCreate = (w: World) =>
  `mutation ($data: ${w.gqlNames.input}, $locale: String) { ${w.gqlNames.create}(data: $data, locale: $locale) { id version } }`;

/** Sends one write; returns the response (GraphQL folded to a status and an error code). */
export const send = async (w: World, request: WriteRequest): Promise<Response> => {
  const { caller, entryId, locale, body } = request;
  const query = `?locale=${locale}${request.version && !caller.pinned ? `&schemaVersion=${encodeURIComponent(w.versionToken)}` : ''}`;
  if (request.transport === 'adminApi') {
    return entryId
      ? w.request('PUT', `/api/admin/content/${w.docKey}/${entryId}${query}`, caller.token, {
          locale,
          expectedVersion: request.expectedVersion,
          data: body,
        })
      : w.request('POST', `/api/admin/content/${w.docKey}${query}`, caller.token, { locale, data: body });
  }
  if (request.transport === 'graphql') {
    // GraphQL names a zone item by its component: { card: {...} }, not { __component: 'card', ... }.
    const gqlBody = Array.isArray(body.zone)
      ? {
          ...body,
          zone: (body.zone as unknown[]).map((item) =>
            isRecord(item) && typeof item.__component === 'string'
              ? {
                  [item.__component]: Object.fromEntries(
                    Object.entries(item).filter(([key]) => key !== '__component'),
                  ),
                }
              : item,
          ),
        }
      : body;
    return entryId
      ? w.gql(
          graphqlUpdate(w),
          { id: entryId, v: request.expectedVersion, data: gqlBody, locale },
          caller.token,
          request.version,
        )
      : w.gql(graphqlCreate(w), { data: gqlBody, locale }, caller.token, request.version);
  }
  return entryId
    ? w.request('PUT', `/api/content/${w.docPlural}/${entryId}${query}`, caller.token, {
        locale,
        ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }),
        data: body,
      })
    : w.request('POST', `/api/content/${w.docPlural}${query}`, caller.token, { locale, data: body });
};

/** Whether a write was accepted, and how it was refused (status, code, issue codes and paths). */
export const outcomeOf = (response: Response) => {
  const body = response.body as Json | null;
  if (isRecord(body) && Array.isArray(body.errors)) {
    // GraphQL: errors carry the REST code in extensions.
    const error = (body.errors as Json[])[0] ?? {};
    const extensions = isRecord(error.extensions) ? error.extensions : {};
    return {
      accepted: false,
      status: response.status,
      code: typeof extensions.code === 'string' ? extensions.code : 'GRAPHQL_ERROR',
      issues: listOf(
        extensions.issues ?? (isRecord(extensions.details) ? extensions.details.issues : undefined),
      )
        .map((issue) => `${String(issue.code)} ${String(issue.path)}`)
        .sort(),
    };
  }
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const details = error && isRecord(error.details) ? error.details : {};
  return {
    accepted: response.status < 300,
    status: response.status,
    code: error ? String(error.code) : 'OK',
    issues: listOf(details.issues)
      .map((issue) => `${String(issue.code)} ${String(issue.path)}`)
      .sort(),
  };
};

// ---------------------------------------------------------------------------------------------------------
// Properties

export type Problem = { property: string; detail: string };

/** IDs unique within every head. */
export const idUniqueness = (heads: Head[]): Problem[] =>
  heads.flatMap((head) => {
    const ids: string[] = [];
    const walk = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(walk);
      } else if (isRecord(value)) {
        if (typeof value.__id === 'string') {
          ids.push(value.__id);
        }
        Object.values(value).forEach(walk);
      }
    };
    walk(head.data);
    const twice = ids.filter((id, index) => ids.indexOf(id) !== index);
    return twice.length > 0
      ? [{ property: '3 ID integrity', detail: `${head.locale}/${head.state}: ID ${twice[0]} stored twice` }]
      : [];
  });

/** The list a sent item belongs to, and its sent value, by the written instance's ID (by position). */
const sentByWrittenId = (w: World, body: Json, after: Instance[]) => {
  const byId = new Map<string, { sent: Json; list: string }>();
  const sentLists = new Map<string, Json[]>();
  for (const [apiKey, nested] of COMPONENT_LISTS) {
    const value = body[apiKey];
    const items = Array.isArray(value)
      ? listOf(value)
      : isRecord(value)
        ? [value]
        : value === undefined
          ? null
          : [];
    if (items === null) {
      continue;
    }
    sentLists.set(apiKey, items);
    const written = after.filter((instance) => instance.list === apiKey);
    items.forEach((item, index) => {
      const instance = written[index];
      if (!instance) {
        return;
      }
      byId.set(instance.id, { sent: item, list: apiKey });
      if (nested && item[nested] !== undefined) {
        const subs = listOf(item[nested]);
        sentLists.set(`${apiKey}/${instance.id}/${nested}`, subs);
        after
          .filter((candidate) => candidate.list === `${apiKey}/${instance.id}/${nested}`)
          .forEach((sub, position) => {
            const sent = subs[position];
            if (sent) {
              byId.set(sub.id, { sent, list: `${apiKey}/${instance.id}/${nested}` });
            }
          });
      }
    });
  }
  void w;
  return { byId, sentLists };
};

/**
 * Conservation (1) and ID integrity (3) of one accepted write, from the written locale's draft before and after,
 * what the caller read before (null: it could not read), and the body.
 */
/** Relation and media fields inside components (decision (a) treats them as shown to drafts readers). */
const RELATION_OR_MEDIA = new Set(['rel', 'rels', 'anyRels', 'secretRel', 'pic']);

/** Decision (c): relation values the body names are validated as on main, so echoing a target that no longer
 * exists (raw-injected) is refused with RELATION_TARGET_MISSING, and nothing else. */
export const refusedForMissingTarget = (response: Response): boolean => {
  const outcome = outcomeOf(response);
  return (
    response.status === 422 &&
    outcome.issues.length > 0 &&
    outcome.issues.every((issue) => issue.startsWith('RELATION_TARGET_MISSING'))
  );
};

export const acceptedWriteProblems = (
  w: World,
  {
    before,
    after,
    read,
    body,
    admin,
    writesAll = admin,
    version = false,
    changed,
  }: {
    before: Instance[];
    after: Instance[];
    read: Json | null;
    body: Json;
    admin: boolean;
    /** An admin-kind caller: may write every field that is not deprecated (and, through V, known to V). */
    writesAll?: boolean;
    version?: boolean;
    /**
     * Whether the write changed the entry (a new draft revision); a no-op keeps even dead targets. Undefined when it
     * cannot be told (concurrent writers: another write may have made the revision): a dead target may then go or
     * stay.
     */
    changed?: boolean;
  },
): Problem[] => {
  const problems: Problem[] = [];
  const seen = readInstances(read);
  const afterById = new Map(after.map((instance) => [instance.id, instance]));
  const { byId: sentFor, sentLists } = sentByWrittenId(w, body, after);
  const sentIds = new Set<string>();
  for (const items of sentLists.values()) {
    items.forEach((item) => typeof item.id === 'string' && sentIds.add(item.id));
  }
  // delivery-api.md, Item IDs: "Items under a new item are new, whatever `id`s they carry." An `id` sent inside a
  // list item sent without one names nothing, so the stored item it once named may be gone.
  const underNewItem = new Set<string>();
  const walk = (value: unknown, insideNew: boolean): void => {
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, insideNew || (isRecord(item) && typeof item.id !== 'string')));
    } else if (isRecord(value)) {
      if (insideNew && typeof value.id === 'string') {
        underNewItem.add(value.id);
      }
      Object.values(value).forEach((entry) => walk(entry, insideNew));
    }
  };
  walk(body, false);
  // delivery-api.md, Item IDs: "Move an item into another list, or under another parent item: send it there
  // without `id`. It is new in its new place." An `id` sent in another list than the one that holds it (under
  // another parent card, for example) names nothing there, so the stored item may be gone.
  const sentInList = new Map<string, string>();
  for (const [listKey, items] of sentLists) {
    items.forEach((item) => typeof item.id === 'string' && sentInList.set(item.id, listKey));
  }
  // Hidden: a stored value the caller did not read exactly (its item unread, the key missing, read as null, or
  // read otherwise: a relation to a target it cannot see).
  const hiddenOf = (instance: Instance): string[] => {
    const readItem = seen.get(instance.id);
    return (
      Object.entries(instance.raw)
        .filter(
          ([key, value]) =>
            key !== '__id' && key !== '__component' && value !== null && !Array.isArray(value),
        )
        .filter(
          ([key, value]) => !readItem || !isDeepStrictEqual(readItem[w.apiKeyOf.get(key) ?? key], value),
        )
        // Decision (a): a caller that may read drafts is shown every relation target and media, whatever view it
        // read; what it sends replaces them (as on main).
        .filter(([key]) => !(writesAll && RELATION_OR_MEDIA.has(w.apiKeyOf.get(key) ?? key)))
        .map(([key]) => key)
    );
  };
  // 3: a newly minted ID is 12 base62 characters.
  const beforeIds = new Set(before.map((instance) => instance.id));
  for (const instance of after) {
    if (
      !beforeIds.has(instance.id) &&
      !/^[0-9A-Za-z]{12}$/.test(instance.id) &&
      !instance.id.startsWith('?')
    ) {
      problems.push({
        property: '3 ID integrity',
        detail: `new ID ${instance.id} (${instance.list}) is not 12 base62 characters`,
      });
    }
  }
  const tagsBefore = new Map<string, string>();
  for (const instance of before) {
    for (const value of Object.values(instance.raw)) {
      if (isTag(value)) {
        tagsBefore.set(value, instance.id);
      }
    }
  }
  const sentText = JSON.stringify(body);
  const dead = new Set([w.things.deleted]);
  const dropDead = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.filter((target) => !dead.has(String(target)))
      : typeof value === 'string' && dead.has(value)
        ? null
        : value;
  // delivery-api.md, Item IDs: "An item sent with an `id` the draft does not hold, and that is not refused, is
  // matched by content like an item sent without an `id`: it continues the one stored item that equals it,
  // otherwise it is new." So a stored item may continue under a sent item with another `id` only when the list
  // does not hold that `id`, and the sent item equals, in the caller's view, exactly one stored item of the list
  // that no sent `id` claims (this one).
  // An item the caller read is judged as it read it. One whose stored id it never read (a stale read: the item has
  // a new id since) is judged by content: the stored item's fields the caller sent (what it can see and write).
  const viewOf = (instance: Instance, sent?: Json): string | null => {
    const readItem = seen.get(instance.id);
    if (admin) {
      return leafView(instance.api);
    }
    if (readItem) {
      return leafView(readItem);
    }
    if (!sent) {
      return null;
    }
    const keys = new Set(Object.keys(asSent(sent, false)));
    return leafView(Object.fromEntries(Object.entries(instance.api).filter(([key]) => keys.has(key))));
  };
  const continuesByContent = (instance: Instance, sent: Json): boolean => {
    // (The draft holds an `id` for this purpose when this list holds it: an `id` from another list of the entry is a
    // copy here.)
    if (
      typeof sent.id !== 'string' ||
      before.some((other) => other.list === instance.list && other.id === sent.id)
    ) {
      return false;
    }
    const now = leafView(asSent(sent, false));
    const equal = before.filter(
      (other) => other.list === instance.list && !sentIds.has(other.id) && viewOf(other, sent) === now,
    );
    return equal.length === 1 && equal[0]?.id === instance.id;
  };
  // delivery-api.md: "Swapping two items that are identical in everything stored changes nothing on the admin API,
  // and on the delivery API where your token can read and write every field of those items and can see every
  // relation target and media asset they may hold." So for such a caller (admin-kind), a stored item may keep its
  // place under the `id` of another item of its list that is identical to it in everything stored.
  const identicalSwap = (instance: Instance, sent: Json): boolean => {
    if (!writesAll || typeof sent.id !== 'string') {
      return false;
    }
    const other = before.find((candidate) => candidate.list === instance.list && candidate.id === sent.id);
    const stored = (item: Instance) => JSON.stringify(stripIds(item.raw));
    if (other !== undefined && stored(other) === stored(instance)) {
      return true;
    }
    // Review 16 (the rule as built): "where nothing in the items is hidden from the caller, and on admin writes,
    // the list sent exactly as stored continues as a whole" — each stored item continues at its place, whatever
    // ids were sent (for example a read's ids for legacy items that the draft derives differently).
    const sentList = sentLists.get(instance.list);
    const storedList = before.filter((candidate) => candidate.list === instance.list);
    return (
      sentList !== undefined &&
      sentList.length === storedList.length &&
      sentList.every((item, index) => {
        const storedItem = storedList[index];
        return (
          storedItem !== undefined &&
          leafView(asSent(item, false)) === leafView(asSent(storedItem.api, false))
        );
      }) &&
      sentList.indexOf(sent) === storedList.indexOf(instance)
    );
  };
  // 1: no hidden value sits on another item.
  for (const instance of after) {
    for (const value of Object.values(instance.raw)) {
      if (
        isTag(value) &&
        !sentText.includes(value) &&
        tagsBefore.has(value) &&
        tagsBefore.get(value) !== instance.id
      ) {
        problems.push({
          property: '1 conservation',
          detail: `${value} moved from ${tagsBefore.get(value)} to ${instance.id} (${instance.list})`,
        });
      }
    }
  }
  for (const instance of before) {
    const hidden = hiddenOf(instance);
    const next = afterById.get(instance.id);
    const sent = sentFor.get(instance.id)?.sent;
    if (next) {
      // 1: a continued item keeps every hidden value (unless the body set that field itself).
      for (const key of hidden) {
        const apiKey = w.apiKeyOf.get(key) ?? key;
        if (sent && sent[apiKey] !== undefined && sent[apiKey] !== null) {
          continue;
        }
        // CHANGELOG.md: "A kept target that has since been deleted is not kept: the next write that changes
        // something drops it, as before 0.9.0". A hidden relation to a target that is no longer a live entry goes with a write that changes
        // the entry, and stays with a no-op.
        // (A field the body did not send keeps its stored value untouched, dead targets included.)
        const fieldSent = body[instance.list.split('/')[0] ?? ''] !== undefined;
        const dropped = dropDead(instance.raw[key]);
        const expected = changed && fieldSent ? dropped : instance.raw[key];
        const either =
          changed === undefined && fieldSent && isDeepStrictEqual(next.raw[key] ?? null, dropped ?? null);
        if (!either && !isDeepStrictEqual(next.raw[key] ?? null, expected ?? null)) {
          problems.push({
            property: '1 conservation',
            detail: `${instance.list} ${instance.id}: hidden ${key} ${JSON.stringify(instance.raw[key])} → ${JSON.stringify(next.raw[key])}${expected === instance.raw[key] ? '' : `, expected ${JSON.stringify(expected)} (a dead target goes with a change)`}`,
          });
        }
      }
      // Relations: the visible targets follow what was sent; each hidden stored target stays right after the
      // nearest shown-and-resent target before it in stored order (at the start if none), in its own order.
      const relsKey = w.card.rels;
      const readItem = seen.get(instance.id);
      if (
        !writesAll &&
        sent &&
        Array.isArray(sent.rels) &&
        Array.isArray(instance.raw[relsKey]) &&
        readItem
      ) {
        const stored = instance.raw[relsKey] as string[];
        const shown = new Set(Array.isArray(readItem.rels) ? (readItem.rels as unknown[]).map(String) : []);
        const resent = (sent.rels as unknown[]).map(String);
        const groups = new Map<string, string[]>();
        let anchor = '';
        for (const target of stored) {
          if (shown.has(target)) {
            if (resent.includes(target)) {
              anchor = target;
            }
          } else {
            groups.set(anchor, [...(groups.get(anchor) ?? []), target]);
          }
        }
        const kept = [
          ...(groups.get('') ?? []),
          ...resent.flatMap((target) => [target, ...(groups.get(target) ?? [])]),
        ];
        const dropAll = dropDead(kept) as string[];
        const want = changed ? dropAll : kept;
        const wantEither = changed === undefined && isDeepStrictEqual(next.raw[relsKey] ?? [], dropAll);
        if (!wantEither && !isDeepStrictEqual(next.raw[relsKey] ?? [], want)) {
          problems.push({
            property: '1 conservation',
            detail: `${instance.list} ${instance.id}: rels ${JSON.stringify(stored)} shown ${JSON.stringify([...shown])} sent ${JSON.stringify(resent)} → ${JSON.stringify(next.raw[relsKey])}, expected ${JSON.stringify(want)}`,
          });
        }
      }
      // 3: an existing ID continues only the same item: sent with that ID, or (without IDs) unchanged.
      if (sent && typeof sent.id !== 'string') {
        const readItem = seen.get(instance.id);
        const was = admin ? leafView(instance.api) : readItem ? leafView(readItem) : null;
        const now = leafView(asSent(sent, false));
        if (was !== null && was !== now && !(admin ? false : was === leafView(asSent(next.api, false)))) {
          problems.push({
            property: '3 ID integrity',
            detail: `${instance.list} ${instance.id} reused for other content: ${was} → ${now}`,
          });
        }
      } else if (
        sent &&
        sent.id !== instance.id &&
        !continuesByContent(instance, sent) &&
        !identicalSwap(instance, sent)
      ) {
        problems.push({
          property: '3 ID integrity',
          detail: `${instance.list} ${instance.id} reused for an item sent as ${String(sent.id)}`,
        });
      }
      continue;
    }
    // Gone: only with certainty (by ID: a list sent with IDs that leaves it out; without IDs: no equal item sent).
    if (hidden.length === 0 || sentIds.has(instance.id)) {
      if (
        sentIds.has(instance.id) &&
        !underNewItem.has(instance.id) &&
        sentInList.get(instance.id) === instance.list
      ) {
        problems.push({
          property: '1 conservation',
          detail: `${instance.list} ${instance.id} was sent by its ID, yet is gone`,
        });
      }
      continue;
    }
    const exactList = sentLists.get(instance.list);
    if (!exactList) {
      continue; // its parent was removed or replaced
    }
    const withIds = exactList.some((item) => 'id' in item);
    if (withIds) {
      continue;
    }
    // An admin-kind caller (admin API, admin token, pinned admin token) is never refused: an item continues only
    // when its key appears exactly once on each side; every other item is new. So only a unique match is kept.
    if (writesAll) {
      const view = fullView(instance.api);
      const storedTwins = before.filter(
        (other) => other.list === instance.list && fullView(other.api) === view,
      ).length;
      const sentTwins = exactList.filter((item) => fullView(item) === view).length;
      if (storedTwins === 1 && sentTwins === 1) {
        problems.push({
          property: '1 conservation',
          detail: `${instance.list} ${instance.id} (${view}) sent back once, unique, yet deleted with ${hidden.join(',')}`,
        });
      }
      continue;
    }
    const readItem = seen.get(instance.id);
    // A caller that did not see the stored items may replace a list it can write completely (every item new).
    const writable = (key: string) =>
      key !== w.card.old &&
      !(version && (key === w.card.extra || key === w.card.count || key === w.card.ratio));
    const completely =
      writesAll && Object.keys(instance.raw).every((key) => key.startsWith('__') || writable(key));
    if (!readItem && exactList.length > 0 && !admin && !completely) {
      problems.push({
        property: '1 conservation',
        detail: `${instance.list} ${instance.id} (unseen by the caller) deleted by a list sent without IDs, with ${hidden.join(',')}`,
      });
      continue;
    }
    const view = readItem ? fullView(readItem) : fullView(instance.api);
    if (exactList.some((item) => fullView(item) === view)) {
      problems.push({
        property: '1 conservation',
        detail: `${instance.list} ${instance.id} (${view}) sent back unchanged, yet deleted with ${hidden.join(',')}`,
      });
    }
  }
  return problems;
};

/** itemIds (REST responses) equal what is stored, place by place. */
export const itemIdsProblems = (response: Response, body: Json, after: Instance[]): Problem[] => {
  const data = isRecord(response.body) && isRecord(response.body.data) ? response.body.data : null;
  const tree = data && isRecord(data.itemIds) ? data.itemIds : null;
  if (!tree) {
    return [];
  }
  const problems: Problem[] = [];
  for (const [apiKey, nested] of COMPONENT_LISTS) {
    if (body[apiKey] === undefined) {
      continue;
    }
    const nodes = Array.isArray(tree[apiKey])
      ? listOf(tree[apiKey])
      : isRecord(tree[apiKey])
        ? [tree[apiKey]]
        : [];
    const stored = after.filter((instance) => instance.list === apiKey);
    if (nodes.map((node) => node.id).join() !== stored.map((instance) => instance.id).join()) {
      problems.push({
        property: '3 ID integrity',
        detail: `itemIds.${apiKey} ${JSON.stringify(nodes.map((node) => node.id))} ≠ stored ${JSON.stringify(stored.map((instance) => instance.id))}`,
      });
      continue;
    }
    if (nested) {
      nodes.forEach((node, index) => {
        const parent = stored[index];
        if (!parent || node[nested] === undefined) {
          return;
        }
        const subs = listOf(node[nested])
          .map((sub) => sub.id)
          .join();
        const storedSubs = after
          .filter((instance) => instance.list === `${apiKey}/${parent.id}/${nested}`)
          .map((instance) => instance.id)
          .join();
        if (subs !== storedSubs) {
          problems.push({
            property: '3 ID integrity',
            detail: `itemIds.${apiKey}[${index}].${nested} ${subs} ≠ stored ${storedSubs}`,
          });
        }
      });
    }
  }
  return problems;
};

/** Multi-locale (7): shared lists hold the same IDs in every locale's draft; another locale's localized list is untouched. */
export const localeProblems = (
  w: World,
  before: Head[],
  after: Head[],
  written: string,
  body: Json = {},
): Problem[] => {
  const problems: Problem[] = [];
  // A write that adds a locale starts from the shared values: every shared field it does not send keeps them.
  const source = before.find((head) => head.locale === 'en' && head.state === 'draft');
  const added = after.find((head) => head.locale === written && head.state === 'draft');
  if (written !== 'en' && !before.some((head) => head.locale === written) && source && added) {
    for (const apiKey of ['cards', 'hero', 'zone', 'secretCard'] as const) {
      if (
        body[apiKey] === undefined &&
        !isDeepStrictEqual(added.data[w.doc[apiKey]], source.data[w.doc[apiKey]])
      ) {
        problems.push({
          property: '7 multi-locale',
          detail: `a new ${written} draft does not keep the shared ${apiKey}: ${differences(source.data[w.doc[apiKey]], added.data[w.doc[apiKey]]).slice(0, 2).join('; ')}`,
        });
      }
    }
  }
  const drafts = after.filter((head) => head.state === 'draft');
  const idsOf = (value: unknown) =>
    listOf(value)
      .map((item) => (typeof item.__id === 'string' ? item.__id : '-'))
      .join();
  const shared = new Set(drafts.map((head) => idsOf(head.data[w.doc.cards])));
  if (
    shared.size > 1 &&
    drafts.every((head) => listOf(head.data[w.doc.cards]).every((item) => typeof item.__id === 'string'))
  ) {
    problems.push({
      property: '7 multi-locale',
      detail: `shared cards IDs differ across locales: ${[...shared].join(' | ')}`,
    });
  }
  for (const head of before.filter((candidate) => candidate.locale !== written)) {
    const now = after.find((candidate) => candidate.locale === head.locale && candidate.state === head.state);
    if (now && !isDeepStrictEqual(now.data[w.doc.lchips], head.data[w.doc.lchips])) {
      problems.push({
        property: '7 multi-locale',
        detail: `${head.locale}/${head.state} localized lchips changed by a write to ${written}`,
      });
    }
  }
  return problems;
};

/** Refused writes write nothing; no 5xx. */
export const refusalProblems = (response: Response, before: Head[], after: Head[]): Problem[] => {
  const problems: Problem[] = [];
  if (response.status >= 500) {
    problems.push({
      property: '4 order and status',
      detail: `${response.status}: ${response.raw.slice(0, 200)}`,
    });
  }
  const { accepted } = outcomeOf(response);
  if (
    !accepted &&
    !isDeepStrictEqual(
      before.map((head) => [head.locale, head.state, head.data, head.version]),
      after.map((head) => [head.locale, head.state, head.data, head.version]),
    )
  ) {
    problems.push({
      property: '4 order and status',
      detail: `refused (${response.status}) yet the entry changed`,
    });
  }
  return problems;
};

/** A response with what the caller cannot see factored out: status, code, issues, and itemIds' shape. */
export const answerShape = (response: Response, knownIds: ReadonlySet<string>) => {
  const outcome = outcomeOf(response);
  const data = isRecord(response.body) && isRecord(response.body.data) ? response.body.data : null;
  const shape = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(shape)
      : isRecord(value)
        ? Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [
              key,
              key === 'id' && typeof entry === 'string'
                ? knownIds.has(entry)
                  ? entry
                  : 'new'
                : shape(entry),
            ]),
          )
        : value;
  return { ...outcome, itemIds: data ? shape(data.itemIds ?? null) : null };
};

/** Round trip (5): sending back exactly what was read changes nothing, makes no revision, fires no event. */
export const roundTripProblems = async (
  w: World,
  caller: Caller,
  entryId: string,
  locale: string,
  version: boolean,
): Promise<Problem[]> => {
  const read = await readAs(w, caller, entryId, locale, version);
  const heads = await headsOf(w, entryId);
  const draft = heads.find((head) => head.locale === locale && head.state === 'draft');
  const published = heads.find((head) => head.locale === locale && head.state === 'published');
  if (
    !read ||
    !draft ||
    (!caller.readsDraft && (!published || !isDeepStrictEqual(draft.data, published.data)))
  ) {
    return [];
  }
  // What it read, but top-level fields its write grant does not name (the limited caller's title).
  // The limited caller's write grant names only cards, lchips, hero and zone (403 for the rest: delivery-api.md:715).
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
  const body = asSent(
    Object.fromEntries(
      Object.entries(read).filter(
        ([key]) => !META.has(key) && key !== 'itemIds' && !unwritable.includes(key),
      ),
    ),
    true,
    true,
  );
  const revisions = await revisionCount(w, entryId);
  const events = await eventCount(w, entryId);
  const transport = caller.kind === 'admin' ? 'adminApi' : 'rest';
  // A delivery read shows no version: the client learns it from its last write, or from a 409's
  // `details.currentVersion` (the admin API's read shows it).
  let expectedVersion: number | null = caller.kind === 'admin' ? draft.version : null;
  if (expectedVersion === null) {
    const probe = await send(w, { caller, transport, entryId, locale, version, expectedVersion: null, body });
    const details =
      isRecord(probe.body) && isRecord(probe.body.error) && isRecord(probe.body.error.details)
        ? probe.body.error.details
        : {};
    if (probe.status !== 409 || typeof details.currentVersion !== 'number') {
      return [
        {
          property: '5 round trip',
          detail: `${caller.name}${version ? '@V' : ''}: a write naming no version answered ${probe.status} ${probe.raw.slice(0, 160)}, not a 409 with currentVersion`,
        },
      ];
    }
    expectedVersion = details.currentVersion;
  }
  const response = await send(w, { caller, transport, entryId, locale, version, expectedVersion, body });
  const problems: Problem[] = [];
  if (refusedForMissingTarget(response)) {
    return problems; // decision (c): the echoed target no longer exists; main refuses it the same way
  }
  if (response.status >= 300) {
    problems.push({
      property: '5 round trip',
      detail: `${caller.name}${version ? '@V' : ''} sent back what it read: ${response.status} ${response.raw.slice(0, 300)}`,
    });
    return problems;
  }
  const after = await headsOf(w, entryId);
  // Decision (a): an admin-kind caller sending back a delivery read replaces the relation targets and media the
  // read left out (as on main); everything else must stay.
  const adminKind = caller.kind === 'admin' || caller.kind === 'adminToken' || caller.kind === 'pinned';
  // When the write dropped targets the read hid, it is a real change and stores the items' IDs with it.
  const relationsChanged =
    adminKind &&
    after.some((head) =>
      targetsOnlyChanged(
        w,
        heads.find((old) => old.locale === head.locale && old.state === head.state)?.data,
        head.data,
      ),
    );
  const comparable = (data: unknown): unknown =>
    adminKind ? stripRelationsAndMedia(w, relationsChanged ? withoutItemIds(data) : data) : data;
  const changed = after.filter(
    (head) =>
      !isDeepStrictEqual(
        comparable(head.data),
        comparable(heads.find((old) => old.locale === head.locale && old.state === head.state)?.data),
      ),
  );
  if (changed.length > 0) {
    const was = heads.find(
      (old) => old.locale === changed[0]?.locale && old.state === changed[0]?.state,
    )?.data;
    problems.push({
      property: '5 round trip',
      detail: `${caller.name}${version ? '@V' : ''}: sending back what it read changed ${changed.map((head) => `${head.locale}/${head.state}`).join(',')}: ${differences(was, changed[0]?.data).slice(0, 4).join('; ')}`,
    });
  }
  if (!relationsChanged && (await revisionCount(w, entryId)) !== revisions) {
    problems.push({
      property: '5 round trip',
      detail: `${caller.name}${version ? '@V' : ''}: a revision was made for an unchanged write`,
    });
  }
  if (!relationsChanged && (await eventCount(w, entryId)) !== events) {
    problems.push({
      property: '5 round trip',
      detail: `${caller.name}${version ? '@V' : ''}: an event fired for an unchanged write`,
    });
  }
  return problems;
};

/** Reads agree on IDs (3): REST, GraphQL, REST through V, and (for unchanged legacy items) draft and published. */
export const readAgreementProblems = async (w: World, entryId: string): Promise<Problem[]> => {
  const caller = w.callers.adminToken;
  const rest = await readAs(w, caller, entryId, 'en', false);
  const atV = await readAs(w, caller, entryId, 'en', true);
  if (!rest) {
    return [];
  }
  const ids = (read: Json | null) =>
    listOf(read?.cards)
      .map((card) => card.id)
      .join();
  const problems: Problem[] = [];
  if (ids(atV) !== ids(rest)) {
    problems.push({ property: '3 ID integrity', detail: `REST ${ids(rest)} vs REST@V ${ids(atV)}` });
  }
  const gql = await w.gql(
    `query ($id: ID!) { ${w.gqlNames.query}(id: $id, locale: "en") { cards { id } } }`,
    { id: entryId },
    caller.token,
    false,
  );
  const gqlCards =
    isRecord(gql.body) && isRecord(gql.body.data) && isRecord(gql.body.data.doc)
      ? listOf(gql.body.data.doc.cards)
      : null;
  if (gqlCards && gqlCards.map((card) => card.id).join() !== ids(rest)) {
    problems.push({
      property: '3 ID integrity',
      detail: `REST ${ids(rest)} vs GraphQL ${gqlCards.map((card) => card.id).join()}`,
    });
  }
  // Legacy items unchanged between the draft and the published head read with the same ID.
  const heads = await headsOf(w, entryId);
  const draft = heads.find((head) => head.locale === 'en' && head.state === 'draft');
  const published = heads.find((head) => head.locale === 'en' && head.state === 'published');
  const admin = await readAs(w, w.callers.admin, entryId, 'en', false);
  if (draft && published && admin) {
    const draftCards = listOf(draft.data[w.doc.cards]);
    const publishedCards = listOf(published.data[w.doc.cards]);
    const adminCards = listOf(admin.cards);
    const restCards = listOf(rest.cards);
    draftCards.forEach((card, index) => {
      const twin = publishedCards.findIndex((candidate) => isDeepStrictEqual(candidate, card));
      if (
        card.__id === undefined &&
        twin !== -1 &&
        publishedCards.filter((candidate) => isDeepStrictEqual(candidate, card)).length === 1
      ) {
        const draftId = adminCards[index]?.id;
        const publishedId = restCards[twin]?.id;
        if (draftId !== publishedId) {
          problems.push({
            property: '3 ID integrity',
            detail: `legacy item unchanged in draft and published reads as ${String(draftId)} / ${String(publishedId)}`,
          });
        }
      }
    });
  }
  return problems;
};

/** Where two stored values differ (JSON paths, with both values), for messages. */
export const differences = (a: unknown, b: unknown, path = ''): string[] => {
  if (isDeepStrictEqual(a, b)) {
    return [];
  }
  if (isRecord(a) && isRecord(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
      differences(a[key], b[key], `${path}/${key.slice(0, 8)}`),
    );
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.flatMap((item, index) => differences(item, b[index], `${path}/${index}`));
  }
  return [`${path || '/'}: ${JSON.stringify(a)?.slice(0, 60)} → ${JSON.stringify(b)?.slice(0, 60)}`];
};

/**
 * True when relation or media targets changed and nothing else did, stored item IDs aside (decision (a)): a
 * draft-capable caller's echo of a published read drops the draft-only targets, and that write stores the IDs.
 */
export const targetsOnlyChanged = (w: World, before: unknown, after: unknown): boolean =>
  !isDeepStrictEqual(withoutItemIds(before), withoutItemIds(after)) &&
  isDeepStrictEqual(
    stripRelationsAndMedia(w, withoutItemIds(before)),
    stripRelationsAndMedia(w, withoutItemIds(after)),
  );

const withoutItemIds = (data: unknown): unknown =>
  Array.isArray(data)
    ? data.map(withoutItemIds)
    : isRecord(data)
      ? Object.fromEntries(
          Object.entries(data)
            .filter(([key]) => key !== '__id')
            .map(([key, value]) => [key, withoutItemIds(value)]),
        )
      : data;

/** Stored data without relation and media values inside components (decision (a)). */
const stripRelationsAndMedia = (w: World, data: unknown): unknown =>
  Array.isArray(data)
    ? data.map((item) => stripRelationsAndMedia(w, item))
    : isRecord(data)
      ? Object.fromEntries(
          Object.entries(data)
            .filter(([key]) => !RELATION_OR_MEDIA.has(w.apiKeyOf.get(key) ?? ''))
            .map(([key, value]) => [key, stripRelationsAndMedia(w, value)]),
        )
      : data;
