import { isDeepStrictEqual } from 'node:util';
import { setPublicGrants } from './appUsers.js';
import { createDefinition, expectStatus, runContentSchemaJobs } from './content.js';
import { entryState } from './itemModelProbes.js';
import { readAs, send, type Problem } from './itemModelRun.js';
import {
  eventCount,
  headsOf,
  revisionCount,
  useModel as useModelKey,
  type Caller,
  type World,
} from './itemModelWorld.js';

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stripIds = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stripIds)
    : isRecord(value)
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== 'id')
            .map(([key, entry]) => [key, stripIds(entry)]),
        )
      : value;

/** Grants every caller (the public role) read and update on `modelId` while `run` runs. */
const withPublicReadUpdate = async <T>(w: World, modelId: string, run: () => Promise<T>): Promise<T> => {
  await setPublicGrants(w.db, [
    { action: 'read', modelId },
    { action: 'update', modelId },
  ]);
  try {
    return await run();
  } finally {
    await w.publicGrants(false);
  }
};

/** One ECHOCHURN case: a model, the entry it starts from, and the admin edits that churn one list's item ids. */
type ChurnCase = {
  name: string;
  key: string;
  plural: string;
  gqlType: string;
  /** Whether the churned list's items can hold values hidden from an app user (a private sub-field). */
  hidden: boolean;
  data: Json;
  /** A second locale's data (localized models), published with the first. */
  fr?: Json;
  /** Two admin saves without ids: the first changes the list, the second puts the same content back. */
  churn: [Json, Json];
  /** The fields the client sends back. */
  echo: string[];
};

/** The cases: doc lists and a single component's list whose items hold a private field (`hidden`), and lists and a
 * single component with nothing hidden (`plain.links`; on `churn`, a localized list, a shared list, and a single
 * component's list of `line`, which has only `label`). */
export const churnCases = async (w: World): Promise<ChurnCase[]> => {
  const line = w.components.line.definition.id;
  const cbox = await createDefinition(
    w.admin,
    {
      kind: 'component',
      apiKey: 'cbox',
      label: 'Cbox',
      fields: [
        { apiKey: 'label', label: 'Label', type: 'string' },
        {
          apiKey: 'lines',
          label: 'Lines',
          type: 'component',
          settings: { component: line, repeatable: true },
        },
      ],
    },
    'components',
  );
  await createDefinition(w.admin, {
    kind: 'collection',
    apiKey: 'churn',
    label: 'Churn',
    localized: true,
    fields: [
      { apiKey: 'title', label: 'Title', type: 'string', localized: true },
      {
        apiKey: 'llines',
        label: 'Llines',
        type: 'component',
        localized: true,
        settings: { component: line, repeatable: true },
      },
      {
        apiKey: 'slines',
        label: 'Slines',
        type: 'component',
        settings: { component: line, repeatable: true },
      },
      { apiKey: 'cbox', label: 'Cbox', type: 'component', settings: { component: cbox.definition.id } },
    ],
  });
  const cards = [
    { heading: 'A', note: 'n' },
    { heading: 'B', note: 'm' },
  ];
  const lines = (first: string) => [{ label: first }, { label: 'y' }];
  const churnData = {
    title: 'en',
    llines: lines('x'),
    slines: lines('x'),
    cbox: { label: 'C', lines: lines('x') },
  };
  const doc = { key: w.docKey, plural: w.docPlural, gqlType: 'Doc', hidden: true };
  const plain = { key: 'plain', plural: 'plains', gqlType: 'Plain', hidden: false };
  const churn = {
    key: 'churn',
    plural: 'churns',
    gqlType: 'Churn',
    hidden: false,
    fr: { title: 'fr', llines: lines('f') },
  };
  return [
    {
      ...doc,
      name: 'doc cards put back',
      data: { title: 't', cards, hero: { label: 'L', items: [{ zv: 'i' }, { zv: 'j' }] } },
      churn: [{ cards: [{ heading: 'A2', note: 'n' }, cards[1]] }, { cards }],
      echo: ['title', 'cards', 'hero'],
    },
    {
      ...doc,
      name: 'doc cards deleted and re-added',
      data: { title: 't', cards },
      churn: [{ cards: [cards[1]] }, { cards }],
      echo: ['title', 'cards'],
    },
    {
      ...doc,
      name: 'doc hero items put back',
      data: { title: 't', hero: { label: 'L', items: [{ zv: 'i' }, { zv: 'j' }] } },
      churn: [
        { hero: { label: 'L', items: [{ zv: 'i2' }, { zv: 'j' }] } },
        { hero: { label: 'L', items: [{ zv: 'i' }, { zv: 'j' }] } },
      ],
      echo: ['title', 'hero'],
    },
    {
      ...plain,
      name: 'plain links put back',
      data: { title: 't', links: lines('x') },
      churn: [{ links: lines('x2') }, { links: lines('x') }],
      echo: ['title', 'links'],
    },
    {
      ...plain,
      name: 'plain links deleted and re-added',
      data: { title: 't', links: lines('x') },
      churn: [{ links: [{ label: 'y' }] }, { links: lines('x') }],
      echo: ['title', 'links'],
    },
    {
      ...churn,
      name: 'localized list put back',
      data: churnData,
      churn: [{ llines: lines('x2') }, { llines: lines('x') }],
      echo: ['title', 'llines', 'slines', 'cbox'],
    },
    {
      ...churn,
      name: 'shared list put back',
      data: churnData,
      churn: [{ slines: lines('x2') }, { slines: lines('x') }],
      echo: ['title', 'llines', 'slines', 'cbox'],
    },
    {
      ...churn,
      name: 'single component list put back',
      data: churnData,
      churn: [{ cbox: { label: 'C', lines: lines('x2') } }, { cbox: { label: 'C', lines: lines('x') } }],
      echo: ['title', 'llines', 'slines', 'cbox'],
    },
  ];
};

