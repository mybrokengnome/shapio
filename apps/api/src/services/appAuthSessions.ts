import { createHmac, randomUUID } from 'node:crypto';
import type { Transaction } from 'kysely';
import { signAccessToken, verifyAccessToken } from '../appAuth/jwt.js';
import type { AppAuthRuntime, ResolvedAppUser } from '../appAuth/runtime.js';
import { APP_TOKEN_AUDIENCE, REFRESH_REUSE_GRACE_MS } from '../constants/appAuth.js';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import { generateToken, hashToken } from '../helpers/tokens.js';
import type { AppUserPrincipal } from '../permissions/types.js';
import * as appRefreshTokensRepository from '../repositories/appRefreshTokens.js';
import * as appUsersRepository from '../repositories/appUsers.js';
import type { AppUserRow, AppUserSummary } from '../repositories/appUsers.js';
import * as permissionsVersionRepository from '../repositories/permissionsVersion.js';
import type { ClientInfo } from './actorContext.js';
import { recordAudit } from './audit.js';

/**
 * App-user sessions (ADR 0005): a short-lived JWT access token plus a rotating refresh token. Every refresh
 * marks the presented token used and issues the next one in the same family. A token rotated moments ago may
 * be retried once and gets the same replacement (a lost response); any other reuse means it was copied, so
 * the whole family is revoked and the event is audited.
 */

export type AppUserView = {
  id: string;
  email: string;
  name: string;
  confirmed: boolean;
  hasPassword: boolean;
  providers: string[];
  createdAt: Date;
  lastLoginAt: Date | null;
};

export type AppSession = {
  user: AppUserView;
  accessToken: string;
  tokenType: 'Bearer';
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
};

export const toAppUserView = (user: AppUserSummary): AppUserView => ({
  id: user.id,
  email: user.email,
  name: user.name,
  confirmed: user.confirmed_at !== null,
  hasPassword: user.has_password,
  providers: user.providers,
  createdAt: user.created_at,
  lastLoginAt: user.last_login_at,
});

export type SignInStatus = 'ok' | 'blocked' | 'unconfirmed';

/** Whether an account may hold tokens right now. Deleted accounts are never loaded at all. */
export const signInStatus = (runtime: AppAuthRuntime, user: AppUserRow): SignInStatus => {
  if (user.blocked_at !== null) {
    return 'blocked';
  }
  return runtime.config.requireEmailConfirmation && user.confirmed_at === null ? 'unconfirmed' : 'ok';
};

export const assertCanSignIn = (runtime: AppAuthRuntime, user: AppUserRow): void => {
  const status = signInStatus(runtime, user);
  if (status === 'blocked') {
    throw new AppError(403, 'ACCOUNT_BLOCKED', 'This account is blocked');
  }
  if (status === 'unconfirmed') {
    throw new AppError(403, 'EMAIL_NOT_CONFIRMED', 'Confirm your email address before signing in');
  }
};

const invalidRefreshToken = () =>
  new AppError(401, 'INVALID_REFRESH_TOKEN', 'The refresh token is invalid, expired or revoked');

const loadView = async (appUserId: string, trx: Transaction<DB>): Promise<AppUserView> => {
  const summary = await appUsersRepository.findSummaryById(appUserId, trx);
  if (!summary) {
    throw new AppError(404, 'NOT_FOUND', 'Account not found');
  }
  return toAppUserView(summary);
};

type IssueOptions = {
  client: ClientInfo;
  familyId?: string;
  /** The refresh token being rotated: its replacement is derived from it (see `replacementOf`). */
  rotatedFrom?: string;
  /** A replacement already stored (a retry within the reuse grace): returned again, nothing inserted. */
  existing?: { refreshToken: string; expiresAt: Date };
};

/**
 * The replacement of a refresh token, derived with a dedicated key: rotating and a retry within the grace
 * produce the same token, so the retry can be answered without ever storing a token in plain text.
 */
const replacementOf = (runtime: AppAuthRuntime, refreshToken: string): string =>
  createHmac('sha256', runtime.keys.refreshRotation).update(refreshToken).digest('base64url');

/**
 * Issues an access token and a refresh token (a new family unless one is given), in the caller's
 * transaction. Refuses accounts that may not sign in (blocked, unconfirmed when confirmation is required).
 */
