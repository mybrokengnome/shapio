import { INVITATION_TTL_MS } from '../constants/auth.js';
import { db } from '../db/index.js';
import { ADMIN_LINK_PATHS, tokenLink, type EmailDeliveryDependencies } from '../email/delivery.js';
import { invitationEmail } from '../email/templates.js';
import { AppError } from '../helpers/appError.js';
import { hashPassword } from '../helpers/password.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import { generateToken, hashToken } from '../helpers/tokens.js';
import { enqueueJob } from '../jobs/queue.js';
import { narrowToSite } from '../permissions/sites.js';
import * as adminInvitationsRepository from '../repositories/adminInvitations.js';
import type { AdminInvitationRow } from '../repositories/adminInvitations.js';
import * as adminRolesRepository from '../repositories/adminRoles.js';
import * as adminUsersRepository from '../repositories/adminUsers.js';
import type { ActorContext, ClientInfo } from './actorContext.js';
import { createSession } from './adminSessions.js';
import {
  assertAssignableRoles,
  getOwnerRoleId,
  insertAdminUser,
  isOwnerActor,
  normalizeEmail,
} from './adminUsers.js';
import { recordAudit } from './audit.js';
import type { AuthenticatedSession } from './auth.js';

export const INVITATION_EMAIL_JOB = 'email.adminInvitation';

export type InvitationView = {
  id: string;
  email: string;
  roleIds: string[];
  invitedBy: string | null;
  expiresAt: Date;
  createdAt: Date;
};

const toInvitationView = (
  row: Pick<
    AdminInvitationRow,
    'id' | 'email' | 'role_assignments' | 'invited_by' | 'expires_at' | 'created_at'
  >,
): InvitationView => ({
  id: row.id,
  email: row.email,
  roleIds: invitedRoleIds(row.role_assignments),
  invitedBy: row.invited_by,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
});

/**
 * Role assignments stored on an invitation (`[{ roleId, siteId }]`, site null = every site). Invitations
 * assign on every site until site-scoped assignments reach the users API (sites plan §H, G3).
 */
const invitedRoleIds = (assignments: unknown): string[] =>
  Array.isArray(assignments)
    ? [
        ...new Set(
          assignments.flatMap((assignment: unknown) =>
            typeof assignment === 'object' && assignment !== null && 'roleId' in assignment
              ? [String(assignment.roleId)]
              : [],
          ),
        ),
      ]
    : [];

const invalidToken = () =>
  new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This invitation link is invalid or has expired');

const isPending = (row: AdminInvitationRow, now: Date) =>
  row.accepted_at === null && row.revoked_at === null && row.expires_at.getTime() > now.getTime();

/**
 * Invites someone by email with the given roles. Re-inviting an address replaces its pending invitation.
 * The email (and its single-use token) is produced by a job, so the plain token never sits in the database.
 */
export const createInvitation = async (
  context: ActorContext,
  input: { email: string; roleIds: string[] },
): Promise<InvitationView> =>
  db.transaction().execute(async (trx) => {
    const email = normalizeEmail(input.email);
    const roleIds = await assertAssignableRoles(input.roleIds, trx);
    const ownerRoleId = await getOwnerRoleId(trx);
    if (roleIds.includes(ownerRoleId) && !isOwnerActor(context.actor, ownerRoleId)) {
      throw new AppError(403, 'OWNER_REQUIRED', 'Only owners can invite owners');
    }
    if (await adminUsersRepository.existsByEmail(email, trx)) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An admin with this email already exists');
    }
    const now = new Date();
    await adminInvitationsRepository.revokePendingForEmail(email, now, trx);
    const invitation = await adminInvitationsRepository.insert(
      {
        email,
        role_assignments: JSON.stringify(roleIds.map((roleId) => ({ roleId, siteId: null }))),
        invited_by: context.actor.kind === 'admin' ? context.actor.adminUserId : null,
        expires_at: new Date(now.getTime() + INVITATION_TTL_MS),
      },
      trx,
    );
    await enqueueJob({ type: INVITATION_EMAIL_JOB, payload: { invitationId: invitation.id } }, trx);
    await recordAudit(trx, {
      ...context,
      action: 'invitation.create',
      target: { type: 'admin_invitation', id: invitation.id },
      metadata: { email, roleIds },
    });
    return toInvitationView(invitation);
  });

export const listInvitations = async (): Promise<InvitationView[]> =>
  (await adminInvitationsRepository.listPending(new Date())).map(toInvitationView);

export const revokeInvitation = async (context: ActorContext, id: string): Promise<void> => {
  await db.transaction().execute(async (trx) => {
    if (!(await adminInvitationsRepository.revoke(id, new Date(), trx))) {
      throw new AppError(404, 'NOT_FOUND', 'Pending invitation not found');
    }
    await recordAudit(trx, {
      ...context,
      action: 'invitation.revoke',
      target: { type: 'admin_invitation', id },
    });
  });
};

