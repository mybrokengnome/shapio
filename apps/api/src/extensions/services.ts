import { isComponentDefinition, type ModelDefinition } from '@shapio/schema';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config/index.js';
import { EXTENSION_JOB_PREFIX, EXTENSION_SYSTEM_COMPONENT } from '../constants/extensions.js';
import { createContentHooks } from '../content/hooks.js';
import { resolveModel } from '../content/model.js';
import type { Database } from '../db/index.js';
import { describeError } from '../helpers/errors.js';
import { enqueueJob } from '../jobs/queue.js';
import type { PermissionEvaluator, Principal } from '../permissions/types.js';
import * as entriesRepository from '../repositories/entries.js';
import type { SchemaRegistry } from '../schema/registry.js';
import type { ContentServiceContext } from '../services/contentAccess.js';
import { getAdminEntry, listAdminEntries } from '../services/contentReads.js';
import { listUsages } from '../services/mediaReferences.js';
import { toHookModel } from './hooks.js';
import type {
  ContentReadEntry,
  ExtensionHostConfig,
  ExtensionServices,
  ServiceFactory,
  ShapioServices,
} from './public.js';

/**
 * The services extensions get (ADR 0009): a small, safe subset of Shapio (content reads, media reference
 * lookups, the project's own jobs, a logger) plus the project's custom services, constructed once.
 */
export type ServiceEnvironment = {
  db: Database;
  registry: SchemaRegistry;
  permissions: PermissionEvaluator;
  logger: FastifyBaseLogger;
  /** Names of the project's jobs, without the `ext.` prefix. */
  jobNames: ReadonlySet<string>;
};

const SYSTEM_PRINCIPAL: Principal = { kind: 'system', component: EXTENSION_SYSTEM_COMPONENT };

const contentContext = async (
  environment: ServiceEnvironment,
  principal: Principal | undefined,
): Promise<ContentServiceContext> => ({
  db: environment.db,
  snapshot: await environment.registry.getSnapshot(),
  permissions: environment.permissions,
  actor: principal ?? SYSTEM_PRINCIPAL,
  // Reads never reach a lifecycle hook point.
  hooks: createContentHooks(),
});

const toReadEntry = (view: { id: string; locale: string; status: string; data: Record<string, unknown> }) =>
  ({ id: view.id, locale: view.locale, status: view.status, data: view.data }) satisfies ContentReadEntry;

const createShapioServices = (environment: ServiceEnvironment): ShapioServices => ({
  content: {
    get: async (modelKey, id, options = {}) =>
      toReadEntry(
        await getAdminEntry(
          await contentContext(environment, options.principal),
          modelKey,
          id,
          options.locale,
        ),
      ),
    list: async (modelKey, query = '', options = {}) => {
      const result = await listAdminEntries(
        await contentContext(environment, options.principal),
        modelKey,
        query,
      );
      return { items: result.items.map(toReadEntry), total: result.pagination.total };
    },
    models: async () =>
      [...(await environment.registry.getSnapshot()).byId.values()]
        .map((active) => active.definition)
        .filter((definition): definition is ModelDefinition => !isComponentDefinition(definition))
        .map(toHookModel),
    count: async (modelKey) => {
      const model = resolveModel(await environment.registry.getSnapshot(), modelKey);
      return entriesRepository.countLive(model.definition.id, environment.db);
    },
  },
  media: {
    usages: async (assetId) => {
      const { items, total } = await listUsages(assetId);
      return {
        items: items.map(({ entryId, modelId, fieldId, locale, state }) => ({
          entryId,
          modelId,
          fieldId,
          locale,
          state,
        })),
        total,
      };
    },
  },
  jobs: {
    enqueue: async (name, payload = {}, options = {}) => {
      if (!environment.jobNames.has(name)) {
        throw new Error(`No job "${name}" in shapio.config jobs`);
      }
      const { job, created } = await enqueueJob(
        {
          type: `${EXTENSION_JOB_PREFIX}${name}`,
          payload,
          ...(options.runAt ? { runAt: options.runAt } : {}),
          ...(options.idempotencyKey
            ? { idempotencyKey: `${EXTENSION_JOB_PREFIX}${name}:${options.idempotencyKey}` }
            : {}),
          ...(options.maxAttempts ? { maxAttempts: options.maxAttempts } : {}),
        },
        environment.db,
      );
      return { id: job.id, created };
    },
  },
  logger: environment.logger,
});

export const toHostConfig = (config: AppConfig, projectDir: string): ExtensionHostConfig => ({
  nodeEnv: config.nodeEnv,
  publicUrl: config.server.publicUrl,
  basePath: config.server.basePath,
  projectDir,
});

/**
 * Shapio's services, then each custom service in declaration order (a service sees the ones declared before
 * it). A factory that throws fails startup.
 */
export const createExtensionServices = async (
  environment: ServiceEnvironment,
  factories: Readonly<Record<string, ServiceFactory>>,
  host: ExtensionHostConfig,
): Promise<ExtensionServices> => {
  // Custom services are only known to the type system through `CustomServices` augmentation.
  const services: ShapioServices & Record<string, unknown> = { ...createShapioServices(environment) };
  for (const [name, factory] of Object.entries(factories)) {
    try {
      services[name] = await factory({
        db: environment.db,
        config: host,
        logger: environment.logger.child({ service: name }),
        services: { ...services },
      });
    } catch (error) {
      throw new Error(`shapio.config service "${name}" failed to start: ${describeError(error)}`, {
        cause: error,
      });
    }
  }
  return Object.freeze(services);
};
