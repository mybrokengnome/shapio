import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { PRIMARY_SITE_ID } from '../../src/constants/sites.js';
import { setPublicGrants } from './appUsers.js';
import { createDefinition, expectStatus, runContentSchemaJobs } from './content.js';
import { type Problem } from './itemModelRun.js';
import { headsOf, revisionCount, type World } from './itemModelWorld.js';

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** An asset row inserted raw (an upload's row without its file), as the world does. */
const insertAsset = async (w: World, visibility: 'public' | 'private') => {
  const id = randomUUID();
  await w.db
    .insertInto('media_assets')
    .values({
      id,
      site_id: PRIMARY_SITE_ID,
      storage_driver: 'local',
      storage_key: `${visibility}/${id}/0123456789abcdef01234567/${visibility}.png`,
      original_filename: `${visibility}.png`,
      mime_type: 'image/png',
      size_bytes: 1,
      status: 'ready',
      visibility,
    })
    .execute();
  return id;
};

/** What `deleteAsset(force)` does to the rows (services/mediaAssets.ts): references gone, the asset soft-deleted. */
const forceDeleteAsset = async (w: World, id: string) => {
  await w.db.deleteFrom('media_references').where('asset_id', '=', id).execute();
  await w.db
    .updateTable('media_assets')
    .set({ deleted_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute();
};

const codesOf = (raw: string): string[] =>
  [...raw.matchAll(/"code":"([A-Z_]+)"/g)].map((match) => match[1] ?? '');

/**
 * DEADMAX (review 16): count rules with dead targets. A many-relation and a multi-media field with `max: 2` hold
 * [live, dead] (the relation target deleted through a locale delete, the asset force-deleted), at the top level and
 * inside a component, on a type with drafts and one without. A delivery caller (an app user; the admin-role token)
 * reads [live] and sends [live, other], with and without a schema version: accepted, storing [live, other] as on
 * main. A twin whose hidden value is alive (an unpublished target, a private asset) answers the documented way
 * (accepted, or TOO_MANY when the hidden value is kept beside the two sent). `min: 1` and `required` variants: an
 * unchanged echo is a no-op for both twins; an edit while a dead target is kept may answer TOO_FEW or REQUIRED, as
 * on main (CHANGELOG.md: "A change can then be refused `TOO_FEW` or `REQUIRED` when the field no longer has
 * enough live targets without the deleted one.").
 */
export const deadMaxProblems = async (w: World): Promise<Problem[]> => {
  const thing = w.models.thing.definition.id;
  const item = await createDefinition(
    w.admin,
    {
      kind: 'component',
      apiKey: 'dmitem',
      label: 'Dmitem',
      fields: [
        { apiKey: 'label', label: 'Label', type: 'string' },
        {
          apiKey: 'rels',
          label: 'Rels',
          type: 'relation',
          settings: { target: '*', cardinality: 'many', max: 2 },
        },
        { apiKey: 'pics', label: 'Pics', type: 'media', settings: { multiple: true, max: 2 } },
      ],
    },
    'components',
  );
  const maxModel = (apiKey: string, draftAndPublish: boolean) =>
    createDefinition(w.admin, {
      kind: 'collection',
      apiKey,
      label: apiKey,
      draftAndPublish,
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        {
          apiKey: 'rels',
          label: 'Rels',
          type: 'relation',
          settings: { target: '*', cardinality: 'many', max: 2 },
        },
        { apiKey: 'pics', label: 'Pics', type: 'media', settings: { multiple: true, max: 2 } },
        {
          apiKey: 'items',
          label: 'Items',
          type: 'component',
          settings: { component: item.definition.id, repeatable: true },
        },
      ],
    });
  const models = [await maxModel('dmtop', true), await maxModel('dmtopn', false)];
  const minModel = await createDefinition(w.admin, {
    kind: 'collection',
    apiKey: 'dmin',
    label: 'Dmin',
    fields: [
      { apiKey: 'title', label: 'Title', type: 'string' },
      {
        apiKey: 'rels',
        label: 'Rels',
        type: 'relation',
        settings: { target: thing, cardinality: 'many', min: 1 },
      },
      {
        apiKey: 'ref',
        label: 'Ref',
        type: 'relation',
        required: true,
        settings: { target: thing, cardinality: 'one' },
      },
    ],
  });
  // A version token that knows these types (nothing changes after it).
  const version = expectStatus(await w.admin.get('/api/snapshots/current'), 200).json<{
    schemaVersionToken: string;
  }>().schemaVersionToken;
  const thingOf = async (name: string, publish: boolean) => {
    const id = expectStatus(await w.admin.post('/api/admin/content/thing', { data: { name } }), 201).json<{
      id: string;
    }>().id;
    if (publish) {
      expectStatus(await w.admin.post(`/api/admin/content/thing/${id}/publish`, {}), 200);
    }
    return id;
  };
  const live = await thingOf('live', true);
  const other = await thingOf('other', true);
  const unpublished = await thingOf('unpublished', false);
  const livePic = await insertAsset(w, 'public');
  const otherPic = await insertAsset(w, 'public');
  const privatePic = await insertAsset(w, 'private');
  const deadPic = await insertAsset(w, 'public');
  // The dead relation target: a doc entry that exists only in locale `yy`, which is then deleted.
  expectStatus(await w.admin.post('/api/admin/locales', { code: 'yy', label: 'Doomed too' }), 201);
  const dead = expectStatus(
    await w.admin.post('/api/admin/content/doc?locale=yy', { locale: 'yy', data: { title: 'only yy' } }),
    201,
  ).json<{ id: string }>().id;
  expectStatus(await w.admin.post(`/api/admin/content/doc/${dead}/publish`, { locales: ['yy'] }), 200);
  const deadThing = await thingOf('dead thing', true);

  type Made = { key: string; id: string; twin: string };
  const made: Made[] = [];
  for (const model of models) {
    const key = model.definition.apiKey;
    const create = async (hiddenRel: string, hiddenPic: string) => {
      const id = expectStatus(
        await w.admin.post(`/api/admin/content/${key}`, {
          data: {
            title: 't',
            rels: [live, hiddenRel],
            pics: [livePic, hiddenPic],
            items: [{ label: 'A', rels: [live, hiddenRel], pics: [livePic, hiddenPic] }],
          },
        }),
        201,
      ).json<{ id: string }>().id;
      if (key === 'dmtop') {
        expectStatus(await w.admin.post(`/api/admin/content/${key}/${id}/publish`, {}), 200);
      }
      return id;
    };
    made.push({ key, id: await create(dead, deadPic), twin: await create(unpublished, privatePic) });
  }
  const minMade = await (async () => {
    const create = async (target: string) => {
      const id = expectStatus(
        await w.admin.post('/api/admin/content/dmin', { data: { title: 't', rels: [target], ref: target } }),
        201,
      ).json<{ id: string }>().id;
      expectStatus(await w.admin.post(`/api/admin/content/dmin/${id}/publish`, {}), 200);
      return id;
    };
    return { id: await create(deadThing), twin: await create(unpublished) };
  })();
  // The deaths, through the real paths.
  expectStatus(await w.admin.delete('/api/admin/locales/yy?acknowledgeDestructive=true'), 200);
  await runContentSchemaJobs(w.db);
  // (The admin API refuses to delete an entry others point at; the `min`/`required` target is deleted raw.)
  await w.db
    .updateTable('entries')
    .set({ deleted_at: new Date().toISOString() })
    .where('id', '=', deadThing)
    .execute();
  await forceDeleteAsset(w, deadPic);

  const problems: Problem[] = [];
  const draftVersion = async (id: string) =>
    (await headsOf(w, id)).find((head) => head.state === 'draft')?.version ?? null;
  const stored = async (key: string, id: string) =>
    ((await w.request('GET', `/api/admin/content/${key}/${id}`, w.adminToken)).body as Json).data as Json;
  await setPublicGrants(
    w.db,
    [...models, minModel].flatMap((model) => [
      { action: 'read' as const, modelId: model.definition.id },
      { action: 'update' as const, modelId: model.definition.id },
    ]),
  );
  try {
    for (const { key, id, twin } of made) {
      for (const [callerName, token] of [
        ['app user', w.callers.reader.token],
        ['admin token', w.adminToken],
      ] as const) {
        for (const withVersion of [false, true]) {
          const query = withVersion ? `?schemaVersion=${encodeURIComponent(version)}` : '';
          for (const entry of [id, twin]) {
            const body = {
              rels: [live, other],
              pics: [livePic, otherPic],
              items: await (async () => {
                const read = (await w.request('GET', `/api/content/${key}s/${entry}${query}`, token))
                  .body as Json;
                const items = ((read.data as Json | undefined)?.items as Json[] | undefined) ?? [];
                return items.map((one) => ({
                  id: one.id,
                  label: one.label,
                  rels: [live, other],
                  pics: [livePic, otherPic],
                }));
              })(),
            };
            const response = await w.request('PUT', `/api/content/${key}s/${entry}${query}`, token, {
              expectedVersion: await draftVersion(entry),
              data: body,
            });
            const label = `${key} ${callerName}${withVersion ? '@V' : ''}${entry === twin ? ' (twin: alive hidden)' : ''}`;
            if (entry === id) {
              const data = await stored(key, entry);
              const pics = (value: unknown) =>
                Array.isArray(value)
                  ? (value as unknown[]).map((pic) => (isRecord(pic) ? pic.id : pic))
                  : value;
              const relIds = (value: unknown) =>
                Array.isArray(value)
                  ? (value as unknown[]).map((rel) => (isRecord(rel) ? rel.id : rel))
                  : value;
              const firstItem = ((data.items as Json[] | undefined) ?? [])[0] ?? {};
              const got = [relIds(data.rels), pics(data.pics), relIds(firstItem.rels), pics(firstItem.pics)];
              const want = [
                [live, other],
                [livePic, otherPic],
                [live, other],
                [livePic, otherPic],
              ];
              if (response.status >= 300 || !isDeepStrictEqual(got, want)) {
                problems.push({
                  property: '1 conservation (DEADMAX)',
                  detail: `${label}: answered ${response.status} ${codesOf(response.raw).join(',')}, stored ${JSON.stringify(got)}`,
                });
              }
            } else if (
              response.status >= 300 &&
              !(
                response.status === 422 &&
                codesOf(response.raw).every((code) => ['CONTENT_INVALID', 'TOO_MANY'].includes(code))
              )
            ) {
              problems.push({
                property: '1 conservation (DEADMAX)',
                detail: `${label}: answered ${response.status} ${response.raw.slice(0, 200)}`,
              });
            }
          }
        }
      }
    }
    // min: 1 and required.
    for (const entry of [minMade.id, minMade.twin]) {
      const label = `dmin${entry === minMade.twin ? ' (twin: unpublished)' : ''}`;
      const read = (await w.request('GET', `/api/content/dmins/${entry}`, w.callers.reader.token))
        .body as Json;
      const data = (read.data as Json | undefined) ?? {};
      const echo = Object.fromEntries(
        Object.entries(data).filter(([field]) => ['title', 'rels', 'ref'].includes(field)),
      );
      const revisions = await revisionCount(w, entry);
      const unchanged = await w.request('PUT', `/api/content/dmins/${entry}`, w.callers.reader.token, {
        expectedVersion: await draftVersion(entry),
        data: echo,
      });
      if (unchanged.status >= 300 || (await revisionCount(w, entry)) !== revisions) {
        problems.push({
          property: '9 no-op (DEADMAX)',
          detail: `${label}: an unchanged echo answered ${unchanged.status} ${codesOf(unchanged.raw).join(',')}, revisions ${revisions} → ${await revisionCount(w, entry)}`,
        });
      }
      const edited = await w.request('PUT', `/api/content/dmins/${entry}`, w.callers.reader.token, {
        expectedVersion: await draftVersion(entry),
        data: { ...echo, title: 't~' },
      });
      const allowed =
        edited.status < 300 ||
        (entry === minMade.id &&
          edited.status === 422 &&
          codesOf(edited.raw).every((code) => ['CONTENT_INVALID', 'TOO_FEW', 'REQUIRED'].includes(code)));
      if (!allowed) {
        problems.push({
          property: '1 conservation (DEADMAX)',
          detail: `${label}: an edit answered ${edited.status} ${edited.raw.slice(0, 200)}`,
        });
      }
    }
  } finally {
    await w.publicGrants(false);
  }
  return problems;
};

/**
 * DEADMIX (review 17), relations and media. (a) An entry already invalid as stored (a many-relation and a
 * multi-media field over a `max` lowered after the save) holding a hidden value: an unchanged echo answers the same
 * for both twins (hidden value deleted versus alive) and writes nothing when refused. (b) A deleted hidden value in
 * a field the caller sends and in one it does not send, in four layouts (two top-level many fields; a many and a
 * single field; top level and inside a component; a component and a top-level field), drafts on and off: an
 * unchanged echo is a no-op for both twins; an edit drops the deleted value only where the body sent it.
 */
export const deadMixProblems = async (w: World): Promise<Problem[]> => {
  const thing = w.models.thing.definition.id;
  const item = await createDefinition(
    w.admin,
    {
      kind: 'component',
      apiKey: 'mxitem',
      label: 'Mxitem',
      fields: [
        { apiKey: 'label', label: 'Label', type: 'string' },
        { apiKey: 'rels', label: 'Rels', type: 'relation', settings: { target: thing, cardinality: 'many' } },
        { apiKey: 'pics', label: 'Pics', type: 'media', settings: { multiple: true } },
      ],
    },
    'components',
  );
  const fields = [
    { apiKey: 'title', label: 'Title', type: 'string' },
    { apiKey: 'relsA', label: 'RelsA', type: 'relation', settings: { target: thing, cardinality: 'many' } },
    { apiKey: 'relsB', label: 'RelsB', type: 'relation', settings: { target: thing, cardinality: 'many' } },
    { apiKey: 'refB', label: 'RefB', type: 'relation', settings: { target: thing, cardinality: 'one' } },
    { apiKey: 'picsA', label: 'PicsA', type: 'media', settings: { multiple: true } },
    { apiKey: 'picsB', label: 'PicsB', type: 'media', settings: { multiple: true } },
    { apiKey: 'picB', label: 'PicB', type: 'media' },
    {
      apiKey: 'items',
      label: 'Items',
      type: 'component',
      settings: { component: item.definition.id, repeatable: true },
    },
  ];
  const mixModels = [
    await createDefinition(w.admin, { kind: 'collection', apiKey: 'mixd', label: 'Mixd', fields }),
    await createDefinition(w.admin, {
      kind: 'collection',
      apiKey: 'mixn',
      label: 'Mixn',
      draftAndPublish: false,
      fields,
    }),
  ];
  const lowModel = await createDefinition(w.admin, {
    kind: 'collection',
    apiKey: 'dlow',
    label: 'Dlow',
    fields: [
      { apiKey: 'title', label: 'Title', type: 'string' },
      {
        apiKey: 'rels',
        label: 'Rels',
        type: 'relation',
        settings: { target: thing, cardinality: 'many', max: 3 },
      },
      { apiKey: 'pics', label: 'Pics', type: 'media', settings: { multiple: true, max: 3 } },
    ],
  });
  const thingOf = async (name: string, publish: boolean) => {
    const id = expectStatus(await w.admin.post('/api/admin/content/thing', { data: { name } }), 201).json<{
      id: string;
    }>().id;
    if (publish) {
      expectStatus(await w.admin.post(`/api/admin/content/thing/${id}/publish`, {}), 200);
    }
    return id;
  };
  const live = await thingOf('mix live', true);
  const other = await thingOf('mix other', true);
  const unpublished = await thingOf('mix unpublished', false);
  const deadThing = await thingOf('mix dead', true);
  const livePic = await insertAsset(w, 'public');
  const otherPic = await insertAsset(w, 'public');
  const privatePic = await insertAsset(w, 'private');
  const deadPic = await insertAsset(w, 'public');
  const twins = [
    { name: 'deleted', rel: deadThing, pic: deadPic },
    { name: 'alive', rel: unpublished, pic: privatePic },
  ];
  const publish = async (key: string, id: string, drafts: boolean) => {
    if (drafts) {
      expectStatus(await w.admin.post(`/api/admin/content/${key}/${id}/publish`, {}), 200);
    }
  };
  // (b) the layouts: which fields hold the hidden value, which one the caller sends.
  type Layout = { name: string; sent: string; unsent: string };
  const layouts: Layout[] = [
    { name: 'two many fields', sent: 'relsA', unsent: 'relsB' },
    { name: 'many and single', sent: 'relsA', unsent: 'refB' },
    { name: 'top level and component', sent: 'relsA', unsent: 'items' },
    { name: 'component and top level', sent: 'items', unsent: 'relsA' },
    { name: 'two media fields', sent: 'picsA', unsent: 'picsB' },
    { name: 'media many and single', sent: 'picsA', unsent: 'picB' },
  ];
  const dataFor = (hidden: { rel: string; pic: string }) => ({
    title: 't',
    relsA: [live, hidden.rel],
    relsB: [live, hidden.rel],
    refB: hidden.rel,
    picsA: [livePic, hidden.pic],
    picsB: [livePic, hidden.pic],
    picB: hidden.pic,
    items: [{ label: 'A', rels: [live, hidden.rel], pics: [livePic, hidden.pic] }],
  });
  const mixEntries: Array<{ key: string; layout: Layout; twin: string; id: string; hidden: string }> = [];
  for (const model of mixModels) {
    const key = model.definition.apiKey;
    for (const layout of layouts) {
      for (const twin of twins) {
        const id = expectStatus(
          await w.admin.post(`/api/admin/content/${key}`, { data: dataFor(twin) }),
          201,
        ).json<{
          id: string;
        }>().id;
        await publish(key, id, key === 'mixd');
        mixEntries.push({
          key,
          layout,
          twin: twin.name,
          id,
          hidden:
            layout.name.startsWith('media') || layout.name.startsWith('two media') ? twin.pic : twin.rel,
        });
      }
    }
  }
  // (a) already invalid: three values stored, then `max` lowered to 2.
  const lowEntries: Array<{ twin: string; id: string }> = [];
  for (const twin of twins) {
    const id = expectStatus(
      await w.admin.post('/api/admin/content/dlow', {
        data: { title: 't', rels: [live, other, twin.rel], pics: [livePic, otherPic, twin.pic] },
      }),
      201,
    ).json<{ id: string }>().id;
    await publish('dlow', id, true);
    lowEntries.push({ twin: twin.name, id });
  }
  const current = expectStatus(await w.admin.get(`/api/admin/models/${lowModel.definition.id}`), 200).json<{
    definition: { fields: Array<Record<string, unknown>> } & Record<string, unknown>;
    version: number;
  }>();
  const lowered = await w.admin.put(`/api/admin/models/${lowModel.definition.id}`, {
    definition: {
      ...current.definition,
      fields: current.definition.fields.map((field) =>
        field.apiKey === 'rels' || field.apiKey === 'pics'
          ? { ...field, settings: { ...(field.settings as Json), max: 2 } }
          : field,
      ),
    },
    expectedVersion: current.version,
    acknowledgeBreaking: true,
    acknowledgeDestructive: true,
  });
  if (lowered.statusCode !== 200 && lowered.statusCode !== 202) {
    throw new Error(`lowering max: ${lowered.statusCode} ${lowered.body}`);
  }
  await runContentSchemaJobs(w.db);
  // The deaths.
  await w.db
    .updateTable('entries')
    .set({ deleted_at: new Date().toISOString() })
    .where('id', '=', deadThing)
    .execute();
  await forceDeleteAsset(w, deadPic);

  const problems: Problem[] = [];
  const draftOf = async (id: string) => (await headsOf(w, id)).find((head) => head.state === 'draft');
  const fieldIdOf = (key: string, apiKey: string) =>
    (key === 'dlow'
      ? lowModel
      : (mixModels.find((model) => model.definition.apiKey === key) ?? mixModels[0])
    )?.definition.fields.find((field) => field.apiKey === apiKey)?.id ?? apiKey;
  const holds = async (key: string, id: string, field: string, value: string) => {
    const draft = await draftOf(id);
    return JSON.stringify(draft?.data[fieldIdOf(key, field)] ?? null).includes(value);
  };
  await setPublicGrants(
    w.db,
    [...mixModels, lowModel].flatMap((model) => [
      { action: 'read' as const, modelId: model.definition.id },
      { action: 'update' as const, modelId: model.definition.id },
    ]),
  );
  try {
    const echo = async (key: string, id: string, send: string[], edit: boolean) => {
      const read = (await w.request('GET', `/api/content/${key}s/${id}`, w.callers.reader.token))
        .body as Json;
      const data = (read.data as Json | undefined) ?? {};
      // Media as the client sends them back: by id.
      const asIds = (value: unknown): unknown =>
        Array.isArray(value)
          ? value.map(asIds)
          : isRecord(value)
            ? typeof value.id === 'string' && typeof value.mimeType === 'string'
              ? value.id
              : Object.fromEntries(Object.entries(value).map(([field, entry]) => [field, asIds(entry)]))
            : value;
      const body = {
        ...Object.fromEntries(send.map((field) => [field, asIds(data[field])])),
        ...(edit ? { title: 't~' } : {}),
      };
      const before = await headsOf(w, id);
      const response = await w.request('PUT', `/api/content/${key}s/${id}`, w.callers.reader.token, {
        expectedVersion: (await draftOf(id))?.version ?? null,
        data: body,
      });
      return { response, unchanged: isDeepStrictEqual(await headsOf(w, id), before) };
    };
    // (a)
    const lowAnswers: string[] = [];
    for (const { twin, id } of lowEntries) {
      const { response, unchanged } = await echo('dlow', id, ['title', 'rels', 'pics'], false);
      lowAnswers.push(`${response.status} ${codesOf(response.raw).join(',')}`);
      if (response.status >= 300 && !unchanged) {
        problems.push({
          property: '1 conservation (DEADMIX)',
          detail: `dlow ${twin}: refused, yet the entry changed`,
        });
      }
    }
    if (lowAnswers[0] !== lowAnswers[1]) {
      problems.push({
        property: '2 no oracle (DEADMIX)',
        detail: `already invalid: deleted twin ${lowAnswers[0]}, alive twin ${lowAnswers[1]}`,
      });
    }
    // (b)
    for (const entry of mixEntries) {
      const label = `${entry.key} ${entry.layout.name} (${entry.twin})`;
      const unchanged = await echo(entry.key, entry.id, [entry.layout.sent], false);
      if (unchanged.response.status >= 300 || !unchanged.unchanged) {
        problems.push({
          property: '9 no-op (DEADMIX)',
          detail: `${label}: an unchanged echo answered ${unchanged.response.status} ${codesOf(unchanged.response.raw).join(',')}${unchanged.unchanged ? '' : ' and changed the entry'}`,
        });
        continue;
      }
      const edited = await echo(entry.key, entry.id, [entry.layout.sent], true);
      // CHANGELOG.md: "On a content type without drafts, a kept deleted target in a field you did not send still
      // fails the write, as before 0.9.0; clear that field to save." (every save also publishes, and the publish
      // checks unsent fields in full).
      if (entry.key === 'mixn' && entry.twin === 'deleted') {
        const codes = codesOf(edited.response.raw).filter((code) => code !== 'CONTENT_INVALID');
        if (
          edited.response.status !== 422 ||
          !codes.every((code) => code === 'RELATION_TARGET_MISSING' || code === 'MEDIA_MISSING') ||
          !edited.unchanged
        ) {
          problems.push({
            property: '1 conservation (DEADMIX)',
            detail: `${label}: an edit answered ${edited.response.status} ${codes.join(',')}, not a RELATION_TARGET_MISSING refusal that writes nothing`,
          });
        }
        continue;
      }
      if (edited.response.status >= 300) {
        problems.push({
          property: '1 conservation (DEADMIX)',
          detail: `${label}: an edit answered ${edited.response.status} ${edited.response.raw.slice(0, 200)}`,
        });
        continue;
      }
      const atSent = await holds(entry.key, entry.id, entry.layout.sent, entry.hidden);
      const atUnsent = await holds(entry.key, entry.id, entry.layout.unsent, entry.hidden);
      const want = entry.twin === 'deleted' ? [false, true] : [true, true];
      if (!isDeepStrictEqual([atSent, atUnsent], want)) {
        problems.push({
          property: '1 conservation (DEADMIX)',
          detail: `${label}: after an edit the hidden value is ${atSent ? 'kept' : 'gone'} where it was sent and ${atUnsent ? 'kept' : 'gone'} where it was not (want ${want.map((keep) => (keep ? 'kept' : 'gone')).join('/')})`,
        });
      }
    }
  } finally {
    await w.publicGrants(false);
  }
  return problems;
};
