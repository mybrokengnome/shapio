import type { Kysely, Transaction } from 'kysely';
import {
  LAST_SEEN_WRITE_INTERVAL_MS,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
} from '../constants/auth.js';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import { generateToken, hashToken } from '../helpers/tokens.js';
import type { AdminPrincipal } from '../permissions/types.js';
import * as adminSessionsRepository from '../repositories/adminSessions.js';
import type { ActorContext, ClientInfo } from './actorContext.js';
import { recordAudit } from './audit.js';

type Executor = Kysely<DB> | Transaction<DB>;

/** How long the previous session ID keeps working after a rotation, for requests already in flight. */
const ROTATION_GRACE_MS = 30 * 1000;
const USER_AGENT_MAX_LENGTH = 512;

export type IssuedSession = {
  sessionId: string;
  /** The cookie value. Only its hash is stored. */
  token: string;
  csrfSecret: string;
  expiresAt: Date;
};

type NewSessionOptions = { client: ClientInfo; now?: Date; csrfSecret?: string; expiresAt?: Date };

/** Creates a session for an authenticated user. Call inside the transaction that authenticated them. */
export const createSession = async (
  adminUserId: string,
  { client, now = new Date(), csrfSecret = generateToken(), expiresAt }: NewSessionOptions,
  trx: Executor = db,
): Promise<IssuedSession> => {
  const token = generateToken();
  const absoluteExpiry = expiresAt ?? new Date(now.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS);
  const row = await adminSessionsRepository.insert(
    {
      admin_user_id: adminUserId,
      token_hash: hashToken(token),
      csrf_secret: csrfSecret,
      ip: client.ip ?? null,
      user_agent: client.userAgent?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
      last_seen_at: now,
      expires_at: absoluteExpiry,
      created_at: now,
      updated_at: now,
    },
    trx,
  );
  return { sessionId: row.id, token, csrfSecret, expiresAt: absoluteExpiry };
};

export type ResolvedSession = {
  principal: AdminPrincipal;
  csrfSecret: string;
  /** Set when the session was rotated on this request: the caller must send the new cookie. */
  rotated?: IssuedSession;
};

const isExpired = (row: { expires_at: Date; last_seen_at: Date }, now: Date) =>
  row.expires_at.getTime() <= now.getTime() ||
  row.last_seen_at.getTime() + SESSION_IDLE_TIMEOUT_MS <= now.getTime();

/**
 * Rotates a session after a privilege change: a new session ID (and cookie) with the same absolute
 * expiry and CSRF secret. The old ID lives on for a short grace period so parallel requests in flight do
 * not fail. Only one request wins the rotation; the others keep using the old ID during the grace period.
 */
const rotate = async (
  row: { id: string; admin_user_id: string; csrf_secret: string; expires_at: Date },
  client: ClientInfo,
  now: Date,
): Promise<IssuedSession | undefined> =>
  db.transaction().execute(async (trx) => {
    const graceUntil = new Date(Math.min(row.expires_at.getTime(), now.getTime() + ROTATION_GRACE_MS));
    if (!(await adminSessionsRepository.claimRotation(row.id, graceUntil, now, trx))) {
      return undefined;
    }
    return createSession(
      row.admin_user_id,
      { client, now, csrfSecret: row.csrf_secret, expiresAt: row.expires_at },
      trx,
    );
  });

/**
 * The principal for a session cookie, or undefined when the session is unknown, revoked, idle too long,
 * past its absolute expiry, or its user is disabled. Records activity at most once a minute.
 */
export const resolveSession = async (
  token: string,
  client: ClientInfo,
  now = new Date(),
): Promise<ResolvedSession | undefined> => {
  const row = await adminSessionsRepository.findActiveByTokenHash(hashToken(token));
  if (!row || row.user_status !== 'active' || isExpired(row, now)) {
    return undefined;
  }
  const principalFor = (sessionId: string): AdminPrincipal => ({
    kind: 'admin',
    adminUserId: row.admin_user_id,
    sessionId,
    roleIds: row.role_ids,
  });
  if (row.rotation_required) {
    const rotated = await rotate(row, client, now);
    if (rotated) {
      return { principal: principalFor(rotated.sessionId), csrfSecret: rotated.csrfSecret, rotated };
    }
  } else {
    await adminSessionsRepository.touch(row.id, now, new Date(now.getTime() - LAST_SEEN_WRITE_INTERVAL_MS));
  }
  return { principal: principalFor(row.id), csrfSecret: row.csrf_secret };
};

export const listSessions = (adminUserId: string, now = new Date()) =>
  adminSessionsRepository.listActiveForUser(adminUserId, now);

/** Revokes one of the acting admin's own sessions. */
export const revokeOwnSession = async (context: ActorContext, sessionId: string) => {
  const { actor } = context;
  if (actor.kind !== 'admin') {
    throw new AppError(403, 'FORBIDDEN', 'Only signed-in admins have sessions');
  }
  await db.transaction().execute(async (trx) => {
    const session = await adminSessionsRepository.findById(sessionId, trx);
    if (!session || session.admin_user_id !== actor.adminUserId || session.revoked_at !== null) {
      throw new AppError(404, 'NOT_FOUND', 'Session not found');
    }
    await adminSessionsRepository.revoke(sessionId, new Date(), trx);
    await recordAudit(trx, {
      ...context,
      action: 'session.revoke',
      target: { type: 'admin_session', id: sessionId },
      metadata: { current: sessionId === actor.sessionId },
    });
  });
};
