import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import { resolve } from 'node:path';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyBaseLogger, type FastifyHttpOptions, type FastifyInstance } from 'fastify';
import type { OAuthEndpoints, OAuthProviderId } from './appAuth/oauth/types.js';
import type { AppConfig } from './config/index.js';
import type { ContentHooks } from './content/hooks.js';
import { createContentPorts } from './content/ports.js';
import { setDb, type Database } from './db/index.js';
import { buildEditorManifest, type EditorManifest } from './extensions/editorManifest.js';
import { loadExtensionRuntime, type ExtensionRuntime } from './extensions/runtime.js';
import { buildThemeCatalogue } from './extensions/themeStylesheet.js';
import { createUrlBuilder } from './helpers/publicUrl.js';
import { createLoggerOptions } from './logger.js';
import { resolveMediaOrigins } from './media/origins.js';
import { createPermissionCache } from './permissions/cache.js';
import { createPermissionEvaluator } from './permissions/evaluator.js';
import type { FieldVisibilityLookup } from './permissions/policy.js';
import type { PermissionEvaluator } from './permissions/types.js';
import { adminBootstrapPlugin } from './plugins/adminBootstrap.js';
import { adminSessionPlugin } from './plugins/adminSession.js';
import { appUserAuthPlugin } from './plugins/appUserAuth.js';
import { assistPlugin } from './plugins/assist.js';
import { auditDeclarationPlugin } from './plugins/auditDeclaration.js';
import { contentHooksPlugin } from './plugins/contentHooks.js';
import { csrfPlugin } from './plugins/csrf.js';
import { editorManifestPlugin } from './plugins/editorManifest.js';
import { errorHandlerPlugin } from './plugins/errorHandler.js';
import { extensionsPlugin } from './plugins/extensions.js';
import { gracefulClosePlugin } from './plugins/gracefulClose.js';
import { graphqlPlugin } from './plugins/graphql.js';
import { mediaStoragePlugin } from './plugins/mediaStorage.js';
import { publishingPlugin } from './plugins/publishing.js';
import { schemaSnapshotPlugin } from './plugins/schemaSnapshot.js';
import { securityPlugin } from './plugins/security.js';
import { servicesPlugin } from './plugins/services.js';
import { siteResolutionPlugin } from './plugins/siteResolution.js';
import { staticAdminPlugin } from './plugins/staticAdmin.js';
import { themeCataloguePlugin } from './plugins/themeCatalogue.js';
import { usagePlugin } from './plugins/usage.js';
import type { HostResolver } from './publishing/outbound/ssrf.js';
import { createPublishingRuntime } from './publishing/runtime.js';
import { adminAppRolesRoutes } from './routes/admin/appRoles/index.js';
import { adminAppUsersRoutes } from './routes/admin/appUsers/index.js';
import { adminAssistRoutes } from './routes/admin/assist/index.js';
import { componentsRoutes } from './routes/admin/components/index.js';
import { adminContentRoutes } from './routes/admin/content/index.js';
import { adminExtensionsRoutes } from './routes/admin/extensions/index.js';
import { adminIdentityRoutes } from './routes/admin/index.js';
import { localesRoutes } from './routes/admin/locales/index.js';
import { adminMediaRoutes } from './routes/admin/media/index.js';
import { modelsRoutes } from './routes/admin/models/index.js';
import { adminPublishingRoutes } from './routes/admin/publishing/index.js';
import { schemaRoutes } from './routes/admin/schema/index.js';
import { adminTransferRoutes } from './routes/admin/transfer/index.js';
import { appAuthRoutes } from './routes/app-auth/index.js';
import { deliveryRoutes } from './routes/content/index.js';
import { docsRoutes } from './routes/docs/index.js';
import { graphqlPlaygroundRoutes } from './routes/graphql/index.js';
import { healthRoutes } from './routes/health/index.js';
import { hooksRoutes } from './routes/hooks/index.js';
import { mediaFilesRoutes } from './routes/media/index.js';
import { previewRoutes } from './routes/preview/index.js';
import { snapshotsRoutes } from './routes/snapshots/index.js';
import { createSchemaFieldVisibility } from './schema/fieldVisibility.js';
import type { SchemaContentPorts } from './schema/planner/contentPorts.js';
import { createSchemaRegistry } from './schema/registry.js';
import { createPreviewFrameSources } from './services/previewOrigins.js';
import { resolveSigningSecret } from './services/signingSecret.js';
import type { CertificatePair } from './tls/certificates.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Schema facts permissions need (field visibility, model existence); see permissions/policy.ts. */
    schemaLookup: FieldVisibilityLookup;
    /** HMAC signing secret: SESSION_SECRET, or generated once and stored (services/signingSecret.ts). */
    signingSecret: string;
  }
}

