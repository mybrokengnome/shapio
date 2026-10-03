import { db } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import { hashPassword, verifyPassword } from '../helpers/password.js';
import { hashToken } from '../helpers/tokens.js';
import { narrowToSite } from '../permissions/sites.js';
import {
  CONTENT_ACTIONS,
  GLOBAL_ACTIONS,
  NETWORK_ACTIONS,
  SITE_ACTIONS,
  type AdminPrincipal,
  type ContentAction,
  type GlobalAction,
  type NetworkAction,
  type SiteAction,
  type PermissionEvaluator,
  type Principal,
  type TokenPrincipal,
} from '../permissions/types.js';
import * as adminRolesRepository from '../repositories/adminRoles.js';
import * as adminSessionsRepository from '../repositories/adminSessions.js';
import * as adminUsersRepository from '../repositories/adminUsers.js';
import * as passwordResetsRepository from '../repositories/passwordResets.js';
import type { ActorContext, ClientInfo, SiteRef } from './actorContext.js';
import { createSession, type IssuedSession } from './adminSessions.js';
import { normalizeEmail, toAdminUserView, type AdminUserView } from './adminUsers.js';
import { recordAudit } from './audit.js';
import { getSiteSummary, listAccessibleSites, toSiteSummary, type SiteSummaryView } from './sites.js';

export type AuthenticatedSession = { adminUserId: string; session: IssuedSession };

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

export const requireAdminPrincipal = (principal: Principal): AdminPrincipal => {
  if (principal.kind !== 'admin') {
    throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue');
  }
  return principal;
};

/** An admin user or an admin-scope API token (what `requireAdmin` lets through). */
export const requireAdminOrAdminToken = (principal: Principal): AdminPrincipal | TokenPrincipal => {
  if (principal.kind === 'admin' || (principal.kind === 'token' && principal.scope === 'admin')) {
    return principal;
  }
  throw new AppError(403, 'FORBIDDEN', 'This needs an admin account or an admin API token');
};

type LoginInput = {
  email: string;
  password: string;
  client: ClientInfo;
  /** The session cookie the request carried, if any: it is replaced (rotation on login). */
  previousSessionToken: string | undefined;
  requestId: string;
};

/**
 * Checks credentials and starts a session. Unknown emails and disabled accounts take the same time as a
 * wrong password (dummy-hash verification) and get the same error.
 */
export const login = async (input: LoginInput): Promise<AuthenticatedSession> => {
  const email = normalizeEmail(input.email);
  const user = await adminUsersRepository.findByEmailWithHash(email);
  const usable = user?.status === 'active' ? user : undefined;
  const valid = await verifyPassword(input.password, usable?.password_hash);
  const audit = { requestId: input.requestId, ip: input.client.ip };
  if (!valid || !usable) {
    await recordAudit(db, {
      ...audit,
      actor: { kind: 'anonymous', siteId: null },
      action: 'auth.login',
      outcome: 'failure',
      ...(user ? { target: { type: 'admin_user', id: user.id } } : {}),
      metadata: { email },
    });
    throw invalidCredentials();
  }
  return db.transaction().execute(async (trx) => {
    const now = new Date();
    if (input.previousSessionToken) {
      const previous = await adminSessionsRepository.findActiveByTokenHash(
        hashToken(input.previousSessionToken),
        trx,
      );
      if (previous) {
        await adminSessionsRepository.revoke(previous.id, now, trx);
      }
    }
    const session = await createSession(usable.id, { client: input.client, now }, trx);
    await adminUsersRepository.update(usable.id, { last_login_at: now }, trx);
    await recordAudit(trx, {
      ...audit,
      actor: narrowToSite({ adminUserId: usable.id, sessionId: session.sessionId, assignments: [] }, null),
      action: 'auth.login',
      target: { type: 'admin_user', id: usable.id },
    });
    return { adminUserId: usable.id, session };
  });
};

export const logout = async (context: ActorContext): Promise<void> => {
  const principal = requireAdminPrincipal(context.actor);
  await db.transaction().execute(async (trx) => {
    await adminSessionsRepository.revoke(principal.sessionId, new Date(), trx);
    await recordAudit(trx, {
      ...context,
      action: 'auth.logout',
      target: { type: 'admin_session', id: principal.sessionId },
    });
  });
};

export type MeView = {
  user: AdminUserView;
  /** The roles that apply on the request's site (assigned there or on every site). */
  roles: { id: string; key: string; name: string }[];
  /** The request's site. */
  site: SiteSummaryView;
  /** The sites this admin works on (every site for a role assigned on every site). */
  sites: SiteSummaryView[];
  /** Network actions (roles assigned on every site only). */
  networkPermissions: NetworkAction[];
  /** Site actions on the request's site. */
  sitePermissions: SiteAction[];
  /** Network and site actions together (for showing or hiding admin screens). */
  globalPermissions: GlobalAction[];
  /** Content actions per model ID on the request's site, for showing places, Structure, New and Publish. */
  modelPermissions: Record<string, ContentAction[]>;
};

