import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin, login } from './helpers/adminIdentity.js';
import { bearer, createAppRole, signUp, type AppSessionBody } from './helpers/appUsers.js';
import { createDefinition, expectStatus, runContentSchemaJobs, type EntryBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { uploadAsset } from './helpers/media.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Data = Record<string, unknown>;
type Item = Record<string, unknown>;
type Model = 'r16d' | 'r16n';
type Where = 'top' | 'card';
type Caller = 'reader' | 'adminToken';
type Via = 'none' | 'version';
type Kind = 'relation' | 'media';

const MODELS: readonly Model[] = ['r16d', 'r16n'];
const WHERES: readonly Where[] = ['top', 'card'];
const CALLERS: readonly Caller[] = ['reader', 'adminToken'];
const VIAS: readonly Via[] = ['none', 'version'];
const KINDS: readonly Kind[] = ['relation', 'media'];

/** The IDs of a relation or media value as a read shows it (media reads as objects). */
const idsOf = (value: unknown): string[] =>
  ((value ?? []) as unknown[]).map((item) =>
    typeof item === 'string' ? item : String((item as { id: string }).id),
  );

/**
 * The sixteenth review (plan item-ids): a write validates only the document it stores. A relation target or media
 * asset kept for the caller that has since been deleted is dropped before validation, so `max` counts only what
 * is stored, as before 0.9.0; a save whose only effect would be dropping it changes nothing, whatever `min` or
 * required say of the document without it.
 */
describe('item writes: sixteenth review, deleted targets and the checks a write answers', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let reader: AppSessionBody;
  let v: string;
  const named: Record<string, string> = {};
  /** Entries by case key, each with the target or asset `X` it holds besides the live ones. */
  const entries = new Map<string, { model: string; id: string; x: string }>();

  const request = (method: 'GET' | 'PUT', url: string, token: string, payload?: unknown) =>
    testApp.app.inject({
      method,
      url,
      headers: bearer(token),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const adminView = async (model: string, id: string) =>
    expectStatus(await admin.get(`/api/admin/content/${model}/${id}`), 200).json<EntryBody>();
  const footprint = async (id: string) =>
    database.current.db
      .selectFrom('entry_heads')
      .select(['state', 'version', 'revision_id'])
      .where('entry_id', '=', id)
      .orderBy('state')
      .execute();
  const tokenOf = (caller: Caller) => (caller === 'reader' ? reader.accessToken : adminToken);
  const at = (via: Via) => (via === 'version' ? `?schemaVersion=${encodeURIComponent(v)}` : '');
  const show = (ids: readonly string[]) =>
    ids.map((id) => Object.entries(named).find(([, value]) => value === id)?.[0] ?? 'X');

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { RATE_LIMIT_MAX: '100000' },
    });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    expect([201, 409]).toContain(
      (await admin.post('/api/admin/locales', { code: 'fr', label: 'French' })).statusCode,
    );
    const thing = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'r16thing',
      label: 'R16 thing',
      localized: true,
      fields: [{ apiKey: 'name', label: 'Name', type: 'string', localized: true }],
    });
    const rels = (settings: Data, extra: Data = {}) => ({
      label: 'Rels',
      type: 'relation',
      settings: { target: thing.definition.id, cardinality: 'many', ...settings },
      ...extra,
    });
    const files = { apiKey: 'files', label: 'Files', type: 'media', settings: { multiple: true, max: 2 } };
    const card = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'r16_card',
        label: 'R16 card',
        fields: [
          { apiKey: 'heading', label: 'Heading', type: 'string' },
          { apiKey: 'rels', ...rels({ max: 2 }) },
          files,
        ],
      },
      'components',
    );
    const fields = [
      { apiKey: 'title', label: 'Title', type: 'string' },
      { apiKey: 'rels', ...rels({ max: 2 }) },
      files,
      {
        apiKey: 'cards',
        label: 'Cards',
        type: 'component',
        settings: { component: card.definition.id, repeatable: true },
      },
    ];
    // `min` and required: a hidden target that is deleted leaves the field short of them.
    const checkedFields = [
      { apiKey: 'title', label: 'Title', type: 'string' },
      { apiKey: 'ref', ...rels({ cardinality: 'one' }, { required: true }) },
      { apiKey: 'mrels', ...rels({ min: 2 }) },
    ];
    const models = [
      await createDefinition(admin, { kind: 'collection', apiKey: 'r16d', label: 'R16 d', fields }),
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'r16n',
        label: 'R16 n',
        draftAndPublish: false,
        fields,
      }),
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'r16cd',
        label: 'R16 cd',
        fields: checkedFields,
      }),
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'r16cn',
        label: 'R16 cn',
        draftAndPublish: false,
        fields: checkedFields,
      }),
    ];
    reader = await signUp(testApp.app);
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/app-users/${reader.user.id}`,
        payload: {
          roleIds: [
            await createAppRole(database.current.db, [
              ...models.flatMap((model) => [
                { action: 'read' as const, modelId: model.definition.id },
                { action: 'update' as const, modelId: model.definition.id },
              ]),
              { action: 'read' as const, modelId: thing.definition.id },
            ]),
          ],
        },
      }),
      200,
    );
    const makeThing = async (locale: 'en' | 'fr', published: boolean) => {
      const created = expectStatus(
        await admin.post(`/api/admin/content/r16thing?locale=${locale}`, { locale, data: { name: 'n' } }),
        201,
      ).json<EntryBody>();
      if (published) {
        expectStatus(
          await admin.post(`/api/admin/content/r16thing/${created.id}/publish`, { locales: [locale] }),
          200,
        );
      }
      return created.id;
    };
    let uploads = 0;
    const upload = async () => {
      uploads += 1;
      return (
        await uploadAsset(testApp.app, bearer(adminToken), {
          file: Buffer.from(`%PDF-1.7\n${uploads}\n%%EOF\n`),
          filename: `r16-${uploads}.pdf`,
          mimeType: 'application/pdf',
        })
      ).id;
    };
    named.A = await makeThing('en', true);
    named.B = await makeThing('en', true);
    named.M1 = await upload();
    named.M3 = await upload();
    const create = async (model: string, data: Data) => {
      const created = expectStatus(
        await admin.post(`/api/admin/content/${model}`, { data }),
        201,
      ).json<EntryBody>();
      if (!model.endsWith('n')) {
        expectStatus(await admin.post(`/api/admin/content/${model}/${created.id}/publish`, {}), 200);
      }
      return created.id;
    };
    const deletedAssets: string[] = [];
    for (const kind of KINDS) {
      for (const model of MODELS) {
        for (const where of WHERES) {
          for (const caller of CALLERS) {
            for (const via of VIAS) {
              for (const twin of ['dead', 'unpublished'] as const) {
                if (kind === 'media' && twin === 'unpublished') {
                  continue;
                }
                const live = kind === 'relation' ? named.A : named.M1;
                // A relation target that lives only in `fr` is purged with the locale; an asset is force-deleted.
                const x =
                  kind === 'media'
                    ? await upload()
                    : await makeThing(twin === 'dead' ? 'fr' : 'en', twin === 'dead');
                if (kind === 'media') {
                  deletedAssets.push(x);
                }
                const key = kind === 'relation' ? 'rels' : 'files';
                const value = { [key]: [live, x] };
                const data =
                  where === 'top'
                    ? { title: 't', ...value }
                    : { title: 't', cards: [{ heading: 'a', ...value }] };
                entries.set([kind, model, where, caller, via, twin].join(':'), {
                  model,
                  id: await create(model, data),
                  x,
                });
              }
            }
          }
        }
      }
    }
    for (const model of ['r16cd', 'r16cn']) {
      for (const twin of ['dead', 'unpublished'] as const) {
        for (const act of ['echo', 'title']) {
          const x = await makeThing(twin === 'dead' ? 'fr' : 'en', twin === 'dead');
          entries.set([model, twin, act].join(':'), {
            model,
            id: await create(model, { title: 't', ref: x, mrels: [named.A, x] }),
            x,
          });
        }
      }
    }
    expectStatus(
      await testApp.app.inject({
        method: 'DELETE',
        url: '/api/admin/locales/fr?acknowledgeDestructive=true',
        headers: bearer(adminToken),
      }),
      200,
    );
    await runContentSchemaJobs(database.current.db);
    // An owner force-deletes assets content still uses: content then holds a dangling ID.
    const owner = await login(testApp.app, await createAdmin(database.current.db, { roleKeys: ['owner'] }));
    for (const asset of deletedAssets) {
      expectStatus(
        await testApp.app.inject({
          method: 'DELETE',
          url: `/api/admin/media/assets/${asset}?force=true`,
          headers: owner.headers,
        }),
        204,
      );
    }
    v = (await request('GET', '/api/content/r16ds', adminToken)).headers[
      'shapio-schema-version-current'
    ] as string;
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  /** Reads the entry, adds B (or M3) to the value that holds X, and writes it back. */
  const addOne = async (kind: Kind, model: Model, where: Where, caller: Caller, via: Via, twin: string) => {
    const { id } = entries.get([kind, model, where, caller, via, twin].join(':')) as { id: string };
    const key = kind === 'relation' ? 'rels' : 'files';
    const extra = kind === 'relation' ? named.B : named.M3;
    const read = expectStatus(
      await request('GET', `/api/content/${model}s/${id}${at(via)}`, tokenOf(caller)),
      200,
    ).json<{ data: Data }>().data;
    const body =
      where === 'top'
        ? { title: read.title, [key]: [...idsOf(read[key]), extra] }
        : {
            title: read.title,
            cards: (read.cards as Item[]).map((item) => ({ ...item, [key]: [...idsOf(item[key]), extra] })),
          };
    const response = await request('PUT', `/api/content/${model}s/${id}${at(via)}`, tokenOf(caller), {
      expectedVersion: (await adminView(model, id)).version,
      data: body,
    });
    const after = (await adminView(model, id)).data;
    const value = where === 'top' ? after[key] : (after.cards as Item[])[0]?.[key];
    return { status: response.statusCode, body: response.body, stored: show(idsOf(value)) };
  };

  const maxCases = KINDS.flatMap((kind) =>
    MODELS.flatMap((model) =>
      WHERES.flatMap((where) =>
        CALLERS.flatMap((caller) => VIAS.map((via) => [kind, model, where, caller, via] as const)),
      ),
    ),
  );
  it.each(maxCases)(
    '%s, %s, %s, %s, version %s: a deleted X kept behind the read does not count against max',
    async (kind, model, where, caller, via) => {
      const result = await addOne(kind, model, where, caller, via, 'dead');
      expect(result.status, result.body).toBe(200);
      expect(result.stored).toEqual(kind === 'relation' ? ['A', 'B'] : ['M1', 'M3']);
    },
  );

  it.each(
    MODELS.flatMap((model) => WHERES.flatMap((where) => VIAS.map((via) => [model, where, via] as const))),
  )(
    '%s, %s, version %s: an admin-role token answers the same whether X is deleted or unpublished',
    async (model, where, via) => {
      // The deleted twin answers 200 and stores [A, B] (the cases above, on their own entries).
      const unpublished = await addOne('relation', model, where, 'adminToken', via, 'unpublished');
      expect({ status: unpublished.status, stored: unpublished.stored }, unpublished.body).toEqual({
        status: 200,
        stored: ['A', 'B'],
      });
    },
  );

  it.each(
    MODELS.flatMap((model) => WHERES.flatMap((where) => VIAS.map((via) => [model, where, via] as const))),
  )(
    '%s, %s, version %s: an app user whose hidden X is only unpublished still has two targets: TOO_MANY',
    async (model, where, via) => {
      const result = await addOne('relation', model, where, 'reader', via, 'unpublished');
      expect(result.status).toBe(422);
      expect(result.body).toContain('TOO_MANY');
      expect(result.stored).toEqual(['A', 'X']);
    },
  );

  /** An app user's write of what it read of a `min`/required entry: unchanged, or with a new title. */
  const writeChecked = async (model: string, twin: string, act: 'echo' | 'title') => {
    const { id } = entries.get([model, twin, act].join(':')) as { id: string };
    const read = expectStatus(
      await request('GET', `/api/content/${model}s/${id}`, reader.accessToken),
      200,
    ).json<{
      data: Data;
    }>().data;
    const before = await footprint(id);
    const response = await request('PUT', `/api/content/${model}s/${id}`, reader.accessToken, {
      expectedVersion: (await adminView(model, id)).version,
      data: {
        title: act === 'title' ? 't2' : read.title,
        ref: read.ref ?? null,
        mrels: idsOf(read.mrels),
      },
    });
    return {
      status: response.statusCode,
      codes:
        response.statusCode === 200 ? [] : (response.body.match(/"code":"[A-Z_]+"/g) ?? []).slice(1).sort(),
      changed: JSON.stringify(await footprint(id)) !== JSON.stringify(before),
    };
  };

  it.each(['r16cd', 'r16cn'])(
    '%s: sending a read back unchanged is a no-op whether the hidden targets were deleted or are unpublished',
    async (model) => {
      for (const twin of ['dead', 'unpublished']) {
        expect(await writeChecked(model, twin, 'echo'), twin).toEqual({
          status: 200,
          codes: [],
          changed: false,
        });
      }
    },
  );

  it.each(['r16cd', 'r16cn'])(
    '%s: a change is checked without a deleted target (REQUIRED, TOO_FEW), and kept an unpublished one',
    async (model) => {
      expect(await writeChecked(model, 'dead', 'title')).toEqual({
        status: 422,
        codes: ['"code":"REQUIRED"', '"code":"TOO_FEW"'],
        changed: false,
      });
      expect(await writeChecked(model, 'unpublished', 'title')).toMatchObject({ status: 200, changed: true });
    },
  );
});