/** Every issue code in a REST or GraphQL error answer. */
const codesOf = (raw: string): string[] =>
  [...raw.matchAll(/"code":"([A-Z_]+)"/g)].map((match) => match[1] ?? '');

/**
 * ECHOCHURN (review 12): the draft holds the same content as the published version under other item ids (items
 * edited and put back without ids, or deleted and re-added). A caller that cannot see the draft (an app user,
 * anonymous, a GraphQL client) echoes the published read, ids included, three times. Where the list's items can
 * hold values hidden from it, the echo is refused with exactly AMBIGUOUS_ITEMS and nothing is written (the
 * documented answer); where nothing is hidden, nothing changes (no revision, no version change in any locale, no
 * event), as on main.
 */
export const echoChurnProblems = async (w: World, spec: ChurnCase): Promise<Problem[]> => {
  const id = expectStatus(
    await w.admin.post(`/api/admin/content/${spec.key}?locale=en`, { locale: 'en', data: spec.data }),
    201,
  ).json<{ id: string }>().id;
  if (spec.fr) {
    expectStatus(
      await w.admin.put(`/api/admin/content/${spec.key}/${id}?locale=fr`, {
        locale: 'fr',
        expectedVersion: null,
        data: spec.fr,
      }),
      200,
    );
  }
  expectStatus(
    await w.admin.post(`/api/admin/content/${spec.key}/${id}/publish`, {
      locales: spec.fr ? ['en', 'fr'] : ['en'],
    }),
    200,
  );
  for (const data of spec.churn) {
    const view = (await w.request('GET', `/api/admin/content/${spec.key}/${id}?locale=en`, w.adminToken))
      .body as Json;
    expectStatus(
      await w.admin.put(`/api/admin/content/${spec.key}/${id}?locale=en`, {
        locale: 'en',
        expectedVersion: view.version,
        data,
      }),
      200,
    );
  }
  const { model_id: modelId } = await w.db
    .selectFrom('entries')
    .select('model_id')
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  const state = async () => {
    const heads = await headsOf(w, id);
    return {
      heads: heads.map((head) => [head.locale, head.state, head.version, head.data]),
      revisions: await revisionCount(w, id),
      events: await eventCount(w, id),
    };
  };
  const problems: Problem[] = [];
  const echoers: Array<{ name: string; token: string | null; graphql: boolean }> = [
    { name: 'app user', token: w.callers.reader.token, graphql: false },
    { name: 'anonymous', token: null, graphql: false },
    { name: 'app user (GraphQL)', token: w.callers.reader.token, graphql: true },
  ];
  await withPublicReadUpdate(w, modelId, async () => {
    for (const echoer of echoers) {
      const read = (await w.request('GET', `/api/content/${spec.plural}/${id}?locale=en`, echoer.token))
        .body as Json;
      const data = isRecord(read.data) ? read.data : null;
      if (!data) {
        problems.push({
          property: '9 no-op (ECHOCHURN)',
          detail: `${spec.name}, ${echoer.name}: could not read the entry`,
        });
        continue;
      }
      const body = Object.fromEntries(
        spec.echo.filter((field) => field in data).map((field) => [field, data[field]]),
      );
      for (let round = 1; round <= 3; round += 1) {
        const before = await state();
        const draft = (await headsOf(w, id)).find((head) => head.locale === 'en' && head.state === 'draft');
        const response = echoer.graphql
          ? await w.gql(
              `mutation ($id: ID!, $v: Int, $data: ${spec.gqlType}Input, $locale: String) { update${spec.gqlType}(id: $id, expectedVersion: $v, data: $data, locale: $locale) { id version } }`,
              { id, v: draft?.version ?? null, data: body, locale: 'en' },
              echoer.token,
              false,
            )
          : await w.request('PUT', `/api/content/${spec.plural}/${id}?locale=en`, echoer.token, {
              locale: 'en',
              expectedVersion: draft?.version ?? null,
              data: body,
            });
        const after = await state();
        const refused = response.status >= 300 || /"errors"/.test(response.raw);
        const label = `${spec.name}, ${echoer.name}, echo ${round}`;
        if (!isDeepStrictEqual(after, before)) {
          problems.push({
            property: '9 no-op (ECHOCHURN)',
            detail: `${label}: ${refused ? 'refused, yet ' : ''}revisions ${before.revisions} → ${after.revisions}, events ${before.events} → ${after.events}${
              isDeepStrictEqual(
                after.heads.map((head) => head[2]),
                before.heads.map((head) => head[2]),
              )
                ? ''
                : ', a version changed'
            }`,
          });
          break;
        }
        if (spec.hidden) {
          const codes = new Set(codesOf(response.raw));
          const exactly =
            refused &&
            codes.has('AMBIGUOUS_ITEMS') &&
            [...codes].every((code) => code === 'AMBIGUOUS_ITEMS' || code === 'CONTENT_INVALID') &&
            (echoer.graphql || response.status === 422);
          if (!exactly) {
            problems.push({
              property: '9 no-op (ECHOCHURN)',
              detail: `${label}: answered ${response.status} ${response.raw.slice(0, 160)}, not exactly AMBIGUOUS_ITEMS`,
            });
            break;
          }
        } else if (refused) {
          problems.push({
            property: '9 no-op (ECHOCHURN)',
            detail: `${label}: answered ${response.status} ${response.raw.slice(0, 160)}`,
          });
          break;
        }
      }
    }
  });
  return problems;
};

