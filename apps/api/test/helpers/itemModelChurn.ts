import { isDeepStrictEqual } from 'node:util';
import { setPublicGrants } from './appUsers.js';
import { createDefinition, expectStatus } from './content.js';
import { entryState } from './itemModelProbes.js';
import { type Problem } from './itemModelRun.js';
import { eventCount, headsOf, revisionCount, type World } from './itemModelWorld.js';

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