export type InvitationLink = { acceptUrl: string; expiresAt: Date };

const acceptUrlFor = (urls: UrlBuilder, token: string) =>
  tokenLink(urls, ADMIN_LINK_PATHS.acceptInvitation, token);

/**
 * Issues a fresh link for a pending invitation, for an admin to send by hand (needed when the server has no
 * email transport). The plain token is returned once and never stored; any earlier link, emailed or copied,
 * stops working.
 */
export const issueInvitationLink = async (
  context: ActorContext,
  id: string,
  urls: UrlBuilder,
): Promise<InvitationLink> =>
  db.transaction().execute(async (trx) => {
    const now = new Date();
    const invitation = await adminInvitationsRepository.findById(id, trx);
    if (!invitation || !isPending(invitation, now)) {
      throw new AppError(404, 'NOT_FOUND', 'Pending invitation not found');
    }
    const token = generateToken();
    await adminInvitationsRepository.setTokenHash(invitation.id, hashToken(token), now, trx);
    await recordAudit(trx, {
      ...context,
      action: 'invitation.link',
      target: { type: 'admin_invitation', id: invitation.id },
      metadata: { email: invitation.email },
    });
    return { acceptUrl: acceptUrlFor(urls, token), expiresAt: invitation.expires_at };
  });

/** What the accept screen shows before the invitee chooses a password. Does not consume the token. */
export const inspectInvitation = async (token: string): Promise<{ email: string; expiresAt: Date }> => {
  const row = await adminInvitationsRepository.findByTokenHash(hashToken(token));
  if (!row || !isPending(row, new Date())) {
    throw invalidToken();
  }
  return { email: row.email, expiresAt: row.expires_at };
};

type AcceptInvitationInput = {
  token: string;
  name: string;
  password: string;
  client: ClientInfo;
  requestId: string;
};

/** Creates the invited admin and signs them in. The invitation row is locked, so a token works once. */
export const acceptInvitation = async (input: AcceptInvitationInput): Promise<AuthenticatedSession> => {
  const passwordHash = await hashPassword(input.password);
  return db.transaction().execute(async (trx) => {
    const now = new Date();
    const invitation = await adminInvitationsRepository.lockByTokenHash(hashToken(input.token), trx);
    if (!invitation || !isPending(invitation, now)) {
      throw invalidToken();
    }
    // Roles may have been deleted since the invitation was sent; keep the admin roles that still exist.
    const roles = await adminRolesRepository.findByIds(invitedRoleIds(invitation.role_assignments), trx);
    const roleIds = roles.filter((role) => role.kind === 'admin').map((role) => role.id);
    const adminUserId = await insertAdminUser(
      { email: invitation.email, name: input.name, passwordHash, roleIds },
      trx,
    );
    await adminInvitationsRepository.markAccepted(invitation.id, now, trx);
    const session = await createSession(adminUserId, { client: input.client, now }, trx);
    await adminUsersRepository.update(adminUserId, { last_login_at: now }, trx);
    await recordAudit(trx, {
      actor: narrowToSite(
        {
          adminUserId,
          sessionId: session.sessionId,
          assignments: roleIds.map((roleId) => ({ roleId, siteId: null })),
        },
        null,
      ),
      action: 'invitation.accept',
      target: { type: 'admin_invitation', id: invitation.id },
      metadata: { adminUserId, roleIds },
      requestId: input.requestId,
      ...(input.client.ip ? { ip: input.client.ip } : {}),
    });
    return { adminUserId, session };
  });
};

/**
 * Job: issues the invitation's token and emails the link. The first attempt leaves alone an invitation whose
 * link was already copied (an admin has it). A retry issues a fresh token (the previous link stops working),
 * so at-least-once delivery never leaves two live links.
 */
export const deliverInvitation = async (
  invitationId: string,
  attempt: number,
  { database, urls, transport }: EmailDeliveryDependencies,
): Promise<{ sent: boolean }> => {
  const now = new Date();
  const invitation = await adminInvitationsRepository.findById(invitationId, database);
  if (!invitation || !isPending(invitation, now)) {
    return { sent: false };
  }
  const token = generateToken();
  const tokenHash = hashToken(token);
  if (attempt > 1) {
    await adminInvitationsRepository.setTokenHash(invitation.id, tokenHash, now, database);
  } else if (!(await adminInvitationsRepository.setFirstTokenHash(invitation.id, tokenHash, now, database))) {
    return { sent: false };
  }
  const inviter = invitation.invited_by
    ? await adminUsersRepository.findSummaryById(invitation.invited_by, database)
    : undefined;
  await transport.send(
    invitationEmail({
      to: invitation.email,
      inviterName: inviter?.name || inviter?.email,
      instanceUrl: urls.absoluteUrl('/'),
      acceptUrl: acceptUrlFor(urls, token),
      expiresAt: invitation.expires_at,
    }),
  );
  return { sent: true };
};