/**
 * ECHOCHURN, admin API: a single component copied from another locale's read, twice. `hero` is shared (the
 * world has no localized single component), so the copy is what is stored: nothing changes, either time.
 */
export const adminSingleCopyProblems = async (w: World): Promise<Problem[]> => {
  const id = expectStatus(
    await w.admin.post(`/api/admin/content/${w.docKey}?locale=en`, {
      locale: 'en',
      data: { title: 't', hero: { label: 'L', items: [{ zv: 'i' }] } },
    }),
    201,
  ).json<{ id: string }>().id;
  expectStatus(
    await w.admin.put(`/api/admin/content/${w.docKey}/${id}?locale=fr`, {
      locale: 'fr',
      expectedVersion: null,
      data: { title: 'f' },
    }),
    200,
  );
  expectStatus(
    await w.admin.post(`/api/admin/content/${w.docKey}/${id}/publish`, { locales: ['en', 'fr'] }),
    200,
  );
  const problems: Problem[] = [];
  for (let round = 1; round <= 2; round += 1) {
    const fr = (await w.request('GET', `/api/admin/content/${w.docKey}/${id}?locale=fr`, w.adminToken))
      .body as Json;
    const en = (await w.request('GET', `/api/admin/content/${w.docKey}/${id}?locale=en`, w.adminToken))
      .body as Json;
    const before = await entryState(w, id);
    const response = await w.request('PUT', `/api/admin/content/${w.docKey}/${id}?locale=en`, w.adminToken, {
      locale: 'en',
      expectedVersion: en.version,
      data: { hero: (fr.data as Json).hero },
    });
    const after = await entryState(w, id);
    if (response.status >= 300 || !isDeepStrictEqual(after, before)) {
      problems.push({
        property: '9 no-op (ECHOCHURN)',
        detail: `admin API copy of hero from fr, round ${round}: ${response.status}, revisions ${before.revisions} → ${after.revisions}`,
      });
    }
  }
  return problems;
};

/**
 * TARGETSWAP (review 12): a caller that reads and writes every field of a list's items but cannot see some
 * relation targets swaps two look-alike items by id, once where their hidden targets are equal and once where they
 * differ. Both answer the same (status, body shape) and both are a change (the version moves), so the response is
 * not an oracle for the hidden targets.
 */
