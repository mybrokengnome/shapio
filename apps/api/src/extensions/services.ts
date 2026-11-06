import { isModelDefinition } from '@shapio/schema';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config/index.js';
import { EXTENSION_JOB_PREFIX, EXTENSION_SYSTEM_COMPONENT } from '../constants/extensions.js';
import { modelRouteOf, resolveModel } from '../content/model.js';
import type { Database } from '../db/index.js';
import { describeError } from '../helpers/errors.js';
import { enqueueJob } from '../jobs/queue.js';
import type { PermissionEvaluator, Principal } from '../permissions/types.js';
import * as entriesRepository from '../repositories/entries.js';
import type { SchemaRegistry } from '../schema/registry.js';
import type { SiteRef } from '../services/actorContext.js';
import type { ContentServiceContext } from '../services/contentAccess.js';
import { buildContentContext } from '../services/contentContext.js';
import { getAdminEntry, listAdminEntries } from '../services/contentReads.js';
import { listUsagesOnSite } from '../services/mediaReferences.js';
import { copyServices } from './copyServices.js';
import { createPrimarySiteTracker, type PrimarySiteTracker } from './primarySite.js';
import type {
  ContentReadEntry,
  ExtensionHostConfig,
  ExtensionSite,
  ExtensionServices,
  ServiceFactory,
  ShapioServices,
} from './public.js';
import { toServiceModel } from './serviceModels.js';

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

/**
 * The site a set of services reads: one fixed site (`forSite`, a hook's site), or the primary site, which
 * top-level services (routes, jobs, factories) follow live: `read` resolves it on every call, `current` is
 * what the synchronous `site` property returns.
 */
type SiteSource = { current: () => SiteRef; read: () => Promise<SiteRef> };

const fixedSite = (site: SiteRef): SiteSource => ({ current: () => site, read: async () => site });

const primarySite = (tracker: PrimarySiteTracker): SiteSource => ({
  current: tracker.current,
  read: tracker.refresh,
});

const SYSTEM_PRINCIPAL: Principal = { kind: 'system', component: EXTENSION_SYSTEM_COMPONENT };

const contentContext = async (
  environment: ServiceEnvironment,
  site: SiteRef,
  principal: Principal | undefined,
): Promise<ContentServiceContext> =>
  // Content is per site (sites plan §H, ADR 0009 note): these services read their own site's view.
  buildContentContext({
    db: environment.db,
    network: await environment.registry.getSnapshot(),
    permissions: environment.permissions,
    actor: principal ?? SYSTEM_PRINCIPAL,
    site,
  });

const toReadEntry = (view: { id: string; locale: string; status: string; data: Record<string, unknown> }) =>
  ({ id: view.id, locale: view.locale, status: view.status, data: view.data }) satisfies ContentReadEntry;

const createShapioServices = (environment: ServiceEnvironment, source: SiteSource): ShapioServices => {
  const services: Omit<ShapioServices, 'site'> = {
    forSite: (other: ExtensionSite) =>
      createShapioServices(environment, fixedSite({ id: other.id, key: other.key })),
    content: {
      get: async (modelKey, id, options = {}) =>
        toReadEntry(
          await getAdminEntry(
            await contentContext(environment, await source.read(), options.principal),
            modelKey,
            id,
            options.locale,
          ),
        ),
      list: async (modelKey, query = '', options = {}) => {
        const result = await listAdminEntries(
          await contentContext(environment, await source.read(), options.principal),
          modelKey,
          query,
        );
        return { items: result.items.map(toReadEntry), total: result.pagination.total };
      },
      models: async () => {
        const site = await source.read();
        const view = (await environment.registry.getSnapshot()).forSite(site.id);
        const apiKeyOf = (id: string) => view.byId.get(id)?.definition.apiKey;
        return [...view.byId.values()]
          .map((active) => active.definition)
          .filter(isModelDefinition)
          .flatMap((definition) => {
            const resolved = view.resolve(definition.id);
            return resolved ? [toServiceModel(resolved, modelRouteOf(view, definition), apiKeyOf)] : [];
          });
      },
      count: async (modelKey) => {
        const site = await source.read();
        const model = resolveModel((await environment.registry.getSnapshot()).forSite(site.id), modelKey);
        return entriesRepository.countLive(model.definition.id, site.id, environment.db);
      },
    },
    media: {
      usages: async (assetId) => {
        const { items, total } = await listUsagesOnSite(await source.read(), assetId);
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
  };
  // An accessor, not a value: on top-level services it follows the primary site (as last read).
  return Object.defineProperty(services, 'site', {
    get: source.current,
    enumerable: true,
    configurable: true,
  }) as ShapioServices;
};

export const toHostConfig = (config: AppConfig, projectDir: string): ExtensionHostConfig => ({
  nodeEnv: config.nodeEnv,
  publicUrl: config.server.publicUrl,
  basePath: config.server.basePath,
  projectDir,
});

/**
 * Shapio's services, then each custom service in declaration order (a service sees the ones declared before
 * it). A factory that throws fails startup. Shapio's services read the primary site, followed live: a site
 * made primary while the server runs is read from the next call on, no restart.
 */
export const createExtensionServices = async (
  environment: ServiceEnvironment,
  factories: Readonly<Record<string, ServiceFactory>>,
  host: ExtensionHostConfig,
): Promise<ExtensionServices> => {
  // Custom services are only known to the type system through `CustomServices` augmentation.
  const tracker = await createPrimarySiteTracker(environment.db);
  const services: ShapioServices & Record<string, unknown> = createShapioServices(
    environment,
    primarySite(tracker),
  );
  for (const [name, factory] of Object.entries(factories)) {
    try {
      services[name] = await factory({
        db: environment.db,
        config: host,
        logger: environment.logger.child({ service: name }),
        services: copyServices(services),
      });
    } catch (error) {
      throw new Error(`shapio.config service "${name}" failed to start: ${describeError(error)}`, {
        cause: error,
      });
    }
  }
  return Object.freeze(services);
};
