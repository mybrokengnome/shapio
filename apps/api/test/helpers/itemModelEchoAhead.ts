import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { expectStatus } from './content.js';
import { entryState, stripKeys } from './itemModelProbes.js';
import {
  idUniqueness,
  legacyOf,
  readAs,
  refusedForMissingTarget,
  send,
  storeHeads,
  type Problem,
} from './itemModelRun.js';
import { headsOf, type Caller, type World } from './itemModelWorld.js';

type Json = Record<string, unknown>;

/**
 * ECHOAHEAD (review 9): how old clients really save. They GET an entry, change one field, and PUT the whole
 * `data` back as read; on 0.9 that read carries `id`s, so a client that has never heard of IDs sends them.
 *
 * The rule: an item ID the draft lacks but a head the caller may read shows (the published head, while the draft
 * is ahead) is accepted as a new item in a list that holds nothing hidden from the caller, and refused with the
 * "replaces items this caller cannot read" issue (`AMBIGUOUS_ITEMS`) in a list that can hold hidden values. An ID
 * from nowhere stays `UNKNOWN_ITEM_ID`. Every component in the doc model has a private field, so for app users
 * every list can hold hidden values; nothing is hidden from an admin-kind caller (decision (a)).
 */

/** Where the draft is ahead of the published head (or how the entry was saved). */
export type AheadKind = 'item' | 'nested' | 'single' | 'zone' | 'equal' | 'never' | 'twoLocales';
export const AHEAD_KINDS: readonly AheadKind[] = [
  'item',
  'nested',
  'single',
  'zone',
  'equal',
  'never',
  'twoLocales',
];

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const BASE = {
  title: 't',
  cards: [
    { heading: 'A', note: 'n', chips: [{ zv: 'a', zh: 'h' }] },
    { heading: 'B', chips: [] },
  ],
  lchips: [{ zv: 'l', zh: 'lh' }],
  hero: { label: 'L', items: [{ zv: 'i', zh: 'ih' }] },
  zone: [{ __component: 'tag', label: 'Z', tnote: 'tn' }],
};

/** The admin's draft edit that puts the draft ahead, on the admin view (items keep their IDs). */
const aheadEdit = (kind: AheadKind, data: Json): Json => {
  const cards = (data.cards as Json[]) ?? [];
  switch (kind) {
    case 'item':
      return { cards: cards.map((card, index) => (index === 1 ? { ...card, heading: 'B2' } : card)) };
    case 'nested':
      return {
        cards: cards.map((card, index) =>
          index === 0
            ? { ...card, chips: ((card.chips as Json[]) ?? []).map((chip) => ({ ...chip, zv: 'a2' })) }
            : card,
        ),
      };
    case 'single':
      return { hero: { ...(data.hero as Json), label: 'L2' } };
    case 'zone':
      return { zone: ((data.zone as Json[]) ?? []).map((item) => ({ ...item, label: 'Z2' })) };
    case 'twoLocales':
      return { lchips: ((data.lchips as Json[]) ?? []).map((chip) => ({ ...chip, zv: 'f2' })) };
    default:
      return {};
  }
};

/**
 * An entry saved by main (no stored item IDs, `legacy`) whose draft is ahead of the published head in one place,
 * owned by `ownerId` when given. Returns the entry and the locale to echo in.
 */
export const aheadEntry = async (
  w: World,
  kind: AheadKind,
  { legacy = 'all', ownerId }: { legacy?: 'all' | 'partial' | 'with'; ownerId?: string },
) => {
  const id = expectStatus(
    await w.admin.post(`/api/admin/content/${w.docKey}?locale=en`, { locale: 'en', data: BASE }),
    201,
  ).json<{ id: string }>().id;
  const locale = kind === 'twoLocales' ? 'fr' : 'en';
  if (kind === 'twoLocales') {
    expectStatus(
      await w.admin.put(`/api/admin/content/${w.docKey}/${id}?locale=fr`, {
        locale: 'fr',
        expectedVersion: null,
        data: { title: 'fr', lchips: [{ zv: 'f', zh: 'fh' }] },
      }),
      200,
    );
  }
  if (w.draftAndPublish && kind !== 'never') {
    expectStatus(
      await w.admin.post(`/api/admin/content/${w.docKey}/${id}/publish`, {
        locales: kind === 'twoLocales' ? ['en', 'fr'] : ['en'],
      }),
      200,
    );
    const edit = (
      await w.request('GET', `/api/admin/content/${w.docKey}/${id}?locale=${locale}`, w.adminToken)
    ).body as Json;
    const change = aheadEdit(kind, (edit.data as Json) ?? {});
    if (Object.keys(change).length > 0) {
      expectStatus(
        await w.admin.put(`/api/admin/content/${w.docKey}/${id}?locale=${locale}`, {
          locale,
          expectedVersion: edit.version,
          data: change,
        }),
        200,
      );
    }
  }
  if (ownerId) {
    await w.db.updateTable('entries').set({ owner_app_user_id: ownerId }).where('id', '=', id).execute();
  }
  await storeHeads(w, id, (head) => legacyOf(head.data, legacy, 9));
  return { id, locale };
};

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
  'itemIds',
]);

