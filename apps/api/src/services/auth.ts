import { db } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import { hashPassword, verifyPassword } from '../helpers/password.js';
import { hashToken } from '../helpers/tokens.js';
import {
  CONTENT_ACTIONS,
  GLOBAL_ACTIONS,
  type AdminPrincipal,
  type ContentAction,
  type GlobalAction,
  type PermissionEvaluator,
  type Principal,
} from '../permissions/types.js';
import * as adminRolesRepository from '../repositories/adminRoles.js';
import * as adminSessionsRepository from '../repositories/adminSessions.js';
import * as adminUsersRepository from '../repositories/adminUsers.js';
import * as passwordResetsRepository from '../repositories/passwordResets.js';
import type { ActorContext, ClientInfo } from './actorContext.js';
import { createSession, type IssuedSession } from './adminSessions.js';
import { normalizeEmail, toAdminUserView, type AdminUserView } from './adminUsers.js';
import { recordAudit } from './audit.js';

export type AuthenticatedSession = { adminUserId: string; session: IssuedSession };

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

export const requireAdminPrincipal = (principal: Principal): AdminPrincipal => {
  if (principal.kind !== 'admin') {
    throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue');
  }
  return principal;
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
      actor: { kind: 'anonymous' },
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
      actor: { kind: 'admin', adminUserId: usable.id, sessionId: session.sessionId, roleIds: [] },
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
  roles: { id: string; key: string; name: string }[];
  /** Instance-level actions this admin may perform (for showing or hiding admin screens). */
  globalPermissions: GlobalAction[];
  /** Content actions per model ID, for showing places, Structure, New and Publish (models with none are omitted). */
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

export const getMe = async (
  principal: AdminPrincipal,
  permissions: PermissionEvaluator,
  modelIds: readonly string[],
): Promise<MeView> => {
  const user = await adminUsersRepository.findSummaryById(principal.adminUserId);
  if (!user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue');
  }
  const roles = await adminRolesRepository.findByIds(user.role_ids);
  const allowed = await Promise.all(
    GLOBAL_ACTIONS.map((action) => permissions.canPerform(principal, action)),
  );
  return {
    user: toAdminUserView(user),
    roles: roles.map(({ id, key, name }) => ({ id, key, name })),
    globalPermissions: GLOBAL_ACTIONS.filter((_action, index) => allowed[index]),
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