export type AppDependencies = {
  db: Database;
  /** A pino logger to share with the worker; otherwise one is created from config. */
  logger?: FastifyBaseLogger;
  /** Overrides the role-based evaluator (tests). */
  permissions?: PermissionEvaluator;
  /** Resolved by the server before building the app; resolved here when omitted (tests, tools). */
  signingSecret?: string;
  /** Field definitions for `public` semantics. Defaults to the schema registry's active schema. */
  fieldVisibility?: FieldVisibilityLookup;
  /** Content storage as the schema planner sees it. Defaults to the real content ports (content/ports.ts). */
  schemaContent?: SchemaContentPorts;
  /** Content lifecycle hooks (tests). Defaults to the extension runtime's hooks. */
  contentHooks?: ContentHooks;
  /**
   * Project extensions (shapio.config), shared with the worker. Omitted: loaded here from SHAPIO_CONFIG_PATH
   * or `projectDir`, and closed with the app.
   */
  extensions?: ExtensionRuntime;
  /** LISTEN for schema changes (cache refresh). Default true; correctness never depends on it. */
  schemaListen?: boolean;
  /** Serve HTTPS with this certificate (from TLS_CERT_FILE/TLS_KEY_FILE). Omit for plain HTTP. */
  tls?: CertificatePair;
  /** OAuth provider endpoints (tests point them at a local fake). Defaults to the real providers. */
  oauthEndpoints?: Partial<Record<OAuthProviderId, OAuthEndpoints>>;
  /** The project directory (`shapio.config.js`, `extensions/`). Defaults to the working directory. */
  projectDir?: string;
  /** Overrides the custom editor manifest read from the project (tests). */
  editorManifest?: EditorManifest;
  /** Directory of the built admin SPA. Defaults to the bundled copy (npm) or apps/admin/dist (repo). */
  adminDistPath?: string | null;
  /** DNS resolution for outbound webhook/deploy requests (tests inject a controllable resolver). */
  outboundResolver?: HostResolver;
};

/** `dist/admin` inside the published package; `apps/admin/dist` when running from the repository. */
const findAdminDist = (): string | undefined =>
  [resolve(import.meta.dirname, 'admin'), resolve(import.meta.dirname, '../../admin/dist')].find((path) =>
    existsSync(resolve(path, 'index.html')),
  );

/**
 * TRUST_PROXY as a hop count: trust the nearest `hops` proxies (what Fastify does for a number at runtime,
 * expressed as a function because its types only accept boolean/string/function).
 */
const toFastifyTrustProxy = (trustProxy: boolean | number) =>
  typeof trustProxy === 'number' ? (_address: string, hop: number) => hop < trustProxy : trustProxy;

/**
 * Builds the Fastify app: plugins and routes, no listen(). Every route is mounted under BASE_PATH.
 * The caller owns the database handle and closes it after `app.close()`.
 */
