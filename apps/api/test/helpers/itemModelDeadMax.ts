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