/** The content actions this admin may perform on each model (the evaluator caches grants per request). */
const modelPermissionsOf = async (
  principal: AdminPrincipal,
  permissions: PermissionEvaluator,
  modelIds: readonly string[],
): Promise<Record<string, ContentAction[]>> => {
  const entries = await Promise.all(
    modelIds.map(async (modelId) => {
      const policies = await Promise.all(
        CONTENT_ACTIONS.map((action) => permissions.evaluate(principal, { action, modelId })),
      );
      return [modelId, CONTENT_ACTIONS.filter((_action, index) => policies[index]?.allowed)] as const;
    }),
  );
  return Object.fromEntries(entries.filter(([, actions]) => actions.length > 0));
};

const allowedActions = async <T extends GlobalAction>(
  principal: AdminPrincipal,
  permissions: PermissionEvaluator,
  actions: readonly T[],
): Promise<T[]> => {
  const allowed = await Promise.all(actions.map((action) => permissions.canPerform(principal, action)));
  return actions.filter((_action, index) => allowed[index]);
};

/** The signed-in admin on the request's site: who they are, where they work and what they may do there. */
export const getMe = async (
  principal: AdminPrincipal,
  site: SiteRef,
  permissions: PermissionEvaluator,
  modelIds: readonly string[],
): Promise<MeView> => {
  const user = await adminUsersRepository.findSummaryById(principal.adminUserId);
  if (!user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue');
  }
  const [roles, sites, current] = await Promise.all([
    adminRolesRepository.findByIds(principal.roleIds),
    listAccessibleSites(principal),
    getSiteSummary(site.id),
  ]);
  const networkPermissions = await allowedActions(principal, permissions, NETWORK_ACTIONS);
  const sitePermissions = await allowedActions(principal, permissions, SITE_ACTIONS);
  return {
    user: toAdminUserView(user),
    roles: roles.map(({ id, key, name }) => ({ id, key, name })),
    site: current,
    sites: sites.map(toSiteSummary),
    networkPermissions,
    sitePermissions,
    globalPermissions: GLOBAL_ACTIONS.filter(
      (action) =>
        (networkPermissions as readonly string[]).includes(action) ||
        (sitePermissions as readonly string[]).includes(action),
    ),
    modelPermissions: await modelPermissionsOf(principal, permissions, modelIds),
  };
};

export const updateOwnProfile = async (
  context: ActorContext,
  input: { name: string },
): Promise<AdminUserView> => {
  const principal = requireAdminPrincipal(context.actor);
  return db.transaction().execute(async (trx) => {
    await adminUsersRepository.update(principal.adminUserId, { name: input.name.trim() }, trx);
    await recordAudit(trx, {
      ...context,
      action: 'admin_user.update',
      target: { type: 'admin_user', id: principal.adminUserId },
      metadata: { fields: ['name'], self: true },
    });
    const user = await adminUsersRepository.findSummaryById(principal.adminUserId, trx);
    if (!user) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue');
    }
    return toAdminUserView(user);
  });
};

type ChangePasswordInput = { currentPassword: string; newPassword: string; client: ClientInfo };

/**
 * Changes the signed-in admin's password: every other session is revoked, outstanding reset links die,
 * and the current session is replaced by a new one (returned so the caller can set the cookie).
 */
export const changeOwnPassword = async (
  context: ActorContext,
  input: ChangePasswordInput,
): Promise<IssuedSession> => {
  const principal = requireAdminPrincipal(context.actor);
  const user = await adminUsersRepository.findByIdWithHash(principal.adminUserId);
  if (!user || !(await verifyPassword(input.currentPassword, user.password_hash))) {
    throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'The current password is incorrect');
  }
  const passwordHash = await hashPassword(input.newPassword);
  return db.transaction().execute(async (trx) => {
    const now = new Date();
    await adminUsersRepository.update(
      user.id,
      { password_hash: passwordHash, password_changed_at: now },
      trx,
    );
    await passwordResetsRepository.consumeAllForUser(user.id, now, trx);
    await adminSessionsRepository.revokeAllForUser(user.id, now, {}, trx);
    const session = await createSession(user.id, { client: input.client, now }, trx);
    await recordAudit(trx, {
      ...context,
      action: 'admin_user.password_change',
      target: { type: 'admin_user', id: user.id },
    });
    return session;
  });
};
