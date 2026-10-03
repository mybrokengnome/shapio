import type { FastifyInstance, FastifyRequest, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';
import { SITE_HEADER, SITE_QUERY_PARAMETER } from '../constants/sites.js';
import { AppError } from '../helpers/appError.js';
import { principalForSite } from '../permissions/sites.js';
import type { SiteRef } from '../services/actorContext.js';
import { resolveSite } from '../services/sites.js';

/**
 * Sites (plan agentic-ecosystem §H, ADR 0011). Every API route declares whether it is about one site
 * (`config.site = 'site'`: content, media, publishing, change sets, snapshots, tokens, delivery) or about the
 * whole instance (`'network'`: users, roles, schema, audit, sites, health, setup). Startup fails on an API
 * route without a declaration, like the audit declaration, so a new route cannot forget which it is.
 *
 * For a site route, the site is resolved after authentication: the credential's site (a site token), else
 * the site the request names (`Shapio-Site` header or `?site=`), else the primary site. A request naming a
 * different site than its credential is refused (403 `SITE_MISMATCH`). The admin principal is then narrowed
 * to that site's roles. Network routes keep the network-narrowed principal and have no `request.site`.
 */
export type RouteSiteScope = 'site' | 'network';

declare module 'fastify' {
  interface FastifyContextConfig {
    site?: RouteSiteScope;
  }
  interface FastifyRequest {
    /** The request's site on a site route; undefined on network routes. Read it with `getRequestSite`. */
    site: SiteRef | undefined;
  }
}

const SCOPES: ReadonlySet<unknown> = new Set<RouteSiteScope>(['site', 'network']);

export class MissingSiteDeclarationError extends Error {
  constructor(method: RouteOptions['method'], url: string) {
    super(
      `Route ${String(method)} ${url} declares no site scope. ` +
        `Add config.site = 'site' or 'network' (or declareSiteScope in its route plugin).`,
    );
    this.name = 'MissingSiteDeclarationError';
  }
}

/**
 * Declares the site scope of every route a route plugin registers (a route may still set its own
 * `config.site`). Call it first in the plugin: it only sees routes registered after it.
 */
export const declareSiteScope = (app: FastifyInstance, scope: RouteSiteScope): void => {
  app.addHook('onRoute', (route) => {
    route.config = { ...route.config, site: route.config?.site ?? scope };
  });
};

/** The site of a site-scoped request. Calling it from a network route is a programming error. */
export const getRequestSite = (request: FastifyRequest): SiteRef => {
  if (!request.site) {
    throw new Error(`${request.method} ${request.routeOptions.url ?? request.url} is not a site route`);
  }
  return request.site;
};

const singleValue = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
};

/** The site key the request names: the header, else the query parameter (they must agree when both are set). */
const requestedSiteKey = (request: FastifyRequest): string | undefined => {
  const fromHeader = singleValue(request.headers[SITE_HEADER]);
  const query = request.query as Record<string, unknown> | undefined;
  const fromQuery = singleValue(query?.[SITE_QUERY_PARAMETER]);
  if (fromHeader !== undefined && fromQuery !== undefined && fromHeader !== fromQuery) {
    throw new AppError(403, 'SITE_MISMATCH', `The ${SITE_HEADER} header and ?site= name different sites`);
  }
  return fromHeader ?? fromQuery;
};

/** The site the credential belongs to, if it names one (site tokens; app users per site come with G3). */
const credentialSiteOf = (request: FastifyRequest): string | undefined =>
  request.principal.kind === 'token' && request.principal.siteId !== null
    ? request.principal.siteId
    : undefined;

type SiteResolutionOptions = { apiPrefix: string };

export const siteResolutionPlugin = fp<SiteResolutionOptions>(
  async (app: FastifyInstance, { apiPrefix }) => {
    const apiRoutes: RouteOptions[] = [];
    app.addHook('onRoute', (route) => {
      if (route.url.startsWith(apiPrefix)) {
        apiRoutes.push(route);
      }
    });
    // Route plugins set their declaration in their own onRoute hook, which runs after this one; check once
    // every route is registered.
    app.addHook('onReady', async () => {
      const undeclared = apiRoutes.find((route) => !SCOPES.has(route.config?.site));
      if (undeclared) {
        throw new MissingSiteDeclarationError(undeclared.method, undeclared.url);
      }
    });

    app.decorateRequest('site', undefined);
    app.addHook('onRequest', async (request) => {
      if (request.routeOptions.config?.site !== 'site') {
        return;
      }
      const site = await resolveSite({
        credentialSiteId: credentialSiteOf(request),
        requestedKey: requestedSiteKey(request),
      });
      request.site = site;
      request.principal = principalForSite(request.principal, site.id);
    });
  },
  { name: 'shapio-site-resolution', dependencies: ['shapio-admin-session'] },
);