export const targetSwapProblems = async (w: World): Promise<Problem[]> => {
  const pair = await createDefinition(
    w.admin,
    {
      kind: 'component',
      apiKey: 'tspair',
      label: 'Tspair',
      fields: [
        { apiKey: 'label', label: 'Label', type: 'string' },
        {
          apiKey: 'rel',
          label: 'Rel',
          type: 'relation',
          settings: { target: w.models.thing.definition.id, cardinality: 'one' },
        },
      ],
    },
    'components',
  );
  const model = await createDefinition(w.admin, {
    kind: 'collection',
    apiKey: 'tswap',
    label: 'Tswap',
    fields: [
      {
        apiKey: 'pairs',
        label: 'Pairs',
        type: 'component',
        settings: { component: pair.definition.id, repeatable: true },
      },
    ],
  });
  const hiddenThing = expectStatus(
    await w.admin.post('/api/admin/content/thing', { data: { name: 'hidden2' } }),
    201,
  ).json<{ id: string }>().id;
  const problems: Problem[] = [];
  await withPublicReadUpdate(w, model.definition.id, async () => {
    const outcomes: Array<{ status: number; keys: string; moved: boolean }> = [];
    for (const differ of [false, true]) {
      const id = expectStatus(
        await w.admin.post('/api/admin/content/tswap', {
          data: {
            pairs: [
              { label: 'A', rel: w.things.draft },
              { label: 'A', rel: differ ? hiddenThing : w.things.draft },
            ],
          },
        }),
        201,
      ).json<{ id: string }>().id;
      expectStatus(await w.admin.post(`/api/admin/content/tswap/${id}/publish`, {}), 200);
      // Anonymous (the public role) may read and update tswap but cannot read things: the targets are hidden.
      const read = (await w.request('GET', `/api/content/tswaps/${id}`, null)).body as Json;
      const pairs = ((read.data as Json | undefined)?.pairs as Json[] | undefined) ?? [];
      const view = (await w.request('GET', `/api/admin/content/tswap/${id}`, w.adminToken)).body as Json;
      const response = await w.request('PUT', `/api/content/tswaps/${id}`, null, {
        expectedVersion: view.version,
        data: { pairs: [...pairs].reverse().map((item) => ({ id: item.id, label: item.label })) },
      });
      const after = (await w.request('GET', `/api/admin/content/tswap/${id}`, w.adminToken)).body as Json;
      const shape = (value: unknown): unknown =>
        Array.isArray(value)
          ? value.map(shape)
          : isRecord(value)
            ? Object.fromEntries(
                Object.keys(value)
                  .sort()
                  .map((key) => [key, shape(value[key])]),
              )
            : typeof value;
      outcomes.push({
        status: response.status,
        keys: JSON.stringify(shape(stripIds(response.body))),
        moved: after.version !== view.version,
      });
    }
    const [same, different] = outcomes;
    if (!same || !different || same.status !== different.status || same.keys !== different.keys) {
      problems.push({
        property: '2 no oracle (TARGETSWAP)',
        detail: `equal hidden targets ${JSON.stringify(same)}, different ${JSON.stringify(different)}`,
      });
    }
    for (const [label, outcome] of [
      ['equal', same],
      ['different', different],
    ] as const) {
      if (!outcome || outcome.status >= 300 || !outcome.moved) {
        problems.push({
          property: '4 order and status (TARGETSWAP)',
          detail: `${label} hidden targets: the swap by id answered ${String(outcome?.status)}, version ${outcome?.moved ? 'moved' : 'did not move'}`,
        });
      }
    }
  });
  return problems;
};

/**
 * COPYMOVE (review 13): items copied or moved with their ids, from another entry or another field of the same
 * entry. `h1`/`h2` hold `line` (nothing hidden); `p1`/`p2` hold `chip` (a private `zh`). For a caller that sees
 * the draft: on a list with nothing hidden, always accepted (as on main); on a list whose items can hold hidden
 * values, accepted when the write only adds items (every stored item still claimed by id or content), refused with
 * UNKNOWN_ITEM_ID when a stored item would be left unclaimed (the two replace cases), and nothing is written then.
 */
export type CopyMoveVariant = 'otherReplace' | 'otherAppend' | 'fieldReplace' | 'fieldAppend' | 'move';
export const COPY_MOVE_VARIANTS: readonly CopyMoveVariant[] = [
  'otherReplace',
  'otherAppend',
  'fieldReplace',
  'fieldAppend',
  'move',
];

