import { expectStatus } from './content.js';
import { stripKeys } from './itemModelProbes.js';
import { idUniqueness, legacyOf, storeHeads, type Problem } from './itemModelRun.js';
import { headsOf, type Caller, type World } from './itemModelWorld.js';

type Json = Record<string, unknown>;

const issuesOf = (response: { body: unknown }): Array<{ code: string; path: string }> => {
  const body = response.body;
  return isRecord(body) && isRecord(body.error) && isRecord(body.error.details)
    ? ((body.error.details.issues as Json[] | undefined) ?? []).map((issue) => ({
        code: String(issue.code),
        path: String(issue.path),
      }))
    : [];
};

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * STALERETRY (review 11): a client reads (ids included); another writer changes a list of the same entry so the
 * change reaches every head; the client's write of its old body gets 409, and it retries the same body with the
 * version the 409 named (last writer wins), as clients do.
 *
 * The rule: an `id` no head shows is a new item where the list holds nothing hidden from the caller, for callers
 * that may read drafts, and on the admin API; it stays `UNKNOWN_ITEM_ID` on a list whose items can hold values
 * hidden from the caller, and `AMBIGUOUS_ITEMS` is allowed when the caller cannot see the draft it writes.
 */
export type StaleWay = 'adminNoIds' | 'deleteItem' | 'otherClientNoIds' | 'editWithIds';
export const STALE_WAYS: readonly StaleWay[] = [
  'adminNoIds',
  'deleteItem',
  'otherClientNoIds',
  'editWithIds',
];
/** Where the other writer changes the list: a list of cards, a localized list, a nested list, a single
 * component's list (doc-like models; each component has a private field), and `links` on `plain` (nothing hidden). */
export type StaleList = 'cards' | 'lchips' | 'chips' | 'heroItems' | 'links';
export const STALE_LISTS: readonly StaleList[] = ['cards', 'lchips', 'chips', 'heroItems', 'links'];

const strip = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(strip)
    : isRecord(value)
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== 'id')
            .map(([key, entry]) => [key, strip(entry)]),
        )
      : value;

/** The list `list` names in `data`, changed by `change`, as a top-level patch. */
const patchList = (list: StaleList, data: Json, change: (items: Json[]) => Json[]): Json => {
  const items = (value: unknown) => (Array.isArray(value) ? (value as Json[]) : []);
  switch (list) {
    case 'chips':
      return {
        cards: items(data.cards).map((card, at) =>
          at === 0 ? { ...card, chips: change(items(card.chips)) } : card,
        ),
      };
    case 'heroItems':
      return {
        hero: { ...(data.hero as Json), items: change(items((data.hero as Json | undefined)?.items)) },
      };
    default:
      return { [list]: change(items(data[list])) };
  }
};

/** The first item with its text field changed. */
const editFirst = (items: Json[]): Json[] =>
  items.map((item, at) => {
    if (at !== 0) {
      return item;
    }
    const key = 'heading' in item ? 'heading' : 'label' in item ? 'label' : 'zv';
    return { ...item, [key]: `${String(item[key])}*` };
  });