/** Top-level fields the limited caller's write grant does not name (delivery-api.md:715). */
const LIMITED_UNWRITABLE = [
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
];

/** The whole read as a client sends it back: media as their IDs, item `id`s kept, meta left out. */
export const wholeEcho = (caller: Caller, read: Json): Json => {
  const media = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(media)
      : isRecord(value)
        ? typeof value.id === 'string' && typeof value.mimeType === 'string'
          ? value.id
          : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, media(entry)]))
        : value;
  const unwritable = caller.name === 'limited' ? LIMITED_UNWRITABLE : [];
  return media(
    Object.fromEntries(Object.entries(read).filter(([key]) => !META.has(key) && !unwritable.includes(key))),
  ) as Json;
};

/** The one-field change the client makes: the title, or (when it cannot write it) the first card's heading. */
const editOne = (body: Json): { body: Json; landed: (draft: Json) => boolean } => {
  if (typeof body.title === 'string') {
    const title = `${body.title}~echo`;
    return { body: { ...body, title }, landed: (draft) => draft.title === title };
  }
  const cards = Array.isArray(body.cards) ? (body.cards as Json[]) : [];
  if (cards.length > 0) {
    const heading = `${String(cards[0]?.heading)}~echo`;
    return {
      body: { ...body, cards: cards.map((card, index) => (index === 0 ? { ...card, heading } : card)) },
      landed: (draft) => (draft.cards as Json[] | undefined)?.[0]?.heading === heading,
    };
  }
  return { body, landed: () => true };
};

const UNSEEN = /^replaces items this caller cannot read/;

type Answer = Awaited<ReturnType<typeof send>>;
const issuesOf = (response: Answer): Array<{ path: string; code: string; message: string }> => {
  const body = response.body as Json | null;
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const details = error && isRecord(error.details) ? error.details : null;
  return details && Array.isArray(details.issues)
    ? (details.issues as Json[]).map((issue) => ({
        path: String(issue.path),
        code: String(issue.code),
        message: String(issue.message),
      }))
    : [];
};

/**
 * One old-client save: read (the caller's default view, or the draft view where it may read drafts), change one
 * field, PUT the whole read back with its `id`s; then the same with one item's `id` from nowhere.
 */