export const copyMoveProblems = async (w: World): Promise<Problem[]> => {
  const line = w.components.line.definition.id;
  const chip = w.components.chip.definition.id;
  const model = await createDefinition(w.admin, {
    kind: 'collection',
    apiKey: 'cmove',
    label: 'Cmove',
    fields: [
      { apiKey: 'title', label: 'Title', type: 'string' },
      ...['h1', 'h2'].map((apiKey) => ({
        apiKey,
        label: apiKey,
        type: 'component',
        settings: { component: line, repeatable: true },
      })),
      ...['p1', 'p2'].map((apiKey) => ({
        apiKey,
        label: apiKey,
        type: 'component',
        settings: { component: chip, repeatable: true },
      })),
    ],
  });
  const modelId = model.definition.id;
  const entry = async (name: string) => {
    const id = expectStatus(
      await w.admin.post('/api/admin/content/cmove', {
        data: {
          title: name,
          h1: [{ label: `${name}h1x` }, { label: `${name}h1y` }],
          h2: [{ label: `${name}h2x` }],
          p1: [
            { zv: `${name}p1x`, zh: `${name}1` },
            { zv: `${name}p1y`, zh: `${name}2` },
          ],
          p2: [{ zv: `${name}p2x`, zh: `${name}3` }],
        },
      }),
      201,
    ).json<{ id: string }>().id;
    expectStatus(await w.admin.post(`/api/admin/content/cmove/${id}/publish`, {}), 200);
    return id;
  };
  const problems: Problem[] = [];
  const callers = [
    { name: 'app user', token: w.callers.reader.token },
    { name: 'anonymous', token: null },
    // (No token can write without draft access: a delivery role grants only `read` and `readDrafts`, and an
    // admin-scope token always reads drafts.)
  ];
  await withPublicReadUpdate(w, modelId, async () => {
    for (const caller of callers) {
      for (const [x1, x2, hidden] of [
        ['h1', 'h2', false],
        ['p1', 'p2', true],
      ] as const) {
        for (const variant of COPY_MOVE_VARIANTS) {
          const target = await entry('a');
          const source = await entry('b');
          const readOf = async (id: string) =>
            ((await w.request('GET', `/api/content/cmoves/${id}`, caller.token)).body as Json).data as Json;
          const own = await readOf(target);
          const other = await readOf(source);
          const list = (data: Json, field: string) =>
            Array.isArray(data[field]) ? (data[field] as Json[]) : [];
          const body: Json =
            variant === 'otherReplace'
              ? { [x1]: list(other, x1) }
              : variant === 'otherAppend'
                ? { [x1]: [...list(own, x1), ...list(other, x1)] }
                : variant === 'fieldReplace'
                  ? { [x2]: list(own, x1) }
                  : variant === 'fieldAppend'
                    ? { [x2]: [...list(own, x2), ...list(own, x1)] }
                    : {
                        [x1]: list(own, x1).slice(1),
                        [x2]: [...list(own, x2), ...list(own, x1).slice(0, 1)],
                      };
          const before = await headsOf(w, target);
          const view = (await w.request('GET', `/api/admin/content/cmove/${target}`, w.adminToken))
            .body as Json;
          const response = await w.request('PUT', `/api/content/cmoves/${target}`, caller.token, {
            expectedVersion: view.version,
            data: body,
          });
          const label = `${caller.name} ${x1} ${variant}`;
          const refuse = hidden && (variant === 'otherReplace' || variant === 'fieldReplace');
          const codes = codesOf(response.raw);
          if (refuse) {
            const exactly =
              response.status === 422 &&
              codes.includes('UNKNOWN_ITEM_ID') &&
              codes.every((code) => code === 'UNKNOWN_ITEM_ID' || code === 'CONTENT_INVALID');
            if (!exactly || !isDeepStrictEqual(await headsOf(w, target), before)) {
              problems.push({
                property: '3 ID integrity (COPYMOVE)',
                detail: `${label}: answered ${response.status} ${codes.join(',')}, not UNKNOWN_ITEM_ID with nothing written`,
              });
            }
          } else if (response.status >= 300) {
            problems.push({
              property: '1 conservation (COPYMOVE)',
              detail: `${label}: answered ${response.status} ${response.raw.slice(0, 200)}`,
            });
          }
        }
      }
    }
  });
  return problems;
};

/**
 * LENSNEW (review 13): a draft-capable token writing through V (REST), or a token pinned to V over GraphQL, echoes
 * a published read whose item the draft no longer holds, where a sub-field cannot be written through V (`count`,
 * retyped since V). The stored result keeps the values the client sent, equal to what the no-version path stores
 * for the same echo, and the identical resend is a no-op.
 */
