import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { codeChallengeOf } from '../../src/appAuth/oauth/state.js';
import type { AppAuthConfig } from '../../src/config/index.js';
import type { Database } from '../../src/db/index.js';
import { createAppUserEmailJobHandlers } from '../../src/email/appUserJobs.js';
import { createJobHandlers } from '../../src/jobs/handlers/index.js';
import { createWorker } from '../../src/jobs/worker.js';
import { APP_ROLE_IDS } from '../../src/permissions/appRoles.js';
import * as appRolesRepository from '../../src/repositories/appRoles.js';
import * as permissionsVersionRepository from '../../src/repositories/permissionsVersion.js';
import { nextTestIp } from './adminIdentity.js';
import type { GrantSpec } from './content.js';
import type { MemoryEmailTransport } from './memoryEmailTransport.js';
import { silentLogger } from './silentLogger.js';
import { waitFor } from './waitFor.js';

export const APP_PASSWORD = 'app-user password 1';

export type AppSessionBody = {
  user: { id: string; email: string; name: string; confirmed: boolean };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** What an app does before an OAuth sign-in: a verifier it keeps and the S256 challenge it sends. */
export const newAppPkce = () => {
  const codeVerifier = randomBytes(32).toString('base64url');
  return { codeVerifier, codeChallenge: codeChallengeOf(codeVerifier) };
};

/** Registers an app user through the public API (each from its own IP, under the per-IP limit). */
export const registerAppUser = async (
  app: FastifyInstance,
  { email = `user-${randomUUID()}@example.com`, password = APP_PASSWORD, name = 'App User' } = {},
): Promise<LightMyRequestResponse> =>
  app.inject({
    method: 'POST',
    url: '/api/app-auth/register',
    remoteAddress: nextTestIp(),
    payload: { email, password, name },
  });

/** Registers and returns the signed-in session (confirmation not required). */
export const signUp = async (app: FastifyInstance, options: { email?: string; password?: string } = {}) => {
  const response = await registerAppUser(app, options);
  if (response.statusCode !== 201) {
    throw new Error(`Register failed: ${response.statusCode} ${response.body}`);
  }
  const { session } = response.json<{ session: AppSessionBody | null }>();
  if (!session) {
    throw new Error('Register did not sign in (confirmation required?)');
  }
  return session;
};

export const loginAppUser = (app: FastifyInstance, email: string, password = APP_PASSWORD) =>
  app.inject({
    method: 'POST',
    url: '/api/app-auth/login',
    remoteAddress: nextTestIp(),
    payload: { email, password },
  });

/** Replaces a role's grants directly in the database (built-in or custom) and bumps the permissions version. */
export const setAppRoleGrants = async (db: Database, roleId: string, grants: readonly GrantSpec[]) =>
  db.transaction().execute(async (trx) => {
    await appRolesRepository.deletePermissionsForRole(roleId, trx);
    await appRolesRepository.insertPermissions(
      grants.map((grant) => ({
        role_id: roleId,
        action: grant.action,
        model_id: grant.modelId,
        condition: grant.condition ?? null,
        field_ids: grant.fieldIds ?? null,
      })),
      trx,
    );
    await permissionsVersionRepository.bumpPermissionsVersion(trx);
  });

export const setPublicGrants = (db: Database, grants: readonly GrantSpec[]) =>
  setAppRoleGrants(db, APP_ROLE_IDS.public, grants);
export const setAuthenticatedGrants = (db: Database, grants: readonly GrantSpec[]) =>
  setAppRoleGrants(db, APP_ROLE_IDS.authenticated, grants);

/** A custom app role with these grants; returns its ID. */
export const createAppRole = async (db: Database, grants: readonly GrantSpec[]): Promise<string> => {
  const key = `test-${randomUUID()}`;
  const role = await appRolesRepository.insert({ key, name: `Test app role ${key}`, description: '' }, db);
  await setAppRoleGrants(db, role.id, grants);
  return role.id;
};

/** Runs the worker until every app-user email job has finished, delivering through `transport`. */
export const runAppEmailJobs = async (
  app: FastifyInstance,
  db: Database,
  transport: MemoryEmailTransport,
  appAuth: AppAuthConfig,
) => {
  const worker = createWorker({
    db,
    handlers: createJobHandlers(
      createAppUserEmailJobHandlers({ database: db, urls: app.urls, transport, appAuth }),
    ),
    workerId: `test-${randomUUID()}`,
    concurrency: 4,
    pollIntervalMs: 50,
    leaseMs: 10_000,
    log: silentLogger,
  });
  await worker.tick();
  await waitFor(async () => worker.runningJobIds.size === 0);
  const unfinished = await db
    .selectFrom('jobs')
    .select(['type', 'status', 'last_error'])
    .where('type', 'like', 'email.appUser%')
    .where('status', '!=', 'succeeded')
    .execute();
  if (unfinished.length > 0) {
    throw new Error(`App-user email jobs did not succeed: ${JSON.stringify(unfinished)}`);
  }
};
