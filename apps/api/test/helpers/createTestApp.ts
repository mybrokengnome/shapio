import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { OAuthEndpoints, OAuthProviderId } from '../../src/appAuth/oauth/types.js';
import { loadConfig, type AppConfig } from '../../src/config/index.js';
import type { Database } from '../../src/db/index.js';
import type { ExtensionRuntime } from '../../src/extensions/runtime.js';
import type { FieldVisibilityLookup } from '../../src/permissions/policy.js';
import type { PermissionEvaluator } from '../../src/permissions/types.js';
import type { SchemaContentPorts } from '../../src/schema/planner/contentPorts.js';
import { principalFactory } from './principalFactory.js';
import type { TestDatabase } from './testDatabase.js';

type CreateTestAppOptions = {
  env?: Record<string, string>;
  permissions?: PermissionEvaluator;
  fieldVisibility?: FieldVisibilityLookup;
  /** LISTEN for schema changes (default true). */
  schemaListen?: boolean;
  /** Content ports for the schema planner (default: no content). */
  schemaContent?: SchemaContentPorts;
  /** Capture logs (e.g. to assert secrets never reach them). */
  logger?: FastifyBaseLogger;
  /** Admin build to serve; `null` (the default) serves none. */
  adminDistPath?: string | null;
  /** Registers extra routes or plugins before the app is readied (e.g. routes that throw on purpose). */
  register?: (app: FastifyInstance) => Promise<void> | void;
  /** Project directory for `shapio.config.js` and `extensions/` (default: the working directory). */
  projectDir?: string;
  /** OAuth provider endpoints (a local fake). */
  oauthEndpoints?: Partial<Record<OAuthProviderId, OAuthEndpoints>>;
  /** Project extensions built by the test (to share them with a worker). */
  extensions?: ExtensionRuntime;
};

export type TestApp = {
  app: FastifyInstance;
  db: Database;
  config: AppConfig;
  principalFactory: typeof principalFactory;
};

export const testConfig = (database: TestDatabase, env: Record<string, string> = {}): AppConfig =>
  loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: database.url,
    LOG_LEVEL: 'silent',
    MIGRATE_ON_START: 'false',
    ...env,
  });

/** An in-process app on the test file's database, injected with `app.inject()`. No listener, no worker. */
export const createTestApp = async (
  database: TestDatabase,
  {
    env,
    permissions,
    fieldVisibility,
    schemaListen,
    schemaContent,
    logger,
    register,
    adminDistPath = null,
    projectDir,
    oauthEndpoints,
    extensions,
  }: CreateTestAppOptions = {},
): Promise<TestApp> => {
  const config = testConfig(database, env);
  const app = await buildApp(config, {
    db: database.db,
    adminDistPath,
    ...(permissions ? { permissions } : {}),
    ...(fieldVisibility ? { fieldVisibility } : {}),
    ...(schemaListen !== undefined ? { schemaListen } : {}),
    ...(schemaContent ? { schemaContent } : {}),
    ...(logger ? { logger } : {}),
    ...(projectDir ? { projectDir } : {}),
    ...(oauthEndpoints ? { oauthEndpoints } : {}),
    ...(extensions ? { extensions } : {}),
  });
  await register?.(app);
  await app.ready();
  return { app, db: database.db, config, principalFactory };
};
