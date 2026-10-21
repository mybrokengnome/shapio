import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLISHING_JOBS } from '../src/constants/publishing.js';
import { SITE_HEADER } from '../src/constants/sites.js';
import type { Worker } from '../src/jobs/worker.js';
import {
  createDefinition,
  expectStatus,
  fieldIdOf,
  runContentSchemaJobs,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import { createPublishingTestApp, createPublishingWorker, drainJobs } from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Issue = { code: string; message: string; definitionId?: string };
type PreviewBody = {
  plan: {
    affectedModelIds: string[];
    prerequisites: Array<{ kind: string }>;
    changes: Array<{ kind: string; category: string; breaking: boolean; destructive: boolean }>;
  };
};
type ChangeSet = { id: string; status: string; version: number };

const issuesOf = (response: LightMyRequestResponse) =>
  response.json<{ error: { code: string; details: { issues: Issue[] } } }>().error.details.issues;

const title = { apiKey: 'title', label: 'Title', type: 'string' };

/**
 * The planner, sync and permissions with interfaces (plan interfaces, WP4): implements and contract changes
 * are classified, a relation target that widens keeps its values, a change that would strand relation values
 * is refused with the count (decision 9), delete and scope guards, the members are the activation's affected
 * models, an interface and its members change together in a change set, and grants never name an interface.
 */
describe('interfaces: planner', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let worker: Worker;
  let featurable: ModelBody;
  let blogPost: ModelBody;
  let roadmapItem: ModelBody;
  let note: ModelBody;
  let product: ModelBody;
  let digital: ModelBody;
  let page: ModelBody;
  let pageEntry: EntryBody;
  let roadmapEntry: EntryBody;
  let digitalEntry: EntryBody;

  const reload = async (category: 'models' | 'interfaces', id: string) =>
    expectStatus(await admin.get(`/api/admin/${category}/${id}`), 200).json<ModelBody>();
  const entry = async (apiKey: string, data: Record<string, unknown>) =>
    expectStatus(await admin.post(`/api/admin/content/${apiKey}`, { data }), 201).json<EntryBody>();
  const headData = async (entryId: string) =>
    (
      await database.current.db
        .selectFrom('entry_heads')
        .select('data')
        .where('entry_id', '=', entryId)
        .executeTakeFirstOrThrow()
    ).data as Record<string, unknown>;
  const preview = async (category: 'models' | 'interfaces', current: ModelBody, definition: unknown) =>
    expectStatus(
      await admin.post(`/api/admin/${category}/${current.definition.id}/plan`, {
        definition,
        expectedVersion: current.version,
      }),
      200,
    ).json<PreviewBody>();
  const save = (category: 'models' | 'interfaces', current: ModelBody, definition: unknown) =>
    admin.put(`/api/admin/${category}/${current.definition.id}`, {
      definition,
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
  const remove = (category: 'models' | 'interfaces', current: ModelBody) =>
    admin.delete(
      `/api/admin/${category}/${current.definition.id}?expectedVersion=${current.version}&acknowledgeBreaking=true`,
    );
  const withTarget = (model: ModelBody, fieldApiKey: string, target: string) => ({
    ...model.definition,
    fields: model.definition.fields.map((field) =>
      field.apiKey === fieldApiKey
        ? { ...field, settings: { ...(field.settings as object), target } }
        : field,
    ),
  });
  const create = (definition: Record<string, unknown>, kind: 'models' | 'components' = 'models') =>
    createDefinition(admin, definition, kind, 'network');
  const createInterface = async (definition: Record<string, unknown>) => {
    const created = expectStatus(
      await admin.post('/api/admin/interfaces', {
        definition: { kind: 'interface', ...definition },
        scope: 'network',
      }),
      201,
    ).json<{ definitionId: string }>();
    return reload('interfaces', created.definitionId);
  };

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    worker = createPublishingWorker({ db: database.current.db, app: testApp.app });
    featurable = await createInterface({ apiKey: 'featurable', label: 'Featurable', fields: [title] });
    const implementing = { implements: [featurable.definition.id], fields: [title] };
    blogPost = await create({ kind: 'collection', apiKey: 'blogPost', label: 'Blog post', ...implementing });
    roadmapItem = await create({ kind: 'collection', apiKey: 'roadmapItem', label: 'Item', ...implementing });
    note = await create({ kind: 'collection', apiKey: 'note', label: 'Note', fields: [title] });
    product = await create({ kind: 'collection', apiKey: 'product', label: 'Product', fields: [title] });
    digital = await create({
      kind: 'collection',
      apiKey: 'digital',
      label: 'Digital',
      extends: product.definition.id,
      fields: [],
    });
    page = await create({
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [
        title,
        {
          apiKey: 'pick',
          label: 'Pick',
          type: 'relation',
          settings: { target: roadmapItem.definition.id, cardinality: 'many' },
        },
        {
          apiKey: 'product',
          label: 'Product',
          type: 'relation',
          settings: { target: product.definition.id, cardinality: 'one' },
        },
      ],
    });
    roadmapEntry = await entry('roadmapItem', { title: 'Interfaces' });
    digitalEntry = await entry('digital', { title: 'Ebook' });
    pageEntry = await entry('page', {
      title: 'Home',
      pick: [roadmapEntry.id],
      product: digitalEntry.id,
    });
  });

  afterAll(async () => {
    await worker.stop(500);
    await testApp.app.close();
  });

  it('implements added is a non-breaking contract change; removed is breaking', async () => {
    const joined = { ...note.definition, implements: [featurable.definition.id] };
    const added = await preview('models', note, joined);
    expect(added.plan.changes).toMatchObject([
      { kind: 'model.implements', category: 'contract', breaking: false, destructive: false },
    ]);
    expectStatus(await save('models', note, joined), 200);
    note = await reload('models', note.definition.id);
    const removed = await preview('models', note, { ...note.definition, implements: [] });
    expect(removed.plan.changes).toMatchObject([
      { kind: 'model.implements', category: 'contract', breaking: true, destructive: false },
    ]);
  });

  it('an interface change affects its members, and its activation says so', async () => {
    const renamed = { ...featurable.definition, label: 'Featured things' };
    const planned = await preview('interfaces', featurable, renamed);
    const members = [blogPost, roadmapItem, note].map((model) => model.definition.id).sort();
    expect([...planned.plan.affectedModelIds].sort()).toEqual(members);
    expect(planned.plan.prerequisites).toEqual([]);
    expectStatus(await save('interfaces', featurable, renamed), 200);
    featurable = await reload('interfaces', featurable.definition.id);
    const activated = await database.current.db
      .selectFrom('audit_events')
      .select(['metadata', 'target_type'])
      .where('action', '=', 'schema.activate')
      .where('target_id', '=', featurable.definition.id)
      .orderBy('occurred_at', 'desc')
      .executeTakeFirstOrThrow();
    expect(activated.target_type).toBe('interface');
    expect([...(activated.metadata as { affectedModelIds: string[] }).affectedModelIds].sort()).toEqual(
      members,
    );
  });

  it('a contract field a member lacks is refused, naming the member', async () => {
    const image = { apiKey: 'image', label: 'Image', type: 'media' };
    const response = await save('interfaces', featurable, {
      ...featurable.definition,
      fields: [...featurable.definition.fields, image],
    });
    expect(response.statusCode).toBe(422);
    const issues = issuesOf(response);
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'INTERFACE_FIELD_MISSING',
        definitionId: roadmapItem.definition.id,
        message: expect.stringContaining('"image"'),
      }),
    );
  });

  it('a change set with the contract field and the field on every member plans and ships', async () => {
    const set = expectStatus(
      await admin.post('/api/admin/change-sets', { title: 'Image' }),
      201,
    ).json<ChangeSet>();
    const image = { apiKey: 'image', label: 'Image', type: 'media' };
    const putDraft = (category: string, model: ModelBody) =>
      admin.put(`/api/admin/change-sets/${set.id}/schema/${model.definition.id}`, {
        category,
        definition: { ...model.definition, fields: [...model.definition.fields, image] },
        baseVersion: model.version,
      });
    // Drafts are checked against the set's other drafts: the members gain the field first, then the contract
    // requires it (the admin's "add it to these types" builds the set in this order).
    for (const member of [blogPost, roadmapItem, note]) {
      expectStatus(await putDraft('model', member), 200);
    }
    expectStatus(await putDraft('interface', featurable), 200);
    const review = expectStatus(await admin.get(`/api/admin/change-sets/${set.id}/review`), 200).json<{
      schema: Array<{ category: string; issues: Issue[] }>;
      checks: { blocking: Issue[] };
    }>();
    expect(review.checks.blocking).toEqual([]);
    expect(review.schema.map((item) => item.category).sort()).toEqual([
      'interface',
      'model',
      'model',
      'model',
    ]);
    const current = expectStatus(await admin.get(`/api/admin/change-sets/${set.id}`), 200).json<ChangeSet>();
    const shipped = await admin.post(`/api/admin/change-sets/${set.id}/ship`, {
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    expect([200, 202], shipped.body).toContain(shipped.statusCode);
    await drainJobs(worker, database.current.db, {
      types: [PUBLISHING_JOBS.changeSetShip, 'schema.followUp'],
    });
    const after = expectStatus(await admin.get(`/api/admin/change-sets/${set.id}`), 200).json<ChangeSet>();
    expect(after.status).toBe('shipped');
    featurable = await reload('interfaces', featurable.definition.id);
    expect(featurable.definition.fields.map((field) => field.apiKey)).toEqual(['title', 'image']);
    for (const member of [blogPost, roadmapItem, note]) {
      const reloaded = await reload('models', member.definition.id);
      expect(reloaded.definition.fields.map((field) => field.apiKey)).toContain('image');
    }
    blogPost = await reload('models', blogPost.definition.id);
    roadmapItem = await reload('models', roadmapItem.definition.id);
    note = await reload('models', note.definition.id);
  });

  it('widening a relation target (a collection to an interface it implements) keeps the values', async () => {
    const widened = withTarget(page, 'pick', featurable.definition.id);
    const planned = await preview('models', page, widened);
    expect(planned.plan.changes).toMatchObject([
      { kind: 'field.settings', category: 'contract', breaking: true, destructive: false },
    ]);
    expect(planned.plan.prerequisites).toEqual([]);
    expect(expectStatus(await save('models', page, widened), 200).json()).toMatchObject({
      status: 'activated',
    });
    page = await reload('models', page.definition.id);
    expect(await headData(pageEntry.id)).toMatchObject({ [fieldIdOf(page, 'pick')]: [roadmapEntry.id] });
  });

  it('removing implements while relations hold the type’s entries is refused with the count', async () => {
    const response = await save('models', roadmapItem, { ...roadmapItem.definition, implements: [] });
    expect(response.statusCode).toBe(422);
    expect(issuesOf(response)).toEqual([
      expect.objectContaining({
        code: 'RELATION_VALUES_EXIST',
        definitionId: roadmapItem.definition.id,
        message: expect.stringMatching(/^1 entry still relates to "roadmapItem" entries through "page.pick"/),
      }),
    ]);
    // Nothing changed.
    expect((await reload('models', roadmapItem.definition.id)).version).toBe(roadmapItem.version);
  });

  it('widening to any entry keeps the values; deleting a member they point at is refused', async () => {
    const anyEntry = withTarget(page, 'pick', '*');
    expectStatus(await save('models', page, anyEntry), 200);
    page = await reload('models', page.definition.id);
    expect(await headData(pageEntry.id)).toMatchObject({ [fieldIdOf(page, 'pick')]: [roadmapEntry.id] });
    const response = await remove('models', roadmapItem);
    expect(response.statusCode).toBe(422);
    expect(issuesOf(response)).toEqual([
      expect.objectContaining({ code: 'RELATION_VALUES_EXIST', definitionId: roadmapItem.definition.id }),
    ]);
  });

  it('deleting a kind while a relation to its parent holds its entries is refused', async () => {
    const response = await remove('models', digital);
    expect(response.statusCode).toBe(422);
    expect(issuesOf(response)).toEqual([
      expect.objectContaining({
        code: 'RELATION_VALUES_EXIST',
        definitionId: digital.definition.id,
        message: expect.stringContaining('"page.product" (a relation to "product")'),
      }),
    ]);
  });

  it('narrowing a relation target clears its values; then implements can be removed', async () => {
    const narrowed = withTarget(page, 'pick', blogPost.definition.id);
    const planned = await preview('models', page, narrowed);
    expect(planned.plan.changes).toMatchObject([{ category: 'conversion', destructive: true }]);
    expectStatus(await save('models', page, narrowed), 202);
    await runContentSchemaJobs(database.current.db);
    page = await reload('models', page.definition.id);
    expect((await headData(pageEntry.id))[fieldIdOf(page, 'pick')] ?? null).toBeNull();
    expectStatus(await save('models', roadmapItem, { ...roadmapItem.definition, implements: [] }), 200);
  });

  it('an interface with members, or targeted by a relation, cannot be deleted', async () => {
    const withMembers = await remove('interfaces', featurable);
    expect(withMembers.statusCode).toBe(422);
    expect(issuesOf(withMembers).map((found) => found.code)).toContain('HAS_MEMBERS');

    const listable = await createInterface({ apiKey: 'listable', label: 'Listable', fields: [] });
    const linked = {
      ...page.definition,
      fields: [
        ...page.definition.fields,
        {
          apiKey: 'listed',
          label: 'Listed',
          type: 'relation',
          settings: { target: listable.definition.id, cardinality: 'many' },
        },
      ],
    };
    expectStatus(await save('models', page, linked), 200);
    page = await reload('models', page.definition.id);
    const targeted = await remove('interfaces', listable);
    expect(targeted.statusCode).toBe(422);
    expect(issuesOf(targeted)).toEqual([
      expect.objectContaining({ code: 'REFERENCED_DEFINITION', definitionId: page.definition.id }),
    ]);
  });

  it('a grant never names an interface', async () => {
    const response = await admin.post('/api/admin/roles', {
      key: 'featurable-reader',
      name: 'Featurable reader',
      kind: 'delivery',
      permissions: [{ action: 'read', modelId: featurable.definition.id, condition: null, fieldIds: null }],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'UNKNOWN_MODEL', details: { modelIds: [featurable.definition.id] } },
    });
  });

  describe('scope', () => {
    const onSite = (siteKey: string) => {
      const headers = { [SITE_HEADER]: siteKey };
      return {
        get: (url: string) => admin.request({ method: 'GET', url, headers }),
        post: (url: string, payload: unknown) =>
          admin.request({ method: 'POST', url, payload: payload as object, headers }),
        put: (url: string, payload: unknown) =>
          admin.request({ method: 'PUT', url, payload: payload as object, headers }),
      };
    };
    const onA = onSite('default');
    let shared: ModelBody;

    beforeAll(async () => {
      expectStatus(await onA.post('/api/admin/sites', { key: 'b', name: 'Site B' }), 201);
      shared = await createInterface({ apiKey: 'sharedThing', label: 'Shared thing', fields: [title] });
      const member = expectStatus(
        await onA.post('/api/admin/models', {
          definition: {
            kind: 'collection',
            apiKey: 'localThing',
            label: 'Local thing',
            implements: [shared.definition.id],
            fields: [title],
          },
          scope: 'site',
        }),
        201,
      );
      expect(member.json()).toMatchObject({ definitionId: expect.any(String) });
    });

    const changeScope = (body: Record<string, unknown>) =>
      onA.put(`/api/admin/interfaces/${shared.definition.id}/scope`, { version: shared.version, ...body });

    it('a shared interface cannot move to a site its members are not on', async () => {
      const sites = expectStatus(await onA.get('/api/admin/sites'), 200).json<
        Array<{ id: string; key: string }> | { items: Array<{ id: string; key: string }> }
      >();
      const list = Array.isArray(sites) ? sites : sites.items;
      const siteB = list.find((site) => site.key === 'b');
      const refused = await changeScope({ scope: 'site', siteId: siteB?.id });
      expect(refused.statusCode).toBe(422);
      expect(issuesOf(refused).map((found) => found.code)).toContain('INVALID_INTERFACE');
    });

    it('it can move to its members’ site, and back to every site', async () => {
      const kept = expectStatus(await changeScope({ scope: 'site' }), 200).json<{ version: number }>();
      shared = { ...shared, version: kept.version };
      const back = expectStatus(await changeScope({ scope: 'network' }), 200).json<{ version: number }>();
      expect(back).toMatchObject({ scope: 'network', siteId: null });
    });
  });
});