export const staleRetryProblems = async (
  w: World,
  caller: Caller,
  {
    list,
    way,
    publish,
    version,
    legacy,
  }: { list: StaleList; way: StaleWay; publish: boolean; version: boolean; legacy: 'all' | 'with' },
): Promise<Problem[]> => {
  const plain = list === 'links';
  const key = plain ? 'plain' : w.docKey;
  const plural = plain ? 'plains' : w.docPlural;
  const drafts = plain || w.draftAndPublish;
  const viaV = version && !plain;
  const label = `${caller.name}${viaV ? '@V' : ''} ${key} ${list} ${way}${publish ? ' +publish' : ''} ${legacy}`;
  const data = plain
    ? { title: 't', links: [{ label: 'A' }, { label: 'B' }], one: { label: 'O' } }
    : {
        title: 't',
        cards: [
          { heading: 'A', note: 'n', chips: [{ zv: 'a', zh: 'h' }, { zv: 'b' }] },
          { heading: 'B', chips: [] },
        ],
        lchips: [{ zv: 'l' }, { zv: 'm' }],
        hero: { label: 'L', items: [{ zv: 'i' }, { zv: 'j' }] },
      };
  const id = expectStatus(
    await w.admin.post(`/api/admin/content/${key}?locale=en`, { locale: 'en', data }),
    201,
  ).json<{
    id: string;
  }>().id;
  if (caller.ownOnly) {
    await w.db
      .updateTable('entries')
      .set({ owner_app_user_id: caller.userId })
      .where('id', '=', id)
      .execute();
  }
  if (drafts) {
    expectStatus(await w.admin.post(`/api/admin/content/${key}/${id}/publish`, { locales: ['en'] }), 200);
  }
  await storeHeads(w, id, (head) => legacyOf(head.data, legacy, 11));
  const query = `?locale=en${viaV && !caller.pinned ? `&schemaVersion=${encodeURIComponent(w.versionToken)}` : ''}`;
  const adminView = async () =>
    (await w.request('GET', `/api/admin/content/${key}/${id}?locale=en`, w.adminToken)).body as Json;
  const versionSeen = (await adminView()).version as number;
  // A reads.
  const read =
    caller.kind === 'admin'
      ? ((await adminView()).data as Json)
      : ((await w.request('GET', `/api/content/${plural}/${id}${query}`, caller.token)).body as Json).data;
  if (!isRecord(read)) {
    return [];
  }
  const fields = plain ? ['links'] : ['cards', 'lchips', 'hero'];
  const body: Json = {
    title: `${String(read.title)}!`,
    ...Object.fromEntries(fields.filter((field) => field in read).map((field) => [field, read[field]])),
  };
  // B changes the list so the change reaches every head.
  const before = await adminView();
  const current = before.data as Json;
  const change =
    way === 'adminNoIds'
      ? { body: strip(patchList(list, current, editFirst)) as Json, route: 'admin' as const }
      : way === 'deleteItem'
        ? { body: patchList(list, current, (items) => items.slice(0, 1)), route: 'admin' as const }
        : way === 'editWithIds'
          ? { body: patchList(list, current, editFirst), route: 'admin' as const }
          : // Another client without ids: it edits an item where the list holds nothing hidden; elsewhere it may
            // only delete one (an edit without ids is refused there, upgrades.md:48-50).
            {
              // (In a nested list it keeps the outer items' ids: a nested change without them is refused.)
              body:
                list === 'chips'
                  ? patchList(list, current, (items) => strip(items.slice(0, 1)) as Json[])
                  : (strip(
                      patchList(list, current, plain ? editFirst : (items) => items.slice(0, 1)),
                    ) as Json),
              route: 'client' as const,
            };
  const changed =
    change.route === 'admin'
      ? await w.admin.put(`/api/admin/content/${key}/${id}?locale=en`, {
          locale: 'en',
          expectedVersion: before.version,
          data: change.body,
        })
      : await w.request('PUT', `/api/content/${plural}/${id}?locale=en`, w.adminToken, {
          locale: 'en',
          expectedVersion: before.version,
          data: change.body,
        });
  const changedStatus = 'statusCode' in changed ? changed.statusCode : changed.status;
  if (changedStatus !== 200) {
    throw new Error(
      `${label}: the other writer's save answered ${changedStatus} ${'statusCode' in changed ? changed.body : changed.raw}`,
    );
  }
  if (drafts && publish) {
    expectStatus(await w.admin.post(`/api/admin/content/${key}/${id}/publish`, { locales: ['en'] }), 200);
  }
  // A writes its old body, then retries it with the version the 409 named.
  const put = (expectedVersion: unknown, data: Json = body) =>
    caller.kind === 'admin'
      ? w.request('PUT', `/api/admin/content/${key}/${id}?locale=en`, caller.token, {
          locale: 'en',
          expectedVersion,
          data,
        })
      : w.request('PUT', `/api/content/${plural}/${id}${query}`, caller.token, {
          locale: 'en',
          expectedVersion,
          data,
        });
  const first = await put(versionSeen);
  const problems: Problem[] = [];
  if (first.status !== 409) {
    problems.push({
      property: '8 concurrency (STALERETRY)',
      detail: `${label}: the stale write answered ${first.status}, not 409`,
    });
    return problems;
  }
  const error = isRecord(first.body) && isRecord(first.body.error) ? first.body.error : {};
  const currentVersion = isRecord(error.details) ? error.details.currentVersion : undefined;
  let retry = await put(currentVersion);
  // schema-lenses.md:318: through V, a field changed since V is refused NOT_ALLOWED on an item that is new now; the
  // client resends without it, and that is answered on its merits.
  const refusedFields = issuesOf(retry);
  if (
    (viaV || (caller.pinned && !plain)) &&
    refusedFields.length > 0 &&
    refusedFields.every((issue) => issue.code === 'NOT_ALLOWED' && /\/(count|old|rmv)$/.test(issue.path))
  ) {
    retry = await put(currentVersion, stripKeys(body, ['count', 'old', 'rmv']) as Json);
  }
  const heads = await headsOf(w, id);
  const draft = heads.find((head) => head.locale === 'en' && head.state === 'draft');
  const published = heads.find((head) => head.locale === 'en' && head.state === 'published');
  if (retry.status < 300) {
    problems.push(
      ...idUniqueness(draft ? [draft] : []).map((problem) => ({
        ...problem,
        detail: `${label}: ${problem.detail}`,
      })),
    );
    return problems;
  }
  const issues = issuesOf(retry);
  const adminKind = caller.kind === 'admin' || caller.kind === 'adminToken' || caller.kind === 'pinned';
  // Doc-like components all hold a private field; `links` holds nothing hidden.
  const hiddenHere = !adminKind && !plain;
  const stored = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stored)
      : isRecord(value)
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([field]) => field !== '__id')
              .map(([field, entry]) => [field, stored(entry)]),
          )
        : value;
  const strippedEqual =
    JSON.stringify(stored(draft?.data ?? {})) === JSON.stringify(stored(published?.data ?? {}));
  const seesDraft = adminKind || !drafts || strippedEqual;
  const shownElsewhere = drafts && !publish;
  const allowed =
    retry.status === 422 &&
    issues.length > 0 &&
    issues.every(
      (issue) =>
        // Review 11 rule: on a list that can hold hidden values, UNKNOWN_ITEM_ID when no head shows the id (the
        // change reached every head: it was published, or the model has no drafts), AMBIGUOUS_ITEMS when the
        // caller cannot see the draft and the published head still shows it. An edit with ids keeps them.
        way !== 'editWithIds' &&
        hiddenHere &&
        ((issue.code === 'UNKNOWN_ITEM_ID' && !shownElsewhere) ||
          (issue.code === 'AMBIGUOUS_ITEMS' && !seesDraft && shownElsewhere)),
    );
  if (!allowed) {
    problems.push({
      property: '8 concurrency (STALERETRY)',
      detail: `${label}: the retry with currentVersion answered ${retry.status} ${issues.map((issue) => `${issue.code} ${issue.path}`).join(', ') || retry.raw.slice(0, 200)}`,
    });
  }
  return problems;
};