export const buildApp = async (config: AppConfig, deps: AppDependencies): Promise<FastifyInstance> => {
  setDb(deps.db);
  const urls = createUrlBuilder(config.server);
  const options = {
    ...(deps.logger ? { loggerInstance: deps.logger } : { logger: createLoggerOptions(config) }),
    // Fastify's types model one server kind per instance; Shapio chooses HTTP or HTTPS at runtime and
    // types the instance as HTTP (request/reply APIs are identical; TLS details stay in tls/).
    ...(deps.tls ? { https: { key: deps.tls.key, cert: deps.tls.cert } } : {}),
    trustProxy: toFastifyTrustProxy(config.server.trustProxy),
    genReqId: () => randomUUID(),
    ajv: { customOptions: { removeAdditional: false } },
  } as FastifyHttpOptions<HttpServer, FastifyBaseLogger>;
  const app = Fastify(options).withTypeProvider<TypeBoxTypeProvider>();
  // Created before the evaluator, which reads field visibility from the active schema.
  const schemaRegistry = createSchemaRegistry({
    db: deps.db,
    log: app.log.child({ component: 'schema-registry' }),
  });
  const schemaLookup = deps.fieldVisibility ?? createSchemaFieldVisibility(schemaRegistry);

  // Order matters: the audit check must see every route registered after it.
  await app.register(auditDeclarationPlugin);
  await app.register(gracefulClosePlugin);
  await app.register(errorHandlerPlugin);
  await app.register(servicesPlugin, {
    config,
    db: deps.db,
    permissions:
      deps.permissions ??
      createPermissionEvaluator({ grants: createPermissionCache(deps.db), fields: schemaLookup }),
    urls,
  });
  await app.register(usagePlugin, { config: config.usage, db: deps.db });
  await app.register(securityPlugin, {
    http: config.http,
    httpsPublicUrl: urls.publicUrl.startsWith('https:'),
    mediaOrigins: await resolveMediaOrigins(config.storage),
  });

  app.decorate('schemaLookup', schemaLookup);
  app.decorate(
    'signingSecret',
    deps.signingSecret ?? (await resolveSigningSecret(deps.db, config.sessionSecret, app.log)),
  );
  await app.register(mediaStoragePlugin, { storage: config.storage, urls, signingSecret: app.signingSecret });
  await app.register(adminSessionPlugin, { urls, secureCookies: urls.publicUrl.startsWith('https:') });
  // After the session plugin (it leaves app-user bearer tokens to this one), before CSRF (which skips them).
  await app.register(appUserAuthPlugin, {
    config: config.appAuth,
    urls,
    signingSecret: app.signingSecret,
    corsOrigins: config.http.corsOrigins,
    ...(deps.oauthEndpoints ? { oauthEndpoints: deps.oauthEndpoints } : {}),
  });
  // After both authentication plugins (it narrows their principal to the request's site), before every route.
  await app.register(siteResolutionPlugin, { apiPrefix: urls.withBasePath('/api/') });
  await app.register(csrfPlugin);
  await app.register(adminBootstrapPlugin, {
    db: deps.db,
    urls,
    requireSetupToken: config.setup.requireToken,
  });
  await app.register(schemaSnapshotPlugin, {
    registry: schemaRegistry,
    listen: deps.schemaListen ?? true,
    contentPorts: deps.schemaContent ?? createContentPorts(deps.db),
  });

  await app.register(healthRoutes, { prefix: urls.withBasePath('/api') });
  await app.register(adminIdentityRoutes, { prefix: urls.withBasePath('/api/admin') });
  await app.register(adminAppUsersRoutes, { prefix: urls.withBasePath('/api/admin/app-users') });
  await app.register(adminAppRolesRoutes, { prefix: urls.withBasePath('/api/admin/app-roles') });
  await app.register(appAuthRoutes, { prefix: urls.withBasePath('/api/app-auth') });
  await app.register(modelsRoutes, { prefix: urls.withBasePath('/api/admin/models') });
  await app.register(componentsRoutes, { prefix: urls.withBasePath('/api/admin/components') });
  await app.register(schemaRoutes, { prefix: urls.withBasePath('/api/admin/schema') });
  await app.register(localesRoutes, { prefix: urls.withBasePath('/api/admin/locales') });
  await app.register(adminMediaRoutes, { prefix: urls.withBasePath('/api/admin/media') });
  await app.register(mediaFilesRoutes, { prefix: urls.withBasePath('/api/media') });
  const extensions =
    deps.extensions ??
    (await loadExtensionRuntime({
      db: deps.db,
      config,
      logger: app.log,
      permissions: app.permissions,
      searchDir: deps.projectDir ?? process.cwd(),
    }));
  if (!deps.extensions) {
    app.addHook('onClose', async () => extensions.close());
  }
  await app.register(contentHooksPlugin, { hooks: deps.contentHooks ?? extensions.hooks });
  await app.register(adminContentRoutes, { prefix: urls.withBasePath('/api/admin/content') });
  await app.register(editorManifestPlugin, {
    manifest:
      deps.editorManifest ??
      buildEditorManifest(
        extensions.loaded.projectDir,
        extensions.loaded.config.editors ?? [],
        app.log.child({ component: 'extensions' }),
      ),
  });
  await app.register(themeCataloguePlugin, {
    catalogue: buildThemeCatalogue(extensions.loaded.config.themes ?? []),
  });
  await app.register(adminExtensionsRoutes, { prefix: urls.withBasePath('/api/admin/extensions') });
  await app.register(deliveryRoutes, { prefix: urls.withBasePath('/api/content') });
  await app.register(snapshotsRoutes, { prefix: urls.withBasePath('/api/snapshots') });
  await app.register(docsRoutes, { prefix: urls.withBasePath('/api/docs') });
  if (config.graphql.enabled) {
    await app.register(graphqlPlugin, { config: config.graphql, urls });
    if (config.graphql.playgroundEnabled) {
      await app.register(graphqlPlaygroundRoutes, { prefix: urls.withBasePath('/api/graphql') });
    }
  }
  await app.register(publishingPlugin, {
    runtime: createPublishingRuntime({
      db: deps.db,
      signingSecret: app.signingSecret,
      urls,
      config: config.publishing,
      log: app.log.child({ component: 'publishing' }),
      ...(deps.outboundResolver ? { resolve: deps.outboundResolver } : {}),
    }),
  });
  await app.register(adminPublishingRoutes, { prefix: urls.withBasePath('/api/admin') });
  await app.register(assistPlugin, { config: config.assist, resolve: app.publishing.resolve });
  await app.register(adminAssistRoutes, { prefix: urls.withBasePath('/api/admin/assist') });
  await app.register(adminTransferRoutes, { prefix: urls.withBasePath('/api/admin/transfer') });
  await app.register(previewRoutes, { prefix: urls.withBasePath('/api/preview') });
  await app.register(hooksRoutes, { prefix: urls.withBasePath('/api/hooks') });
  await app.register(extensionsPlugin, { runtime: extensions, urls });
  await app.register(staticAdminPlugin, {
    distPath: deps.adminDistPath === null ? undefined : (deps.adminDistPath ?? findAdminDist()),
    urls,
    frameSources: createPreviewFrameSources({
      db: deps.db,
      urls,
      playgroundEnabled: config.graphql.enabled && config.graphql.playgroundEnabled,
    }),
  });

  return app;
};
