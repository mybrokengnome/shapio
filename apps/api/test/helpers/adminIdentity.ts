import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { SESSION_COOKIE_NAME } from '../../src/constants/auth.js';
import type { Database } from '../../src/db/index.js';
import { createAdminEmailJobHandlers } from '../../src/email/jobs.js';
import { hashPassword } from '../../src/helpers/password.js';
import { createJobHandlers } from '../../src/jobs/handlers/index.js';
import { createWorker } from '../../src/jobs/worker.js';
import * as adminRolesRepository from '../../src/repositories/adminRoles.js';
import { insertAdminUser } from '../../src/services/adminUsers.js';
import type { MemoryEmailTransport } from './memoryEmailTransport.js';
import { silentLogger } from './silentLogger.js';
import { waitFor } from './waitFor.js';

export const TEST_PASSWORD = 'correct horse battery staple';

export type TestAdmin = { id: string; email: string; password: string };

/** Creates an admin with the given built-in or custom role keys, straight in the database. */
export const createAdmin = async (
  db: Database,
  { roleKeys = ['owner'], email = `admin-${randomUUID()}@example.com`, password = TEST_PASSWORD } = {},
): Promise<TestAdmin> => {
  const passwordHash = await hashPassword(password);
  const id = await db.transaction().execute(async (trx) => {
    const roles = await adminRolesRepository.findByKeys(roleKeys, trx);
    return insertAdminUser({ email, name: 'Test Admin', passwordHash, roleIds: roles.map((r) => r.id) }, trx);
  });
  return { id, email, password };
};

export type TestSession = {
  cookie: string;
  csrfToken: string;
  /** Headers for a cookie-authenticated mutation. */
  headers: Record<string, string>;
};

export const sessionCookieOf = (response: LightMyRequestResponse): string | undefined =>
  response.cookies.find((cookie) => cookie.name === SESSION_COOKIE_NAME)?.value;

export const toSession = (response: LightMyRequestResponse, previousCookie?: string): TestSession => {
  const cookie = sessionCookieOf(response) ?? previousCookie;
  const { csrfToken } = response.json<{ csrfToken: string }>();
  if (!cookie) {
    throw new Error(`No session cookie in response ${response.statusCode}: ${response.body}`);
  }
  return {
    cookie,
    csrfToken,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${cookie}`, 'x-csrf-token': csrfToken },
  };
};

/** A different client IP per call, so tests that sign in often stay under the per-IP login limit. */
let ipCounter = 0;
export const nextTestIp = () => {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
};

export const login = async (app: FastifyInstance, admin: Pick<TestAdmin, 'email' | 'password'>) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    remoteAddress: nextTestIp(),
    payload: { email: admin.email, password: admin.password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`Login failed: ${response.statusCode} ${response.body}`);
  }
  return toSession(response);
};

export const cookieHeader = (cookie: string) => ({ cookie: `${SESSION_COOKIE_NAME}=${cookie}` });

/** Runs the worker until every email job has finished, delivering through `transport`. */
export const runEmailJobs = async (app: FastifyInstance, db: Database, transport: MemoryEmailTransport) => {
  const worker = createWorker({
    db,
    handlers: createJobHandlers(createAdminEmailJobHandlers({ database: db, urls: app.urls, transport })),
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
    .where('type', 'like', 'email.%')
    .where('status', '!=', 'succeeded')
    .execute();
  if (unfinished.length > 0) {
    throw new Error(`Email jobs did not succeed: ${JSON.stringify(unfinished)}`);
  }
};