export const lensNewProblems = async (w: World): Promise<Problem[]> => {
  const make = async () => {
    const id = expectStatus(
      await w.admin.post(`/api/admin/content/${w.docKey}?locale=en`, {
        locale: 'en',
        data: {
          title: 't',
          cards: [
            { heading: 'A', count: 2 },
            { heading: 'B', count: 3 },
          ],
        },
      }),
      201,
    ).json<{ id: string }>().id;
    expectStatus(
      await w.admin.post(`/api/admin/content/${w.docKey}/${id}/publish`, { locales: ['en'] }),
      200,
    );
    const view = (await w.request('GET', `/api/admin/content/${w.docKey}/${id}?locale=en`, w.adminToken))
      .body as Json;
    const cards = ((view.data as Json).cards as Json[]).slice(1);
    expectStatus(
      await w.admin.put(`/api/admin/content/${w.docKey}/${id}?locale=en`, {
        locale: 'en',
        expectedVersion: view.version,
        data: { cards },
      }),
      200,
    );
    return id;
  };
  const visible = (heads: Awaited<ReturnType<typeof headsOf>>) =>
    (
      (heads.find((head) => head.locale === 'en' && head.state === 'draft')?.data[w.doc.cards] as
        Json[] | undefined) ?? []
    ).map((card) => [card[w.card.heading], card[w.card.count]]);
  const echo = async (id: string, caller: Caller, transport: 'rest' | 'graphql', version: boolean) => {
    const read = await readAs(w, caller, id, 'en', version);
    const body = {
      cards: ((read?.cards as Json[] | undefined) ?? []).map((card) => ({
        id: card.id,
        heading: card.heading,
        count: card.count,
      })),
    };
    const draftVersion = async () =>
      (await headsOf(w, id)).find((head) => head.locale === 'en' && head.state === 'draft')?.version ?? null;
    const first = await send(w, {
      caller,
      transport,
      entryId: id,
      locale: 'en',
      version,
      expectedVersion: await draftVersion(),
      body,
    });
    const afterFirst = await entryState(w, id);
    const again = await send(w, {
      caller,
      transport,
      entryId: id,
      locale: 'en',
      version,
      expectedVersion: await draftVersion(),
      body,
    });
    return { first, again, afterFirst, afterAgain: await entryState(w, id) };
  };
  const problems: Problem[] = [];
  const plain = await make();
  const reference = await echo(plain, w.callers.adminToken, 'rest', false);
  const expected = visible(await headsOf(w, plain));
  for (const [name, caller, transport] of [
    ['adminToken@V rest', w.callers.adminToken, 'rest'],
    ['pinned graphql', w.callers.pinned, 'graphql'],
  ] as const) {
    const id = await make();
    const result = await echo(id, caller, transport, true);
    const failed = (response: Awaited<ReturnType<typeof send>>) =>
      response.status >= 300 || /"errors"/.test(response.raw);
    if (failed(reference.first) || failed(result.first)) {
      problems.push({
        property: '5 round trip (LENSNEW)',
        detail: `${name}: answered ${result.first.status} ${result.first.raw.slice(0, 200)} (no-version path ${reference.first.status})`,
      });
      continue;
    }
    const stored = visible(await headsOf(w, id));
    if (!isDeepStrictEqual(stored, expected)) {
      problems.push({
        property: '5 round trip (LENSNEW)',
        detail: `${name}: stored ${JSON.stringify(stored)}, the no-version path stores ${JSON.stringify(expected)}`,
      });
    }
    if (failed(result.again) || !isDeepStrictEqual(result.afterAgain, result.afterFirst)) {
      problems.push({
        property: '9 no-op (LENSNEW)',
        detail: `${name}: the identical resend answered ${result.again.status}, revisions ${result.afterFirst.revisions} → ${result.afterAgain.revisions}`,
      });
    }
  }
  return problems;
};

/**
 * LENSNEW, copies (review 14): through a version, a copied item whose sub-field cannot be written there reads as
 * null at that version (`ratio`: integer at V2, number today, stored 2.5); sending it back keeps the stored value,
 * equal to what the no-version write stores, and the identical resend is a no-op. Two copies: an admin token copies
 * an item the draft no longer holds from the published read, and an app user copies another locale's published
 * items into this locale (the `rline` list holds nothing hidden, so the copy is accepted as new items).
 */
