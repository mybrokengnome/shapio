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

const SITE = '00000000-0000-4000-b000-000000000001';

/** Grants, with the site binding the built-in `public` and `authenticated` roles (as the primary site does). */
const staticGrants = (grants: readonly Grant[]): GrantSource => ({
  getGrants: (roleIds) => Promise.resolve(grants.filter((grant) => roleIds.includes(grant.roleId))),
  getSiteAppRoleIds: (siteId, audience) => Promise.resolve(siteId === SITE ? [APP_ROLE_IDS[audience]] : []),
});

const grant = (overrides: Partial<Grant> & Pick<Grant, 'roleId' | 'action'>): Grant => ({
  modelId: null,
  condition: null,
  fieldIds: null,
  ...overrides,
});

const anonymous: Principal = { kind: 'anonymous', siteId: SITE };
const appUser = (roleIds: string[] = []): Principal => ({
  kind: 'appUser',
  appUserId: 'u1',
  siteId: SITE,
  roleIds,
});

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
      readMask: { mode: 'only', fieldIds: ['f-title'], componentFields: 'public' },
      rowReadMasks: null,
      writeMask: { mode: 'only', fieldIds: [], componentFields: 'public' },
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
      readMask: { mode: 'only', fieldIds: ['f-title'], componentFields: 'public' },
      rowReadMasks: null,
      writeMask: { mode: 'only', fieldIds: ['f-notes'], componentFields: 'public' },
    });
    // `authenticated` is never an anonymous caller's role.
    expect((await evaluator.evaluate(anonymous, { action: 'read', modelId: MODEL })).allowed).toBe(false);
  });

  it('gives every app user the `public` roles as a floor (issue #56)', async () => {
    const evaluator = createPermissionEvaluator({
      grants: staticGrants([grant({ roleId: APP_ROLE_IDS.public, action: 'read', modelId: MODEL })]),
      fields,
    });
    const read = { action: 'read', modelId: MODEL } as const;
    // `authenticated` grants nothing; signing in still keeps what `public` gives.
    expect(await evaluator.evaluate(appUser(), read)).toEqual(await evaluator.evaluate(anonymous, read));
    expect((await evaluator.evaluate(appUser(), read)).allowed).toBe(true);
    // A site that binds no `public` role gives its app users nothing extra.
    const elsewhere: Principal = { kind: 'appUser', appUserId: 'u3', siteId: 'other-site', roleIds: [] };
    expect(await evaluator.evaluate(elsewhere, read)).toEqual(DENIED_POLICY);
  });

  it('unions `public` on every row with `authenticated` on own rows', async () => {
    const evaluator = createPermissionEvaluator({
      grants: staticGrants([
        grant({ roleId: APP_ROLE_IDS.public, action: 'read', modelId: MODEL }),
        grant({
          roleId: APP_ROLE_IDS.authenticated,
          action: 'read',
          modelId: MODEL,
          condition: 'ownedByPrincipal',
          fieldIds: ['f-title', 'f-notes'],
        }),
        grant({
          roleId: APP_ROLE_IDS.authenticated,
          action: 'update',
          modelId: MODEL,
          condition: 'ownedByPrincipal',
        }),
      ]),
      fields,
    });
    expect(await evaluator.evaluate(appUser(), { action: 'read', modelId: MODEL })).toEqual({
      allowed: true,
      rowFilter: null,
      readMask: { mode: 'only', fieldIds: ['f-title', 'f-notes'] },
      rowReadMasks: {
        everyRow: { mode: 'only', fieldIds: ['f-title'] },
        when: [
          {
            condition: { kind: 'ownedByPrincipal' },
            mask: { mode: 'only', fieldIds: ['f-title', 'f-notes'] },
          },
        ],
      },
      writeMask: { mode: 'only', fieldIds: [] },
    });
    expect(await evaluator.evaluate(appUser(), { action: 'update', modelId: MODEL })).toMatchObject({
      allowed: true,
      rowFilter: { kind: 'ownedByPrincipal' },
    });
    // Anonymous callers keep only `public`.
    expect(await evaluator.evaluate(anonymous, { action: 'read', modelId: MODEL })).toMatchObject({
      readMask: { mode: 'only', fieldIds: ['f-title'] },
      rowReadMasks: null,
    });
    expect((await evaluator.evaluate(anonymous, { action: 'update', modelId: MODEL })).allowed).toBe(false);
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

  it('grants only what the site binds: another site, or no site at all, binds nothing (deny by default)', async () => {
    const evaluator = createPermissionEvaluator({
      grants: staticGrants([
        grant({ roleId: APP_ROLE_IDS.public, action: 'read' }),
        grant({ roleId: APP_ROLE_IDS.authenticated, action: 'read' }),
        grant({ roleId: 'writer', action: 'create' }),
      ]),
      fields,
    });
    const otherSite = '00000000-0000-4000-b000-00000000000b';
    const read = { action: 'read', modelId: MODEL } as const;
    expect((await evaluator.evaluate(anonymous, read)).allowed).toBe(true);
    expect(await evaluator.evaluate({ kind: 'anonymous', siteId: otherSite }, read)).toEqual(DENIED_POLICY);
    expect(await evaluator.evaluate({ kind: 'anonymous', siteId: null }, read)).toEqual(DENIED_POLICY);
    const appUserElsewhere: Principal = {
      kind: 'appUser',
      appUserId: 'u2',
      siteId: otherSite,
      roleIds: ['writer'],
    };
    expect(await evaluator.evaluate(appUserElsewhere, read)).toEqual(DENIED_POLICY);
    // Custom roles assigned to the account still apply; only the site's audience bindings are missing.
    expect((await evaluator.evaluate(appUserElsewhere, { action: 'create', modelId: MODEL })).allowed).toBe(
      true,
    );
  });
});