export const issueSession = async (
  runtime: AppAuthRuntime,
  appUserId: string,
  { client, familyId = randomUUID(), rotatedFrom, existing }: IssueOptions,
  trx: Transaction<DB>,
): Promise<AppSession> => {
  const user = await appUsersRepository.lockForShare(appUserId, trx);
  if (!user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'This account no longer exists');
  }
  assertCanSignIn(runtime, user);
  const now = new Date();
  const refreshToken =
    existing?.refreshToken ?? (rotatedFrom ? replacementOf(runtime, rotatedFrom) : generateToken());
  const refreshTokenExpiresAt =
    existing?.expiresAt ?? new Date(now.getTime() + runtime.config.refreshTokenTtlMs);
  if (!existing) {
    await appRefreshTokensRepository.insert(
      {
        app_user_id: appUserId,
        family_id: familyId,
        token_hash: hashToken(refreshToken),
        expires_at: refreshTokenExpiresAt,
        ip: client.ip ?? null,
        user_agent: client.userAgent ?? null,
      },
      trx,
    );
  }
  const issuedAt = Math.floor(now.getTime() / 1000);
  const accessToken = signAccessToken(runtime.keys.accessToken, {
    sub: appUserId,
    aud: APP_TOKEN_AUDIENCE,
    iat: issuedAt,
    exp: issuedAt + runtime.config.accessTokenTtlSeconds,
    roles: await appUsersRepository.findRoleIds(appUserId, trx),
    pv: await permissionsVersionRepository.getPermissionsVersion(trx),
    tv: user.token_version,
    sid: familyId,
  });
  return {
    user: await loadView(appUserId, trx),
    accessToken,
    tokenType: 'Bearer',
    expiresIn: runtime.config.accessTokenTtlSeconds,
    refreshToken,
    refreshTokenExpiresAt,
  };
};

type RefreshOutcome = { kind: 'session'; session: AppSession } | { kind: 'rejected'; error: AppError };

type RefreshTokenRow = NonNullable<Awaited<ReturnType<typeof appRefreshTokensRepository.lockByTokenHash>>>;

/**
 * A retry of a token rotated less than REFRESH_REUSE_GRACE_MS ago, once: the same replacement (still unused
 * and live) comes back with a fresh access token. Undefined when the retry does not qualify.
 */
const retryWithinGrace = async (
  runtime: AppAuthRuntime,
  row: RefreshTokenRow,
  refreshToken: string,
  client: ClientInfo,
  trx: Transaction<DB>,
): Promise<AppSession | undefined> => {
  const now = new Date();
  if (
    row.used_at === null ||
    row.reuse_grace_used_at !== null ||
    now.getTime() - row.used_at.getTime() > REFRESH_REUSE_GRACE_MS
  ) {
    return undefined;
  }
  const replacement = replacementOf(runtime, refreshToken);
  const child = await appRefreshTokensRepository.lockByTokenHash(hashToken(replacement), trx);
  const user = await appUsersRepository.lockForShare(row.app_user_id, trx);
  if (
    !child ||
    child.family_id !== row.family_id ||
    child.used_at !== null ||
    child.revoked_at !== null ||
    child.expires_at.getTime() <= now.getTime() ||
    !user ||
    signInStatus(runtime, user) !== 'ok'
  ) {
    return undefined;
  }
  await appRefreshTokensRepository.markGraceUsed(row.id, now, trx);
  return issueSession(
    runtime,
    user.id,
    { client, familyId: row.family_id, existing: { refreshToken: replacement, expiresAt: child.expires_at } },
    trx,
  );
};

const rotate = async (
  runtime: AppAuthRuntime,
  refreshToken: string,
  client: ClientInfo,
  trx: Transaction<DB>,
): Promise<RefreshOutcome> => {
  const now = new Date();
  const row = await appRefreshTokensRepository.lockByTokenHash(hashToken(refreshToken), trx);
  if (!row || row.revoked_at !== null || row.expires_at.getTime() <= now.getTime()) {
    return { kind: 'rejected', error: invalidRefreshToken() };
  }
  const actor: AppUserPrincipal = { kind: 'appUser', appUserId: row.app_user_id, roleIds: [] };
  if (row.used_at !== null) {
    const retried = await retryWithinGrace(runtime, row, refreshToken, client, trx);
    if (retried) {
      return { kind: 'session', session: retried };
    }
    const revoked = await appRefreshTokensRepository.revokeFamily(row.family_id, now, 'reuse', trx);
    await recordAudit(trx, {
      actor,
      action: 'app_auth.refresh_reuse',
      outcome: 'failure',
      target: { type: 'app_user', id: row.app_user_id },
      metadata: { familyId: row.family_id, revokedTokens: revoked },
      ...(client.ip ? { ip: client.ip } : {}),
    });
    return {
      kind: 'rejected',
      error: new AppError(401, 'REFRESH_TOKEN_REUSED', 'This refresh token was already used; sign in again'),
    };
  }
  const user = await appUsersRepository.lockForShare(row.app_user_id, trx);
  if (!user || signInStatus(runtime, user) !== 'ok') {
    await appRefreshTokensRepository.revokeFamily(row.family_id, now, 'account_unavailable', trx);
    return { kind: 'rejected', error: invalidRefreshToken() };
  }
  await appRefreshTokensRepository.markUsed(row.id, now, trx);
  return {
    kind: 'session',
    session: await issueSession(
      runtime,
      user.id,
      { client, familyId: row.family_id, rotatedFrom: refreshToken },
      trx,
    ),
  };
};