export const lensCopyProblems = async (w: World): Promise<Problem[]> => {
  const rline = await createDefinition(
    w.admin,
    {
      kind: 'component',
      apiKey: 'rline',
      label: 'Rline',
      fields: [
        { apiKey: 'label', label: 'Label', type: 'string' },
        { apiKey: 'ratio', label: 'Ratio', type: 'integer' },
      ],
    },
    'components',
  );
  const model = await createDefinition(w.admin, {
    kind: 'collection',
    apiKey: 'lnew',
    label: 'Lnew',
    localized: true,
    fields: [
      { apiKey: 'title', label: 'Title', type: 'string', localized: true },
      {
        apiKey: 'llines',
        label: 'Llines',
        type: 'component',
        localized: true,
        settings: { component: rline.definition.id, repeatable: true },
      },
    ],
  });
  const v2 = expectStatus(await w.admin.get('/api/snapshots/current'), 200).json<{
    schemaVersionToken: string;
  }>().schemaVersionToken;
  const current = expectStatus(await w.admin.get(`/api/admin/components/${rline.definition.id}`), 200).json<{
    definition: { fields: Array<Record<string, unknown>> } & Record<string, unknown>;
    version: number;
  }>();
  expectStatus(
    await w.admin.put(`/api/admin/components/${rline.definition.id}`, {
      definition: {
        ...current.definition,
        fields: current.definition.fields.map((field) =>
          field.apiKey === 'ratio' ? { ...field, type: 'number' } : field,
        ),
      },
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    }),
    200,
  );
  await runContentSchemaJobs(w.db);
  const lines = [
    { label: 'A', ratio: 2.5 },
    { label: 'B', ratio: 1 },
  ];
  const at = (version: boolean, locale: string) =>
    `?locale=${locale}${version ? `&schemaVersion=${encodeURIComponent(v2)}` : ''}`;
  const draftOf = async (id: string, locale: string) =>
    (await headsOf(w, id)).find((head) => head.locale === locale && head.state === 'draft');
  const stored = async (id: string, locale: string) => {
    const view = (await w.request('GET', `/api/admin/content/lnew/${id}?locale=${locale}`, w.adminToken))
      .body as Json;
    return (((view.data as Json | undefined)?.llines as Json[] | undefined) ?? []).map((line) => [
      line.label,
      line.ratio,
    ]);
  };
  /** An entry published in en (and fr); for `dropFirst`, the en draft then no longer holds the first line. */
  const make = async (dropFirst: boolean) => {
    const id = expectStatus(
      await w.admin.post('/api/admin/content/lnew?locale=en', {
        locale: 'en',
        data: { title: 'en', llines: lines },
      }),
      201,
    ).json<{ id: string }>().id;
    expectStatus(
      await w.admin.put(`/api/admin/content/lnew/${id}?locale=fr`, {
        locale: 'fr',
        expectedVersion: null,
        data: { title: 'fr', llines: lines },
      }),
      200,
    );
    expectStatus(await w.admin.post(`/api/admin/content/lnew/${id}/publish`, { locales: ['en', 'fr'] }), 200);
    if (dropFirst) {
      const view = (await w.request('GET', `/api/admin/content/lnew/${id}?locale=en`, w.adminToken))
        .body as Json;
      expectStatus(
        await w.admin.put(`/api/admin/content/lnew/${id}?locale=en`, {
          locale: 'en',
          expectedVersion: view.version,
          data: { llines: ((view.data as Json).llines as Json[]).slice(1) },
        }),
        200,
      );
    }
    return id;
  };
  /** Reads `from` (published) as `token`, writes its lines into en, twice; returns both answers and the states. */
  const copy = async (id: string, token: string | null, from: string, version: boolean) => {
    const read = (await w.request('GET', `/api/content/lnews/${id}${at(version, from)}`, token)).body as Json;
    const body = { llines: ((read.data as Json | undefined)?.llines as Json[] | undefined) ?? [] };
    const write = async () =>
      w.request('PUT', `/api/content/lnews/${id}${at(version, 'en')}`, token, {
        locale: 'en',
        expectedVersion: (await draftOf(id, 'en'))?.version ?? null,
        data: body,
      });
    const first = await write();
    const afterFirst = await headsOf(w, id);
    const again = await write();
    return { first, again, afterFirst, afterAgain: await headsOf(w, id) };
  };
  const problems: Problem[] = [];
  await withPublicReadUpdate(w, model.definition.id, async () => {
    for (const [name, token, from, dropFirst] of [
      ['admin token, copy from published', w.adminToken, 'en', true],
      ['app user, copy from fr', w.callers.reader.token, 'fr', false],
    ] as const) {
      const reference = await make(dropFirst);
      const plain = await copy(reference, token, from, false);
      const viaV = await make(dropFirst);
      const lensed = await copy(viaV, token, from, true);
      if (plain.first.status >= 300 || lensed.first.status >= 300) {
        problems.push({
          property: '5 round trip (LENSNEW)',
          detail: `${name}: no version ${plain.first.status}, through V2 ${lensed.first.status} ${lensed.first.raw.slice(0, 200)}`,
        });
        continue;
      }
      const want = await stored(reference, 'en');
      const got = await stored(viaV, 'en');
      if (!isDeepStrictEqual(got, want)) {
        problems.push({
          property: '5 round trip (LENSNEW)',
          detail: `${name}: through V2 stored ${JSON.stringify(got)}, the no-version write stores ${JSON.stringify(want)}`,
        });
      }
      if (lensed.again.status >= 300 || !isDeepStrictEqual(lensed.afterAgain, lensed.afterFirst)) {
        problems.push({
          property: '9 no-op (LENSNEW)',
          detail: `${name}: the identical resend through V2 answered ${lensed.again.status} and ${isDeepStrictEqual(lensed.afterAgain, lensed.afterFirst) ? 'changed nothing' : 'changed the entry'}`,
        });
      }
    }
  });
  return problems;
};

/**
 * DEADREL (review 15): a relation target that became soft-deleted (its only locale deleted, or deleted raw) and is
 * hidden behind the caller's read. On doc (drafts) and ndoc (no drafts): an app user echoes its read with one field
 * unchanged (a no-op: the dead target stays), then with a field edited (the dead target goes, as on main); both are
 * accepted, and a twin whose target is unpublished instead (alive, hidden too) answers identically (status and body
 * shape) in both cases.
 */
