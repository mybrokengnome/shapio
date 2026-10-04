import { randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { API_TOKEN_DISPLAY_LENGTH, API_TOKEN_PREFIX } from '../../src/constants/auth.js';
import type { Database } from '../../src/db/index.js';
import { generateToken, hashToken } from '../../src/helpers/tokens.js';
import { createJobHandlers } from '../../src/jobs/handlers/index.js';
import { createWorker } from '../../src/jobs/worker.js';
import * as adminRolesRepository from '../../src/repositories/adminRoles.js';
import * as apiTokensRepository from '../../src/repositories/apiTokens.js';
import { createSchemaJobHandlers } from '../../src/schema/planner/changeJob.js';
import { NO_CONTENT_PORTS, type SchemaContentPorts } from '../../src/schema/planner/contentPorts.js';
import { silentLogger } from './silentLogger.js';
import { waitFor } from './waitFor.js';

/**
 * An API token bound to a built-in role (`admin` by default: schema.create plus schemaManage on every
 * model), inserted directly. Bearer tokens need no CSRF header, which keeps schema tests short.
 */
export const createRoleToken = async (
  db: Database,
  roleKey = 'admin',
  /** A site token (its role applies on that site only); default null: a network token. */
  siteId: string | null = null,
): Promise<string> => {
  const [role] = await adminRolesRepository.findByKeys([roleKey], db);
  if (!role) {
    throw new Error(`Role ${roleKey} is not seeded; build the app first`);
  }
  const token = `${API_TOKEN_PREFIX}${generateToken()}`;
  await apiTokensRepository.insert(
    {
      name: `test ${roleKey} ${randomUUID()}`,
      token_hash: hashToken(token),
      token_prefix: token.slice(0, API_TOKEN_DISPLAY_LENGTH),
      role_id: role.id,
      site_id: siteId,
    },
    db,
  );
  return token;
};

export type SchemaClient = {
  request: (options: InjectOptions) => Promise<LightMyRequestResponse>;
  get: (url: string) => Promise<LightMyRequestResponse>;
  post: (url: string, payload: unknown) => Promise<LightMyRequestResponse>;
  put: (url: string, payload: unknown) => Promise<LightMyRequestResponse>;
  delete: (url: string) => Promise<LightMyRequestResponse>;
};

/** `app.inject` with a bearer token. */
export const schemaClient = (app: FastifyInstance, token: string | undefined): SchemaClient => {
  const request = (options: InjectOptions) =>
    app.inject({
      ...options,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers },
    });
  return {
    request,
    get: (url) => request({ method: 'GET', url }),
    post: (url, payload) => request({ method: 'POST', url, payload: payload as InjectOptions['payload'] }),
    put: (url, payload) => request({ method: 'PUT', url, payload: payload as InjectOptions['payload'] }),
    delete: (url) => request({ method: 'DELETE', url }),
  };
};

/** Runs the schema jobs (prerequisites + activation, follow-ups) until none is left running or pending. */
export const runSchemaJobs = async (db: Database, ports: SchemaContentPorts = NO_CONTENT_PORTS) => {
  const worker = createWorker({
    db,
    handlers: createJobHandlers(createSchemaJobHandlers({ db, ports })),
    workerId: `test-${randomUUID()}`,
    concurrency: 2,
    pollIntervalMs: 20,
    leaseMs: 10_000,
    log: silentLogger,
  });
  await waitFor(async () => {
    await worker.tick();
    await waitFor(async () => worker.runningJobIds.size === 0);
    const open = await db
      .selectFrom('jobs')
      .select('id')
      .where('type', 'like', 'schema.%')
      .where('status', 'in', ['pending', 'running'])
      .execute();
    return open.length === 0;
  });
};

/** A minimal collection definition for tests. */
export const pageDefinition = (overrides: Record<string, unknown> = {}) => ({
  kind: 'collection',
  apiKey: 'page',
  label: 'Page',
  fields: [{ apiKey: 'title', label: 'Title', type: 'string', required: true }],
  ...overrides,
});
