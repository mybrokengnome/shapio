import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { EXTENSION_ROUTE_ROOT } from '../constants/extensions.js';
import type { ExtensionRuntime } from '../extensions/runtime.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import { recordAudit } from '../services/audit.js';
import { declareSiteScope } from './siteResolution.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Project extensions (ADR 0009): the custom services, shared by routes, hooks and jobs. */
    ext: Pick<ExtensionRuntime, 'services' | 'permissions'>;
  }
}

type ExtensionsPluginOptions = { runtime: ExtensionRuntime; urls: UrlBuilder };

const MUTATING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Records the declared audit action of a successful mutating custom route, before the response is sent.
 * Core routes write their audit row inside their own transaction; a custom route gets this one once its
 * handler succeeded, so the declaration the onRoute check demands is never only a declaration.
 */
const auditCustomRoute = async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
  const audit = request.routeOptions.config.audit;
  if (!MUTATING_METHODS.has(request.method) || reply.statusCode >= 400 || !audit || !('action' in audit)) {
    return payload;
  }
  try {
    await recordAudit(request.server.db, {
      actor: request.principal,
      action: audit.action,
      metadata: { route: request.routeOptions.url, method: request.method, statusCode: reply.statusCode },
      requestId: request.id,
      ip: request.ip,
      ...(request.site ? { site: request.site } : {}),
    });
  } catch (error) {
    request.log.error({ err: error, action: audit.action }, 'audit of a custom route failed');
  }
  return payload;
};

/**
 * Mounts the project's custom routes at `/api/ext/<prefix>`. They are ordinary routes of this app, so the
 * audit-declaration check, the error handler, rate limiting, sessions/tokens (`request.principal`) and CSRF
 * apply to them exactly as to core routes.
 */
export const extensionsPlugin = fp<ExtensionsPluginOptions>(
  async (app: FastifyInstance, { runtime, urls }) => {
    app.decorate('ext', { services: runtime.services, permissions: runtime.permissions });
    for (const route of runtime.routes) {
      await app.register(
        async (scope) => {
          // Custom routes are site routes: `request.site` is the request's site (its token's, `?site=` or
          // `Shapio-Site`, else the primary site); a route may still declare `config.site = 'network'`.
          declareSiteScope(scope, 'site');
          scope.addHook('onSend', auditCustomRoute);
          await scope.register(route.plugin, {
            services: runtime.services,
            permissions: runtime.permissions,
            logger: app.log.child({ component: 'extensions', route: route.prefix }),
            requireAdmin: app.requireAdmin,
          });
        },
        { prefix: urls.withBasePath(`${EXTENSION_ROUTE_ROOT}/${route.prefix}`) },
      );
    }
    if (runtime.routes.length > 0) {
      app.log.info({ prefixes: runtime.routes.map((route) => route.prefix) }, 'custom routes mounted');
    }
  },
  { name: 'shapio-extensions' },
);