export const deadRelProblems = async (
  w: World,
  models: ReadonlyArray<'doc' | 'ndoc'>,
): Promise<Problem[]> => {
  // A target that exists only in locale `xx`, which is then deleted: the target entry is soft-deleted with it.
  expectStatus(await w.admin.post('/api/admin/locales', { code: 'xx', label: 'Doomed' }), 201);
  const localeOnly = expectStatus(
    await w.admin.post('/api/admin/content/doc?locale=xx', { locale: 'xx', data: { title: 'only xx' } }),
    201,
  ).json<{ id: string }>().id;
  expectStatus(await w.admin.post(`/api/admin/content/doc/${localeOnly}/publish`, { locales: ['xx'] }), 200);
  // A target soft-deleted raw.
  const rawDead = expectStatus(
    await w.admin.post('/api/admin/content/thing', { data: { name: 'dead' } }),
    201,
  ).json<{
    id: string;
  }>().id;
  expectStatus(await w.admin.post(`/api/admin/content/thing/${rawDead}/publish`, {}), 200);
  const problems: Problem[] = [];
  const entries: Array<{ model: 'doc' | 'ndoc'; how: string; id: string; twin: string; dead: string }> = [];
  for (const model of models) {
    useModelKey(w, model);
    for (const [how, dead, card] of [
      ['locale deleted', localeOnly, (target: string) => ({ heading: 'A', anyRels: [target] })],
      ['deleted raw', rawDead, (target: string) => ({ heading: 'A', rel: target })],
    ] as const) {
      const make = async (target: string) => {
        const id = expectStatus(
          await w.admin.post(`/api/admin/content/${model}?locale=en`, {
            locale: 'en',
            data: { title: 't', cards: [card(target), { heading: 'B' }] },
          }),
          201,
        ).json<{ id: string }>().id;
        if (model === 'doc') {
          expectStatus(await w.admin.post(`/api/admin/content/doc/${id}/publish`, { locales: ['en'] }), 200);
        }
        return id;
      };
      entries.push({ model, how, id: await make(dead), twin: await make(w.things.draft), dead });
    }
  }
  useModelKey(w, 'doc');
  const purged = expectStatus(await w.admin.delete('/api/admin/locales/xx?acknowledgeDestructive=true'), 200);
  await runContentSchemaJobs(w.db);
  const gone = await w.db
    .selectFrom('entries')
    .select('deleted_at')
    .where('id', '=', localeOnly)
    .executeTakeFirst();
  // (localePurge: an entry that existed only in the deleted locale is deleted like a normal delete.)
  if (gone && !gone.deleted_at) {
    throw new Error(`deleting locale xx did not delete the entry that existed only in it: ${purged.body}`);
  }
  await w.db
    .updateTable('entries')
    .set({ deleted_at: new Date().toISOString() })
    .where('id', '=', rawDead)
    .execute();
  const shape = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(shape)
      : isRecord(value)
        ? Object.fromEntries(
            Object.keys(value)
              .filter(
                (key) =>
                  !['id', 'version', 'revisionId', 'createdAt', 'updatedAt', 'publishedAt'].includes(key),
              )
              .sort()
              .map((key) => [key, shape(value[key])]),
          )
        : typeof value;
  for (const entry of entries) {
    // First an unchanged echo (a no-op: the dead target stays), then one with a field edited (it goes).
    for (const phase of ['unchanged', 'edited'] as const) {
      const answers: Array<{ status: number; shape: string }> = [];
      for (const id of [entry.id, entry.twin]) {
        const plural = `${entry.model}s`;
        const read = (
          await w.request('GET', `/api/content/${plural}/${id}?locale=en`, w.callers.reader.token)
        ).body as Json;
        const cards = (((read.data as Json | undefined)?.cards as Json[] | undefined) ?? []).map(
          (card, index) => (phase === 'edited' && index === 1 ? { ...card, heading: 'B~' } : card),
        );
        const before = await headsOf(w, id);
        const draft = before.find((head) => head.locale === 'en' && head.state === 'draft');
        const response = await w.request(
          'PUT',
          `/api/content/${plural}/${id}?locale=en`,
          w.callers.reader.token,
          {
            locale: 'en',
            expectedVersion: draft?.version ?? null,
            data: { cards },
          },
        );
        answers.push({ status: response.status, shape: JSON.stringify(shape(response.body)) });
        const label = `${entry.model} ${entry.how} ${phase}${id === entry.twin ? ' (twin: unpublished target)' : ''}`;
        if (response.status >= 300) {
          problems.push({
            property: '1 conservation (DEADREL)',
            detail: `${label}: the echo answered ${response.status} ${response.raw.slice(0, 200)}`,
          });
          continue;
        }
        const after = await headsOf(w, id);
        if (phase === 'unchanged' && !isDeepStrictEqual(after, before)) {
          problems.push({
            property: '9 no-op (DEADREL)',
            detail: `${label}: an unchanged echo changed the entry`,
          });
        }
        if (id === entry.id) {
          const holds = JSON.stringify(
            after.find((head) => head.locale === 'en' && head.state === 'draft')?.data ?? {},
          ).includes(entry.dead);
          if (holds !== (phase === 'unchanged')) {
            problems.push({
              property: '1 conservation (DEADREL)',
              detail: `${label}: the stored result ${holds ? 'still holds' : 'lost'} the dead target`,
            });
          }
        }
      }
      if (answers.length === 2 && !isDeepStrictEqual(answers[0], answers[1])) {
        problems.push({
          property: '2 no oracle (DEADREL)',
          detail: `${entry.model} ${entry.how} ${phase}: dead ${JSON.stringify(answers[0])}, unpublished ${JSON.stringify(answers[1])}`,
        });
      }
    }
  }
  return problems;
};