/**
 * Rotates a refresh token. A rejection that revoked something (reuse, unavailable account) commits before
 * the error is thrown, so the revocation and its audit row are never rolled back by the failure.
 */
export const refreshSession = async (
  runtime: AppAuthRuntime,
  refreshToken: string,
  client: ClientInfo,
): Promise<AppSession> => {
  const outcome = await db.transaction().execute((trx) => rotate(runtime, refreshToken, client, trx));
  if (outcome.kind === 'rejected') {
    throw outcome.error;
  }
  return outcome.session;
};

/**
 * Ends every sign-in of the account in the caller's transaction (password change or reset, block, deletion,
 * an OAuth link that drops an unproven password): revokes all refresh tokens and moves the token version, so
 * access tokens already handed out stop working on their next request.
 */
export const endAllSignIns = async (
  appUserId: string,
  now: Date,
  reason: string,
  trx: Transaction<DB>,
): Promise<void> => {
  await appRefreshTokensRepository.revokeAllForUser(appUserId, now, reason, trx);
  await appUsersRepository.bumpTokenVersion(appUserId, trx);
};

/**
 * Signs one sign-in out: revokes the refresh token's whole family. Access tokens carry no sign-in of their
 * own that could be checked cheaply, so the account's token version moves too: every access token of the
 * account is rejected, and its other sign-ins get new ones on their next refresh. Unknown tokens and
 * families already revoked change nothing (a stale token cannot be used to sign everyone out repeatedly).
 */
export const revokeSession = async (refreshToken: string): Promise<void> => {
  await db.transaction().execute(async (trx) => {
    const row = await appRefreshTokensRepository.findByTokenHash(hashToken(refreshToken), trx);
    if (!row) {
      return;
    }
    const revoked = await appRefreshTokensRepository.revokeFamily(row.family_id, new Date(), 'logout', trx);
    if (revoked > 0) {
      await appUsersRepository.bumpTokenVersion(row.app_user_id, trx);
    }
  });
};

const revalidate = async (runtime: AppAuthRuntime, appUserId: string): Promise<ResolvedAppUser> => {
  const user = await appUsersRepository.findByIdWithHash(appUserId);
  if (!user || signInStatus(runtime, user) !== 'ok') {
    return null;
  }
  return { roleIds: await appUsersRepository.findRoleIds(appUserId) };
};

/**
 * The principal behind an access token, or undefined when the token is invalid or its account may no longer
 * act. One read per request fetches the permissions version and the account's token version. A token whose
 * token version moved (logout, block, password change or reset) or whose account is deleted is rejected.
 * Otherwise claims are trusted while the permissions version they carry is current; every block, deletion
 * and role change bumps that version, so such a token is re-checked against the database on its next
 * request (once per account and version, then cached).
 */
export const resolveAccessToken = async (
  runtime: AppAuthRuntime,
  token: string,
): Promise<AppUserPrincipal | undefined> => {
  const claims = verifyAccessToken(runtime.keys.accessToken, token);
  if (!claims) {
    return undefined;
  }
  const { permissionsVersion: version, tokenVersion } = await appUsersRepository.findTokenState(claims.sub);
  if (tokenVersion !== claims.tv) {
    return undefined;
  }
  if (claims.pv === version) {
    return { kind: 'appUser', appUserId: claims.sub, roleIds: claims.roles };
  }
  const key = `${claims.sub}:${version}`;
  let resolved = runtime.principals.get(key);
  if (resolved === undefined) {
    resolved = await revalidate(runtime, claims.sub);
    runtime.principals.set(key, resolved);
  }
  return resolved ? { kind: 'appUser', appUserId: claims.sub, roleIds: resolved.roleIds } : undefined;
};
