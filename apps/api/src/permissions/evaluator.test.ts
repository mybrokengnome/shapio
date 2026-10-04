import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { GrantSource } from './cache.js';
import { createPermissionEvaluator } from './evaluator.js';
import { createStaticFieldVisibility, type Grant } from './policy.js';
import { narrowToSite } from './sites.js';
import {
  CONTENT_ACTIONS,
  DENIED_POLICY,
  GLOBAL_ACTIONS,
  NETWORK_ACTIONS,
  type ContentAction,
  type Principal,
} from './types.js';

const staticGrants = (grants: readonly Grant[]): GrantSource => ({
  getGrants: (roleIds) => Promise.resolve(grants.filter((grant) => roleIds.includes(grant.roleId))),
  getSiteAppRoleIds: () => Promise.resolve([]),
});

const MODEL = 'model-page';
const fields = createStaticFieldVisibility({
  [MODEL]: [
    { id: 'f-title', public: true },
    { id: 'f-body', public: true },
    { id: 'f-notes', public: false },
  ],
});

const grant = (overrides: Partial<Grant> & Pick<Grant, 'roleId' | 'action'>): Grant => ({
  modelId: null,
  condition: null,
  fieldIds: null,
  ...overrides,
});

const uuid = fc.uuid();
const SITE_A = '00000000-0000-4000-b000-00000000000a';
const SITE_B = '00000000-0000-4000-b000-00000000000b';

/** An admin narrowed to site A whose roles are all assigned on every site. */
const adminOn = (roleIds: readonly string[]): Principal =>
  narrowToSite(
    { adminUserId: 'u', sessionId: 's', assignments: roleIds.map((roleId) => ({ roleId, siteId: null })) },
    SITE_A,
  );
const contentAction = fc.constantFrom(...CONTENT_ACTIONS);
const globalAction = fc.constantFrom(...GLOBAL_ACTIONS);

/** Any principal a request can carry (system principals are never derived from requests). */
const requestPrincipal: fc.Arbitrary<Principal> = fc.oneof(
  fc
    .record({
      adminUserId: uuid,
      sessionId: uuid,
      assignments: fc.array(fc.record({ roleId: uuid, siteId: fc.constantFrom(null, SITE_A, SITE_B) }), {
        maxLength: 4,
      }),
    })
    .map((identity) => narrowToSite(identity, SITE_A)),
  fc.record({
    kind: fc.constant('appUser' as const),
    appUserId: uuid,
    siteId: fc.constant(SITE_A),
    roleIds: fc.array(uuid, { maxLength: 4 }),
  }),
  fc.record({
    kind: fc.constant('token' as const),
    tokenId: uuid,
    scope: fc.constantFrom('admin' as const, 'delivery' as const),
    roleId: uuid,
    siteId: fc.constantFrom(null, SITE_A),
  }),
  fc.constant({ kind: 'anonymous' as const, siteId: SITE_A }),
);

const randomGrant: fc.Arbitrary<Grant> = fc.record({
  roleId: uuid,
  action: fc.oneof(contentAction, globalAction),
  modelId: fc.option(fc.constantFrom(MODEL, 'model-other'), { nil: null }),
  condition: fc.constantFrom(null, 'ownedByPrincipal' as const),
  fieldIds: fc.option(fc.subarray(['f-title', 'f-body', 'f-notes']), { nil: null }),
});

