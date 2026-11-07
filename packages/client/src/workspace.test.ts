import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createClient } from './client.js';
import { createDeliveryClient } from './deliveryClient.js';
import type { RequestFn } from './request.js';
import { applySite } from './site.js';
import {
  shapioTags,
  WORKSPACE_HEADER,
  WORKSPACE_QUERY_PARAMETER,
  type CreateSiteInput,
  type CreateWorkspaceInput,
  type DeliverySite,
  type DeliveryWorkspace,
  type SetSiteAppRolesInput,
  type SetWorkspaceAppRolesInput,
  type Site,
  type SiteApi,
  type SiteAppRoles,
  type SiteChangeSets,
  type SiteRef,
  type SiteSummary,
  type UpdateSiteChangeSetsInput,
  type UpdateSiteInput,
  type UpdateWorkspaceChangeSetsInput,
  type UpdateWorkspaceInput,
  type Workspace,
  type WorkspaceApi,
  type WorkspaceAppRoles,
  type WorkspaceChangeSets,
  type WorkspaceRef,
  type WorkspaceSummary,
} from './index.js';

const ok = () =>
  new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });

type Call = { url: string; method: string | undefined; headers: Record<string, string>; body: unknown };

const callsOf = (fetch: ReturnType<typeof vi.fn>): Call[] =>
  (fetch.mock.calls as unknown as Array<[string, RequestInit]>).map(([url, init]) => ({
    url,
    method: init.method,
    headers: init.headers as Record<string, string>,
    body: init.body,
  }));

/** One client per option spelling, each over its own recording fetch. */
const clientWith = (options: { workspace?: string; site?: string }) => {
  const fetch = vi.fn(async () => ok());
  return { fetch, client: createClient({ baseUrl: 'https://cms.test', token: 't', fetch, ...options }) };
};

describe('the workspace option', () => {
  it('sends exactly what the site option sends: ?site= on delivery reads, Shapio-Site elsewhere', async () => {
    const exercise = async (client: ReturnType<typeof createClient>) => {
      await client.delivery.list('articles', { locale: 'fr' });
      await client.snapshots.current();
      await client.workspace.get();
      await client.site.get();
      await client.request('/api/content/articles', { method: 'POST', body: { data: {} } });
      await client.admin.workspaces.list();
    };
    const byWorkspace = clientWith({ workspace: 'marketing' });
    const bySite = clientWith({ site: 'marketing' });
    await exercise(byWorkspace.client);
    await exercise(bySite.client);

    const calls = callsOf(byWorkspace.fetch);
    expect(calls).toEqual(callsOf(bySite.fetch));
    expect(calls.map((call) => call.url)).toEqual([
      'https://cms.test/api/content/articles?locale=fr&site=marketing',
      'https://cms.test/api/snapshots/current?site=marketing',
      'https://cms.test/api/site?site=marketing',
      'https://cms.test/api/site?site=marketing',
      'https://cms.test/api/content/articles',
      'https://cms.test/api/admin/sites',
    ]);
    expect(calls[4]?.headers).toMatchObject({ 'shapio-site': 'marketing' });
    expect(calls[5]?.headers).toMatchObject({ 'shapio-site': 'marketing' });
    for (const call of calls) {
      expect(call.headers).not.toHaveProperty(WORKSPACE_HEADER);
      expect(call.url).not.toContain(`${WORKSPACE_QUERY_PARAMETER}=`);
    }
  });

  it('accepts both options when they name the same workspace', async () => {
    const { fetch, client } = clientWith({ workspace: 'blog', site: 'blog' });
    await client.admin.workspaces.list();
    expect(callsOf(fetch)[0]?.headers).toMatchObject({ 'shapio-site': 'blog' });
  });

  it('refuses both options naming different workspaces', () => {
    expect(() => clientWith({ workspace: 'blog', site: 'docs' })).toThrow(
      /createClient: the workspace option \('blog'\) and the site option \('docs'\) name different workspaces/,
    );
    expect(() =>
      createDeliveryClient(vi.fn() as unknown as RequestFn, { workspace: 'a', site: 'b' }),
    ).toThrow(/different workspaces/);
  });

  it('exports the newer raw-request spellings', () => {
    expect(WORKSPACE_HEADER).toBe('shapio-workspace');
    expect(WORKSPACE_QUERY_PARAMETER).toBe('workspace');
  });
});

describe('a path that already names its workspace', () => {
  it('is left alone when it carries ?workspace=, as with ?site=', () => {
    expect(applySite('marketing', 'GET', '/api/content/articles?workspace=docs')).toEqual({
      path: '/api/content/articles?workspace=docs',
      headers: {},
    });
    expect(applySite('marketing', 'GET', '/api/workspace?locale=fr&workspace=docs')).toEqual({
      path: '/api/workspace?locale=fr&workspace=docs',
      headers: {},
    });
    expect(applySite('marketing', 'POST', '/api/graphql?workspace=docs')).toEqual({
      path: '/api/graphql?workspace=docs',
      headers: {},
    });
  });

  it('treats a GET of /api/workspace as a delivery read, like /api/site', () => {
    expect(applySite('marketing', 'GET', '/api/workspace')).toEqual({
      path: '/api/workspace?site=marketing',
      headers: {},
    });
    expect(applySite('marketing', 'GET', '/api/workspace?locale=fr')).toEqual({
      path: '/api/workspace?locale=fr&site=marketing',
      headers: {},
    });
    expect(applySite('marketing', 'GET', '/api/workspaces')).toEqual({
      path: '/api/workspaces',
      headers: { 'shapio-site': 'marketing' },
    });
  });
});