export const echoAheadProblems = async (
  w: World,
  caller: Caller,
  entryId: string,
  {
    locale,
    version,
    view,
    kind,
  }: { locale: string; version: boolean; view: 'default' | 'draft'; kind: AheadKind },
): Promise<Problem[]> => {
  if (!caller.reads || !caller.updates) {
    return [];
  }
  const label = `${caller.name}${version ? '@V' : ''} ${view} ${kind}`;
  const read =
    view === 'draft'
      ? await (async () => {
          const query = `?locale=${locale}&publicationState=draft${version || caller.pinned ? `&schemaVersion=${encodeURIComponent(w.versionToken)}` : ''}`;
          const response = await w.request(
            'GET',
            `/api/content/${w.docPlural}/${entryId}${query}`,
            caller.token,
          );
          return response.status === 200 && isRecord(response.body) && isRecord(response.body.data)
            ? response.body.data
            : null;
        })()
      : await readAs(w, caller, entryId, locale, version);
  if (!read) {
    return [];
  }
  const adminKind = caller.kind === 'admin' || caller.kind === 'adminToken' || caller.kind === 'pinned';
  const draftVersion = async () =>
    (await headsOf(w, entryId)).find((head) => head.locale === locale && head.state === 'draft')?.version ??
    null;
  const { body, landed } = editOne(wholeEcho(caller, read));
  const problems: Problem[] = [];
  const before = await entryState(w, entryId);
  const save = async (data: Json) =>
    send(w, {
      caller,
      transport: caller.kind === 'admin' ? 'adminApi' : 'rest',
      entryId,
      locale,
      version,
      expectedVersion: await draftVersion(),
      body: data,
    });
  // schema-lenses.md:318: through V, a field read-only while the draft is ahead is refused NOT_ALLOWED; the
  // client then sends the body without it, and that must be answered on its merits.
  const saveAsClient = async (data: Json) => {
    const first = await save(data);
    const readOnly = issuesOf(first).filter((issue) => issue.code === 'NOT_ALLOWED');
    const keys = [...new Set(readOnly.map((issue) => issue.path.split('/').at(-1) ?? ''))];
    if (
      version &&
      readOnly.length > 0 &&
      readOnly.length === issuesOf(first).length &&
      keys.every((key) => ['count', 'old', 'rmv'].includes(key))
    ) {
      const without = stripKeys(data, keys) as Json;
      return { response: await save(without), sent: without };
    }
    return { response: first, sent: data };
  };
  const { response, sent } = await saveAsClient(body);
  const issues = issuesOf(response);
  if (refusedForMissingTarget(response)) {
    return problems; // decision (c)
  }
  if (response.status >= 300) {
    // Only the "replaces items this caller cannot read" refusal, and only for a caller from whom the list can
    // hide values; never UNKNOWN_ITEM_ID for an ID the caller read.
    const allowed =
      response.status === 422 &&
      !adminKind &&
      issues.length > 0 &&
      issues.every((issue) => issue.code === 'AMBIGUOUS_ITEMS' && UNSEEN.test(issue.message));
    const equalHeads = kind === 'equal' || kind === 'never';
    if (!allowed || equalHeads) {
      problems.push({
        property: '5 round trip (ECHOAHEAD)',
        detail: `${label}: the whole read sent back with one field changed answered ${response.status} ${issues.map((issue) => `${issue.code} ${issue.path}`).join(', ') || response.raw.slice(0, 200)}`,
      });
    }
    if (!isDeepStrictEqual(await entryState(w, entryId), before)) {
      problems.push({
        property: '4 order and status (ECHOAHEAD)',
        detail: `${label}: refused, yet the entry changed`,
      });
    }
  } else {
    const draft = (await headsOf(w, entryId)).find(
      (head) => head.locale === locale && head.state === 'draft',
    );
    const admin = await readAs(w, w.callers.admin, entryId, locale, false);
    if (!admin || !landed(admin)) {
      problems.push({
        property: '1 conservation (ECHOAHEAD)',
        detail: `${label}: accepted, but the change did not land`,
      });
    }
    problems.push(
      ...idUniqueness(draft ? [draft] : []).map((problem) => ({
        ...problem,
        detail: `${label}: ${problem.detail}`,
      })),
    );
  }
  // An ID from nowhere stays UNKNOWN_ITEM_ID. The stray item names only `heading`, so no field changed since V
  // is written through it (body refusals come first, decision (d)).
  const cards = Array.isArray(sent.cards) ? (sent.cards as Json[]) : [];
  if (cards.length > 0 && typeof cards[0]?.id === 'string') {
    const nowhere = randomUUID().replaceAll('-', '').slice(0, 12);
    const { response: stray } = await saveAsClient({
      ...sent,
      cards: cards.map((card, index) => (index === 0 ? { id: nowhere, heading: 'stray' } : card)),
    });
    // Review 11: on the admin API, and for a caller that may read drafts (nothing is hidden from it), an id no
    // head shows is a new item; for an app user, whose card list can hold values hidden from it, it stays
    // UNKNOWN_ITEM_ID.
    const wanted = adminKind
      ? stray.status < 300
      : issuesOf(stray).some((issue) => issue.code === 'UNKNOWN_ITEM_ID');
    if (!wanted) {
      problems.push({
        property: '3 ID integrity (ECHOAHEAD)',
        detail: `${label}: an item id from nowhere answered ${stray.status} ${stray.raw.slice(0, 200)}, not ${adminKind ? 'accepted as a new item' : 'UNKNOWN_ITEM_ID'}`,
      });
    }
  }
  return problems;
};