describe('permission evaluator', () => {
  it('denies random principals whose roles hold no grants (deny by default)', async () => {
    await fc.assert(
      fc.asyncProperty(
        requestPrincipal,
        fc.array(randomGrant, { maxLength: 20 }),
        contentAction,
        globalAction,
        async (principal, grants, action, global) => {
          // Grants exist, but only for roles the principal does not hold (fresh UUIDs never collide).
          const evaluator = createPermissionEvaluator({ grants: staticGrants(grants), fields });
          expect(await evaluator.evaluate(principal, { action, modelId: MODEL })).toEqual(DENIED_POLICY);
          expect(await evaluator.canPerform(principal, global)).toBe(false);
        },
      ),
    );
  });

  it('allows an admin exactly when one of its roles grants the action on that model or all models', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(randomGrant, { maxLength: 20 }), contentAction, async (grants, action) => {
        const roleIds = [...new Set(grants.map((g) => g.roleId))];
        const principal: Principal = adminOn(roleIds);
        const evaluator = createPermissionEvaluator({ grants: staticGrants(grants), fields });
        const policy = await evaluator.evaluate(principal, { action, modelId: MODEL });
        const expected = grants.some(
          (g) => g.action === action && (g.modelId === null || g.modelId === MODEL),
        );
        expect(policy.allowed).toBe(expected);
        if (!expected) {
          expect(policy).toEqual(DENIED_POLICY);
        }
      }),
    );
  });

  it('never shows a non-public field to a delivery token unless a grant names it', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(randomGrant, { maxLength: 10 }), async (generated) => {
        const roleId = 'delivery-role';
        const grants = generated.map((g) => ({ ...g, roleId }));
        const evaluator = createPermissionEvaluator({ grants: staticGrants(grants), fields });
        const principal: Principal = {
          kind: 'token',
          tokenId: 't',
          scope: 'delivery',
          roleId,
          siteId: SITE_A,
        };
        const policy = await evaluator.evaluate(principal, { action: 'read', modelId: MODEL });
        const named = grants.some(
          (g) =>
            g.action === 'read' &&
            (g.modelId === null || g.modelId === MODEL) &&
            (g.fieldIds ?? []).includes('f-notes'),
        );
        expect(policy.readMask.mode).toBe('only');
        const visible = policy.readMask.mode === 'only' ? policy.readMask.fieldIds : [];
        expect(visible.includes('f-notes')).toBe(named);
      }),
    );
  });

  it('gives delivery tokens read access only', async () => {
    const roleId = 'r';
    const grants = CONTENT_ACTIONS.map((action) => grant({ roleId, action }));
    const evaluator = createPermissionEvaluator({ grants: staticGrants(grants), fields });
    const principal: Principal = { kind: 'token', tokenId: 't', scope: 'delivery', roleId, siteId: SITE_A };
    for (const action of CONTENT_ACTIONS.filter((a): a is Exclude<ContentAction, 'read'> => a !== 'read')) {
      expect(await evaluator.evaluate(principal, { action, modelId: MODEL })).toEqual(DENIED_POLICY);
    }
    expect(await evaluator.evaluate(principal, { action: 'read', modelId: MODEL })).toEqual({
      allowed: true,
      rowFilter: null,
      readMask: { mode: 'only', fieldIds: ['f-title', 'f-body'] },
      writeMask: { mode: 'only', fieldIds: [] },
    });
    expect(await evaluator.canPerform(principal, 'schema.create')).toBe(false);
  });

  it('denies delivery reads of a model the schema does not know', async () => {
    const evaluator = createPermissionEvaluator({
      grants: staticGrants([grant({ roleId: 'r', action: 'read' })]),
      fields,
    });
    const principal: Principal = {
      kind: 'token',
      tokenId: 't',
      scope: 'delivery',
      roleId: 'r',
      siteId: SITE_A,
    };
    expect(await evaluator.evaluate(principal, { action: 'read', modelId: 'missing' })).toEqual(
      DENIED_POLICY,
    );
  });

  it('combines grants: union of fields, any unconditional grant lifts the row filter', async () => {
    const grants = [
      grant({
        roleId: 'a',
        action: 'update',
        modelId: MODEL,
        condition: 'ownedByPrincipal',
        fieldIds: ['f-title'],
      }),
      grant({ roleId: 'b', action: 'update', fieldIds: ['f-body'] }),
      grant({ roleId: 'a', action: 'read', fieldIds: ['f-title'] }),
    ];
    const evaluator = createPermissionEvaluator({ grants: staticGrants(grants), fields });
    const owned: Principal = adminOn(['a']);
    expect(await evaluator.evaluate(owned, { action: 'update', modelId: MODEL })).toEqual({
      allowed: true,
      rowFilter: { kind: 'ownedByPrincipal' },
      readMask: { mode: 'only', fieldIds: ['f-title'] },
      writeMask: { mode: 'only', fieldIds: ['f-title'] },
    });
    const both: Principal = adminOn(['a', 'b']);
    expect(await evaluator.evaluate(both, { action: 'update', modelId: MODEL })).toMatchObject({
      rowFilter: null,
      writeMask: { mode: 'only', fieldIds: ['f-body', 'f-title'] },
    });
  });

  it('lets admins see every field with a wildcard grant, and the system principal do anything', async () => {
    const evaluator = createPermissionEvaluator({
      grants: staticGrants([
        grant({ roleId: 'r', action: 'read' }),
        grant({ roleId: 'r', action: 'schema.create' }),
      ]),
      fields,
    });
    const admin: Principal = adminOn(['r']);
    expect((await evaluator.evaluate(admin, { action: 'read', modelId: 'anything' })).readMask).toEqual({
      mode: 'all',
    });
    expect(await evaluator.canPerform(admin, 'schema.create')).toBe(true);
    expect(await evaluator.canPerform(admin, 'users.manage')).toBe(false);
    const system: Principal = { kind: 'system', component: 'scheduler' };
    expect((await evaluator.evaluate(system, { action: 'delete', modelId: MODEL })).allowed).toBe(true);
    expect(await evaluator.canPerform(system, 'users.manage')).toBe(true);
  });

  it('ignores a global grant scoped to a model', async () => {
    const evaluator = createPermissionEvaluator({
      grants: staticGrants([grant({ roleId: 'r', action: 'schema.create', modelId: MODEL })]),
      fields,
    });
    const admin: Principal = adminOn(['r']);
    expect(await evaluator.canPerform(admin, 'schema.create')).toBe(false);
  });
  it('never grants a network action through a role assigned on one site only', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(randomGrant, { maxLength: 20 }),
        fc.constantFrom(...NETWORK_ACTIONS),
        fc.constantFrom(SITE_A, SITE_B),
        async (grants, action, siteId) => {
          const roleIds = [...new Set(grants.map((g) => g.roleId))];
          const principal = narrowToSite(
            { adminUserId: 'u', sessionId: 's', assignments: roleIds.map((roleId) => ({ roleId, siteId })) },
            siteId,
          );
          const evaluator = createPermissionEvaluator({ grants: staticGrants(grants), fields });
          expect(await evaluator.canPerform(principal, action)).toBe(false);
          expect(
            (await evaluator.evaluate(principal, { action: 'schemaManage', modelId: MODEL })).allowed,
          ).toBe(false);
        },
      ),
    );
  });

  it('applies a site role on its own site only, and a role assigned on every site everywhere', async () => {
    const grants = [
      grant({ roleId: 'site-editor', action: 'read' }),
      grant({ roleId: 'site-editor', action: 'media.read' }),
      grant({ roleId: 'site-editor', action: 'users.manage' }),
      grant({ roleId: 'everywhere', action: 'publish' }),
    ];
    const evaluator = createPermissionEvaluator({ grants: staticGrants(grants), fields });
    const identity = {
      adminUserId: 'u',
      sessionId: 's',
      assignments: [
        { roleId: 'site-editor', siteId: SITE_A },
        { roleId: 'everywhere', siteId: null },
      ],
    };
    const onA = narrowToSite(identity, SITE_A);
    const onB = narrowToSite(identity, SITE_B);
    expect((await evaluator.evaluate(onA, { action: 'read', modelId: MODEL })).allowed).toBe(true);
    expect((await evaluator.evaluate(onB, { action: 'read', modelId: MODEL })).allowed).toBe(false);
    expect(await evaluator.canPerform(onA, 'media.read')).toBe(true);
    expect(await evaluator.canPerform(onB, 'media.read')).toBe(false);
    // users.manage is a network action: a role held on site A never grants it, even on site A.
    expect(await evaluator.canPerform(onA, 'users.manage')).toBe(false);
    for (const principal of [onA, onB]) {
      expect((await evaluator.evaluate(principal, { action: 'publish', modelId: MODEL })).allowed).toBe(true);
    }
  });

  it('gives a site admin token no network actions and a network admin token its role everywhere', async () => {
    const grants = [
      grant({ roleId: 'r', action: 'users.manage' }),
      grant({ roleId: 'r', action: 'tokens.manage' }),
    ];
    const evaluator = createPermissionEvaluator({ grants: staticGrants(grants), fields });
    const siteToken: Principal = { kind: 'token', tokenId: 't', scope: 'admin', roleId: 'r', siteId: SITE_A };
    const networkToken: Principal = { ...siteToken, siteId: null };
    expect(await evaluator.canPerform(siteToken, 'tokens.manage')).toBe(true);
    expect(await evaluator.canPerform(siteToken, 'users.manage')).toBe(false);
    expect(await evaluator.canPerform(networkToken, 'users.manage')).toBe(true);
  });

  describe('schema per site (plan site-schema)', () => {
    const SITE_MODEL = 'model-site-a';
    const scoped = createStaticFieldVisibility({}, { modelSites: { [SITE_MODEL]: SITE_A } });
    const grants = [
      grant({ roleId: 'r', action: 'schema.create' }),
      grant({ roleId: 'r', action: 'schemaManage' }),
    ];
    const evaluator = createPermissionEvaluator({ grants: staticGrants(grants), fields: scoped });
    const manage = (principal: Principal, modelId: string) =>
      evaluator.evaluate(principal, { action: 'schemaManage', modelId }).then((policy) => policy.allowed);

    it('a role on one site creates and manages that site’s definitions only, never shared ones', async () => {
      const identity = { adminUserId: 'u', sessionId: 's', assignments: [{ roleId: 'r', siteId: SITE_A }] };
      const onA = narrowToSite(identity, SITE_A);
      const onB = narrowToSite(identity, SITE_B);
      expect(await evaluator.canPerformOnSite(onA, 'schema.create', SITE_A)).toBe(true);
      expect(await evaluator.canPerformOnSite(onB, 'schema.create', SITE_B)).toBe(false);
      expect(await evaluator.canPerform(onA, 'schema.create')).toBe(false);
      expect(await manage(onA, SITE_MODEL)).toBe(true);
      expect(await manage(onB, SITE_MODEL)).toBe(false);
      expect(await manage(onA, MODEL)).toBe(false);
      // Asking for another site than the principal acts on counts network roles only.
      expect(await evaluator.canPerformOnSite(onA, 'schema.create', SITE_B)).toBe(false);
    });

    it('a site token is denied schema.create on network routes; a network token has it everywhere', async () => {
      const siteToken: Principal = {
        kind: 'token',
        tokenId: 't',
        scope: 'admin',
        roleId: 'r',
        siteId: SITE_A,
      };
      const networkToken: Principal = { ...siteToken, siteId: null };
      expect(await evaluator.canPerform(siteToken, 'schema.create')).toBe(false);
      expect(await evaluator.canPerformOnSite(siteToken, 'schema.create', SITE_A)).toBe(true);
      expect(await evaluator.canPerformOnSite(siteToken, 'schema.create', SITE_B)).toBe(false);
      expect(await manage(siteToken, SITE_MODEL)).toBe(true);
      expect(await manage(siteToken, MODEL)).toBe(false);
      expect(await evaluator.canPerform(networkToken, 'schema.create')).toBe(true);
      expect(await manage(networkToken, MODEL)).toBe(true);
      expect(await manage(networkToken, SITE_MODEL)).toBe(true);
    });
  });
});
