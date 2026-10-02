import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config/index.js';
import { AFTER_HOOK_JOB } from '../constants/extensions.js';
import { createContentHooks, type ContentHooks } from '../content/hooks.js';
import type { Database } from '../db/index.js';
import type { JobHandler, OutboxSubscriber } from '../jobs/types.js';
import { createPermissionCache } from '../permissions/cache.js';
import { createPermissionEvaluator } from '../permissions/evaluator.js';
import type { PermissionEvaluator } from '../permissions/types.js';
import { createSchemaFieldVisibility } from '../schema/fieldVisibility.js';
import { createSchemaRegistry } from '../schema/registry.js';
import { createAfterHookJobHandler, createAfterHookSubscriber, registerProjectHooks } from './hooks.js';
import { createExtensionJobHandlers } from './jobs.js';
import { loadProjectConfig, type LoadedProjectConfig } from './loader.js';
import type { ExtensionRoute, ExtensionServices } from './public.js';
import { createExtensionServices, toHostConfig } from './services.js';

/**
 * One process's extensions (ADR 0009): the loaded project config with its services constructed once, its
 * hooks registered on a content hook engine, and its jobs and outbox subscriber for the worker. The API and
 * the worker (inline or dedicated) build it from the same config, so a scheduled or release publish runs
 * the same hooks as a REST or GraphQL one.
 */
export type ExtensionRuntime = {
  loaded: LoadedProjectConfig;
  services: ExtensionServices;
  /** The content hook engine with the project's hooks registered (empty without a config). */
  hooks: ContentHooks;
  routes: readonly ExtensionRoute[];
  jobHandlers: ReadonlyArray<[string, JobHandler]>;
  outboxSubscribers: readonly OutboxSubscriber[];
  permissions: PermissionEvaluator;
  /** Aborts hook `signal`s; call on shutdown. Idempotent. */
  close: () => void;
};

type RuntimeOptions = {
  loaded: LoadedProjectConfig;
  db: Database;
  config: AppConfig;
  logger: FastifyBaseLogger;
  /** Shares the app's evaluator; otherwise one is created on the same database. */
  permissions?: PermissionEvaluator;
};

export const createExtensionRuntime = async ({
  loaded,
  db,
  config,
  logger,
  permissions,
}: RuntimeOptions): Promise<ExtensionRuntime> => {
  const log = logger.child({ component: 'extensions' });
  if (loaded.file) {
    log.info(
      {
        file: loaded.file,
        hooks: Object.keys(loaded.config.hooks ?? {}),
        routes: (loaded.config.routes ?? []).map((route) => route.prefix),
        services: Object.keys(loaded.config.services ?? {}),
        jobs: Object.keys(loaded.config.jobs ?? {}),
      },
      'loaded shapio.config',
    );
  }
  const registry = createSchemaRegistry({ db, log });
  const evaluator =
    permissions ??
    createPermissionEvaluator({
      grants: createPermissionCache(db),
      fields: createSchemaFieldVisibility(registry),
    });
  const project = loaded.config;
  const services = await createExtensionServices(
    { db, registry, permissions: evaluator, logger: log, jobNames: new Set(Object.keys(project.jobs ?? {})) },
    project.services ?? {},
    toHostConfig(config, loaded.projectDir),
  );
  const shutdown = new AbortController();
  const hookEnvironment = {
    db,
    hooks: project.hooks ?? {},
    services,
    logger: log,
    signal: shutdown.signal,
  };
  const hooks = createContentHooks();
  registerProjectHooks(hooks, hookEnvironment);
  return {
    loaded,
    services,
    hooks,
    routes: project.routes ?? [],
    jobHandlers: [
      [AFTER_HOOK_JOB, createAfterHookJobHandler(hookEnvironment)],
      ...createExtensionJobHandlers(project.jobs ?? {}, services),
    ],
    outboxSubscribers: [createAfterHookSubscriber(hookEnvironment.hooks)],
    permissions: evaluator,
    close: () => shutdown.abort(),
  };
};

/** Loads the project config (SHAPIO_CONFIG_PATH, else `searchDir`) and builds the runtime. */
export const loadExtensionRuntime = async (
  options: Omit<RuntimeOptions, 'loaded'> & { searchDir?: string },
): Promise<ExtensionRuntime> => {
  const loaded = await loadProjectConfig({
    configPath: options.config.extensions.configPath,
    ...(options.searchDir ? { searchDir: options.searchDir } : {}),
  });
  return createExtensionRuntime({ ...options, loaded });
};
