import type { Kysely, Transaction } from 'kysely';
import { LOCK_NAMESPACE, SETUP_LOCK_KEY } from '../constants/lockKeys.js';
import { acquireXactLock } from '../db/advisoryLocks.js';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import { hashPassword } from '../helpers/password.js';
import { generateToken, hashToken } from '../helpers/tokens.js';
import { ensureSystemRoles } from '../permissions/seedRoles.js';
import { narrowToSite } from '../permissions/sites.js';
import * as adminRolesRepository from '../repositories/adminRoles.js';
import * as adminUsersRepository from '../repositories/adminUsers.js';
import * as setupTokensRepository from '../repositories/setupTokens.js';
import { SYSTEM_CLI_ACTOR, type ClientInfo } from './actorContext.js';
import { createSession } from './adminSessions.js';
import { getOwnerRoleId, insertAdminUser, normalizeEmail } from './adminUsers.js';
import { recordAudit } from './audit.js';
import type { AuthenticatedSession } from './auth.js';

export const isSetupRequired = async (database: Kysely<DB> = db): Promise<boolean> =>
  (await adminUsersRepository.countAll(database)) === 0;

/**
 * At boot, while no admin exists: supersedes any earlier setup token and issues a new one. Returns the
 * token for the caller to show exactly once (it is stored only as a hash), or undefined when setup is done.
 * Serialised with setup itself by the setup advisory lock.
 */
export const issueSetupToken = async (database: Kysely<DB>): Promise<string | undefined> =>
  database.transaction().execute(async (trx) => {
    await acquireXactLock(trx, LOCK_NAMESPACE.setup, SETUP_LOCK_KEY);
    if ((await adminUsersRepository.countAll(trx)) > 0) {
      return undefined;
    }
    const token = generateToken();
    await setupTokensRepository.supersedeUnused(new Date(), trx);
    await setupTokensRepository.insert(hashToken(token), trx);
    return token;
  });

const consumeToken = async (token: string | undefined, now: Date, trx: Transaction<DB>) =>
  token !== undefined && (await setupTokensRepository.consume(hashToken(token), now, trx));

type CompleteSetupInput = {
  /** SETUP_REQUIRE_TOKEN: when false, any token sent is ignored. */
  requireToken: boolean;
  token: string | undefined;
  email: string;
  name: string;
  password: string;
  client: ClientInfo;
  requestId: string;
};

/**
 * Creates the first owner and signs them in. Holds the setup lock, so of concurrent attempts exactly one
 * succeeds, and refuses as soon as any admin exists. With `requireToken`, the logged one-time token must
 * also match (it works once); without it, the first caller while no admin exists becomes the owner.
 */
export const completeSetup = async (input: CompleteSetupInput): Promise<AuthenticatedSession> => {
  const passwordHash = await hashPassword(input.password);
  return db.transaction().execute(async (trx) => {
    await acquireXactLock(trx, LOCK_NAMESPACE.setup, SETUP_LOCK_KEY);
    if ((await adminUsersRepository.countAll(trx)) > 0) {
      throw new AppError(409, 'SETUP_COMPLETE', 'Setup is already complete; sign in instead');
    }
    const now = new Date();
    if (input.requireToken && !(await consumeToken(input.token, now, trx))) {
      throw new AppError(403, 'INVALID_SETUP_TOKEN', 'The setup token is not valid');
    }
    const ownerRoleId = await getOwnerRoleId(trx);
    const adminUserId = await insertAdminUser(
      { email: input.email, name: input.name, passwordHash, roleIds: [ownerRoleId] },
      trx,
    );
    await setupTokensRepository.supersedeUnused(now, trx);
    const session = await createSession(adminUserId, { client: input.client, now }, trx);
    await adminUsersRepository.update(adminUserId, { last_login_at: now }, trx);
    await recordAudit(trx, {
      actor: narrowToSite(
        { adminUserId, sessionId: session.sessionId, assignments: [{ roleId: ownerRoleId, siteId: null }] },
        null,
      ),
      action: 'setup.complete',
      target: { type: 'admin_user', id: adminUserId },
      requestId: input.requestId,
      ...(input.client.ip ? { ip: input.client.ip } : {}),
    });
    return { adminUserId, session };
  });
};

type CreateAdminDirectInput = { email: string; name: string; password: string; roleKey: string };

/**
 * `shapio admin create`: creates an admin straight in the database (the recovery path when nobody can sign
 * in, and an alternative to the Setup screen). Audited as the `cli` system principal.
 */
export const createAdminDirect = async (
  database: Kysely<DB>,
  input: CreateAdminDirectInput,
): Promise<string> => {
  await ensureSystemRoles(database);
  const passwordHash = await hashPassword(input.password);
  return database.transaction().execute(async (trx) => {
    // Same lock as setup: a concurrent first-run setup and this command cannot both create the first owner.
    await acquireXactLock(trx, LOCK_NAMESPACE.setup, SETUP_LOCK_KEY);
    const [role] = await adminRolesRepository.findByKeys([input.roleKey], trx);
    if (!role || role.kind !== 'admin') {
      throw new AppError(400, 'INVALID_ROLES', `No admin role with key "${input.roleKey}"`);
    }
    const adminUserId = await insertAdminUser(
      { email: input.email, name: input.name, passwordHash, roleIds: [role.id] },
      trx,
    );
    await setupTokensRepository.supersedeUnused(new Date(), trx);
    await recordAudit(trx, {
      ...SYSTEM_CLI_ACTOR,
      action: 'admin_user.create',
      target: { type: 'admin_user', id: adminUserId },
      metadata: { email: normalizeEmail(input.email), roleKey: role.key },
    });
    return adminUserId;
  });
};
