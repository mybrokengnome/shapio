import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { GrantSource } from './cache.js';
import { createPermissionEvaluator } from './evaluator.js';
import { createStaticFieldVisibility, type Grant } from './policy.js';
import {
  CONTENT_ACTIONS,
  DENIED_POLICY,
  GLOBAL_ACTIONS,
  type ContentAction,
  type Principal,
} from './types.js';

const staticGrants = (grants: readonly Grant[]): GrantSource => ({
  getGrants: (roleIds) => Promise.resolve(grants.filter((grant) => roleIds.includes(grant.roleId))),
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
const contentAction = fc.constantFrom(...CONTENT_ACTIONS);
const globalAction = fc.constantFrom(...GLOBAL_ACTIONS);

/** Any principal a request can carry (system principals are never derived from requests). */
const requestPrincipal: fc.Arbitrary<Principal> = fc.oneof(
  fc.record({
    kind: fc.constant('admin' as const),
    adminUserId: uuid,
    sessionId: uuid,
    roleIds: fc.array(uuid, { maxLength: 4 }),
  }),
  fc.record({
    kind: fc.constant('appUser' as const),
    appUserId: uuid,
    roleIds: fc.array(uuid, { maxLength: 4 }),
  }),
  fc.record({
    kind: fc.constant('token' as const),
    tokenId: uuid,
    scope: fc.constantFrom('admin' as const, 'delivery' as const),
    roleId: uuid,
  }),
  fc.constant({ kind: 'anonymous' as const }),
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
        const principal: Principal = { kind: 'admin', adminUserId: 'u', sessionId: 's', roleIds };
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
        const principal: Principal = { kind: 'token', tokenId: 't', scope: 'delivery', roleId };
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
    const principal: Principal = { kind: 'token', tokenId: 't', scope: 'delivery', roleId };
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
    const principal: Principal = { kind: 'token', tokenId: 't', scope: 'delivery', roleId: 'r' };
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
    const owned: Principal = { kind: 'admin', adminUserId: 'u', sessionId: 's', roleIds: ['a'] };
    expect(await evaluator.evaluate(owned, { action: 'update', modelId: MODEL })).toEqual({
      allowed: true,
      rowFilter: { kind: 'ownedByPrincipal' },
      readMask: { mode: 'only', fieldIds: ['f-title'] },
      writeMask: { mode: 'only', fieldIds: ['f-title'] },
    });
    const both: Principal = { ...owned, roleIds: ['a', 'b'] };
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
    const admin: Principal = { kind: 'admin', adminUserId: 'u', sessionId: 's', roleIds: ['r'] };
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
    const admin: Principal = { kind: 'admin', adminUserId: 'u', sessionId: 's', roleIds: ['r'] };
    expect(await evaluator.canPerform(admin, 'schema.create')).toBe(false);
  });
});