describe('the workspace namespaces', () => {
  it('admin.workspaces and admin.workspace hit the same paths as admin.sites and admin.site', async () => {
    const rename = { expectedVersion: 1, name: 'Blog' };
    const roles = { public: [], authenticated: [] };
    const changeSets = { expectedVersion: 1, mode: 'off' as const };
    const exerciseWorkspaces = async ({ admin }: ReturnType<typeof createClient>) => {
      await admin.workspaces.list();
      await admin.workspaces.get('w1');
      await admin.workspaces.create({ key: 'blog', name: 'Blog' });
      await admin.workspaces.update('w1', rename);
      await admin.workspaces.remove('w1');
      await admin.workspaces.makePrimary('w1');
      await admin.workspaces.appRoles.get('w1');
      await admin.workspaces.appRoles.set('w1', roles);
      await admin.workspace.changeSets.get();
      await admin.workspace.changeSets.update(changeSets);
    };
    const exerciseSites = async ({ admin }: ReturnType<typeof createClient>) => {
      await admin.sites.list();
      await admin.sites.get('w1');
      await admin.sites.create({ key: 'blog', name: 'Blog' });
      await admin.sites.update('w1', rename);
      await admin.sites.remove('w1');
      await admin.sites.makePrimary('w1');
      await admin.sites.appRoles.get('w1');
      await admin.sites.appRoles.set('w1', roles);
      await admin.site.changeSets.get();
      await admin.site.changeSets.update(changeSets);
    };
    const newNames = clientWith({ workspace: 'blog' });
    const oldNames = clientWith({ site: 'blog' });
    await exerciseWorkspaces(newNames.client);
    await exerciseSites(oldNames.client);

    const calls = callsOf(newNames.fetch);
    expect(calls).toEqual(callsOf(oldNames.fetch));
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET https://cms.test/api/admin/sites',
      'GET https://cms.test/api/admin/sites/w1',
      'POST https://cms.test/api/admin/sites',
      'PATCH https://cms.test/api/admin/sites/w1',
      'DELETE https://cms.test/api/admin/sites/w1',
      'POST https://cms.test/api/admin/sites/w1/make-primary',
      'GET https://cms.test/api/admin/sites/w1/app-roles',
      'PUT https://cms.test/api/admin/sites/w1/app-roles',
      'GET https://cms.test/api/admin/site/change-sets',
      'PUT https://cms.test/api/admin/site/change-sets',
    ]);
  });

  it('client.workspace is client.site, with the same read and cache tag', async () => {
    const { client } = clientWith({ workspace: 'blog' });
    expect(client.workspace).toBe(client.site);
    expect(client.admin.workspaces).toBe(client.admin.sites);
    expect(client.admin.workspace).toBe(client.admin.site);

    const calls: Array<[string, unknown]> = [];
    const request = vi.fn(async (path: string, options?: unknown) => {
      calls.push([path, options]);
      return {};
    }) as unknown as RequestFn;
    await createDeliveryClient(request, { workspace: 'blog', next: {} }).workspace.get();
    await createDeliveryClient(request, { site: 'blog', next: {} }).site.get();
    expect(calls[0]).toEqual(['/api/site', { next: { tags: ['shapio:site:blog'] } }]);
    expect(calls[1]).toEqual(calls[0]);
  });

  it('shapioTags.workspace gives the same tags as shapioTags.site', () => {
    expect(shapioTags.workspace('blog')).toBe('shapio:site:blog');
    expect(shapioTags.workspace()).toBe('shapio:site');
    expect(shapioTags.workspace('blog')).toBe(shapioTags.site('blog'));
  });
});

describe('the workspace type names', () => {
  it('are the site types, assignable both ways', () => {
    expectTypeOf<Workspace>().toEqualTypeOf<Site>();
    expectTypeOf<WorkspaceSummary>().toEqualTypeOf<SiteSummary>();
    expectTypeOf<WorkspaceRef>().toEqualTypeOf<SiteRef>();
    expectTypeOf<CreateWorkspaceInput>().toEqualTypeOf<CreateSiteInput>();
    expectTypeOf<UpdateWorkspaceInput>().toEqualTypeOf<UpdateSiteInput>();
    expectTypeOf<WorkspaceAppRoles>().toEqualTypeOf<SiteAppRoles>();
    expectTypeOf<SetWorkspaceAppRolesInput>().toEqualTypeOf<SetSiteAppRolesInput>();
    expectTypeOf<WorkspaceChangeSets>().toEqualTypeOf<SiteChangeSets>();
    expectTypeOf<UpdateWorkspaceChangeSetsInput>().toEqualTypeOf<UpdateSiteChangeSetsInput>();
    expectTypeOf<DeliveryWorkspace>().toEqualTypeOf<DeliverySite>();
    expectTypeOf<WorkspaceApi>().toEqualTypeOf<SiteApi>();
  });
});
