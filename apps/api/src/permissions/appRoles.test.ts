import { describe, expect, it } from 'vitest';
import { APP_ROLE_IDS } from './appRoles.js';
import type { GrantSource } from './cache.js';
import { createPermissionEvaluator } from './evaluator.js';
import { createStaticFieldVisibility, type Grant } from './policy.js';
import { CONTENT_ACTIONS, DENIED_POLICY, GLOBAL_ACTIONS, type Principal } from './types.js';

const MODEL = 'model-post';
const fields = createStaticFieldVisibility({
  [MODEL]: [
    { id: 'f-title', public: true },
    { id: 'f-notes', public: false },
  ],
});

const staticGrants = (grants: readonly Grant[]): GrantSource => ({
  getGrants: (roleIds) => Promise.resolve(grants.filter((grant) => roleIds.includes(grant.roleId))),
});

const grant = (overrides: Partial<Grant> & Pick<Grant, 'roleId' | 'action'>): Grant => ({
  modelId: null,
  condition: null,
  fieldIds: null,
  ...overrides,
});

const anonymous: Principal = { kind: 'anonymous' };
const appUser = (roleIds: string[] = []): Principal => ({ kind: 'appUser', appUserId: 'u1', roleIds });

describe('app-user and anonymous principals', () => {
  it('denies anonymous callers when `public` grants nothing', async () => {
    const evaluator = createPermissionEvaluator({ grants: staticGrants([]), fields });
    for (const action of CONTENT_ACTIONS) {
      expect(await evaluator.evaluate(anonymous, { action, modelId: MODEL })).toEqual(DENIED_POLICY);
    }
  });

  it('gives anonymous callers exactly what `public` grants, with delivery field masks', async () => {
    const evaluator = createPermissionEvaluator({
      grants: staticGrants([grant({ roleId: APP_ROLE_IDS.public, action: 'read', modelId: MODEL })]),
      fields,
    });
    expect(await evaluator.evaluate(anonymous, { action: 'read', modelId: MODEL })).toEqual({
      allowed: true,
      rowFilter: null,
      readMask: { mode: 'only', fieldIds: ['f-title'] },
      writeMask: { mode: 'only', fieldIds: [] },
    });
    expect((await evaluator.evaluate(anonymous, { action: 'create', modelId: MODEL })).allowed).toBe(false);
  });

  it('applies `authenticated` to every app user on top of their own roles', async () => {
    const evaluator = createPermissionEvaluator({
      grants: staticGrants([
        grant({ roleId: APP_ROLE_IDS.authenticated, action: 'read' }),
        grant({ roleId: 'writer', action: 'update', condition: 'ownedByPrincipal', fieldIds: ['f-notes'] }),
      ]),
      fields,
    });
    expect((await evaluator.evaluate(appUser(), { action: 'read', modelId: MODEL })).allowed).toBe(true);
    expect((await evaluator.evaluate(appUser(), { action: 'update', modelId: MODEL })).allowed).toBe(false);
    expect(await evaluator.evaluate(appUser(['writer']), { action: 'update', modelId: MODEL })).toEqual({
      allowed: true,
      rowFilter: { kind: 'ownedByPrincipal' },
      readMask: { mode: 'only', fieldIds: ['f-title'] },
      writeMask: { mode: 'only', fieldIds: ['f-notes'] },
    });
    // The anonymous `public` role is not an app user's role.
    expect((await evaluator.evaluate(anonymous, { action: 'read', modelId: MODEL })).allowed).toBe(false);
  });

  it('never lets app roles manage schemas or perform instance actions', async () => {
    const everything = [...CONTENT_ACTIONS, ...GLOBAL_ACTIONS].flatMap((action) => [
      grant({ roleId: APP_ROLE_IDS.public, action }),
      grant({ roleId: APP_ROLE_IDS.authenticated, action }),
    ]);
    const evaluator = createPermissionEvaluator({ grants: staticGrants(everything), fields });
    for (const principal of [anonymous, appUser()]) {
      expect(await evaluator.evaluate(principal, { action: 'schemaManage', modelId: MODEL })).toEqual(
        DENIED_POLICY,
      );
      for (const action of GLOBAL_ACTIONS) {
        expect(await evaluator.canPerform(principal, action)).toBe(false);
      }
    }
  });
});