/**
 * Review 11 (low): with ids sent, reordering a shared list that holds two identical items, so the content order is
 * unchanged, changes nothing: other locales are not marked modified (main: no change).
 */
export const twinReorderProblems = async (
  w: World,
  caller: Caller,
  /** The two cards differ in a stored value (a private note): then the swap is a change. */
  differ = false,
): Promise<Problem[]> => {
  const id = expectStatus(
    await w.admin.post(`/api/admin/content/${w.docKey}?locale=en`, {
      locale: 'en',
      data: {
        title: 'en',
        cards: differ
          ? [
              { heading: 'X', note: 'a' },
              { heading: 'X', note: 'b' },
            ]
          : [{ heading: 'X' }, { heading: 'X' }],
      },
    }),
    201,
  ).json<{ id: string }>().id;
  expectStatus(
    await w.admin.put(`/api/admin/content/${w.docKey}/${id}?locale=fr`, {
      locale: 'fr',
      expectedVersion: null,
      data: { title: 'fr' },
    }),
    200,
  );
  if (w.draftAndPublish) {
    expectStatus(
      await w.admin.post(`/api/admin/content/${w.docKey}/${id}/publish`, { locales: ['en', 'fr'] }),
      200,
    );
  }
  const view = async (locale: string) =>
    (await w.request('GET', `/api/admin/content/${w.docKey}/${id}?locale=${locale}`, w.adminToken))
      .body as Json;
  const read =
    caller.kind === 'admin'
      ? ((await view('en')).data as Json)
      : ((await w.request('GET', `/api/content/${w.docPlural}/${id}?locale=en`, caller.token)).body as Json)
          .data;
  if (!isRecord(read) || !Array.isArray(read.cards)) {
    return [];
  }
  const before = await headsOf(w, id);
  const frBefore = (await view('fr')).status;
  const sent = { cards: [...(read.cards as Json[])].reverse() };
  const draftVersion = before.find((head) => head.locale === 'en' && head.state === 'draft')?.version ?? null;
  const response =
    caller.kind === 'admin'
      ? await w.request('PUT', `/api/admin/content/${w.docKey}/${id}?locale=en`, caller.token, {
          locale: 'en',
          expectedVersion: draftVersion,
          data: sent,
        })
      : await w.request('PUT', `/api/content/${w.docPlural}/${id}?locale=en`, caller.token, {
          locale: 'en',
          expectedVersion: draftVersion,
          data: sent,
        });
  const after = await headsOf(w, id);
  const fr = (heads: typeof before) =>
    heads.filter((head) => head.locale === 'fr').map((head) => [head.state, head.version, head.revision]);
  const problems: Problem[] = [];
  if (response.status >= 300) {
    problems.push({
      property: '9 no-op (TWINREORDER)',
      detail: `${caller.name}: answered ${response.status} ${response.raw.slice(0, 200)}`,
    });
  }
  const en = (heads: typeof before) =>
    heads.filter((head) => head.locale === 'en').map((head) => [head.state, head.version, head.revision]);
  const notes = (heads: typeof before) =>
    (
      (heads.find((head) => head.locale === 'en' && head.state === 'draft')?.data[w.doc.cards] as
        Json[] | undefined) ?? []
    ).map((card) => card[w.card.note]);
  if (differ) {
    // Look-alikes that differ in a stored value: the swap is a change, stored in the order sent.
    if (JSON.stringify(notes(after)) !== JSON.stringify([...notes(before)].reverse())) {
      problems.push({
        property: '4 order and status (LOOKSWAP)',
        detail: `${caller.name}: swapping look-alikes that differ in a stored value stored ${JSON.stringify(notes(after))}`,
      });
    }
    return problems;
  }
  // Identical in full stored content: a no-op in the writer's own locale on the admin API (it sees everything
  // stored); for a delivery caller the card list can hold values hidden from it (private `note`, deprecated
  // `old`), so a swap by id is always a change there (the response is not an oracle). The other locale is
  // untouched either way.
  const enChanged = JSON.stringify(en(after)) !== JSON.stringify(en(before));
  if (enChanged !== (caller.kind !== 'admin')) {
    problems.push({
      property: '9 no-op (TWINREORDER)',
      detail: `${caller.name}: reordering two identical shared items ${enChanged ? 'changed' : 'did not change'} the en heads ${JSON.stringify(en(before))} → ${JSON.stringify(en(after))}`,
    });
  }
  if (JSON.stringify(fr(after)) !== JSON.stringify(fr(before)) || (await view('fr')).status !== frBefore) {
    problems.push({
      property: '9 no-op (TWINREORDER)',
      detail: `${caller.name}: reordering two identical shared items changed the fr locale (status ${String(frBefore)} → ${String((await view('fr')).status)})`,
    });
  }
  return problems;
};
