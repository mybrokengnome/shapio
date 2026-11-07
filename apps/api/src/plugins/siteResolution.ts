import type { FastifyInstance, FastifyRequest, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../helpers/appError.js';
import {
  deleteSiteParameters,
  pickSiteKey,
  siteHeaderCandidates,
  siteQueryCandidates,
} from '../helpers/siteQuery.js';
import { principalForSite } from '../permissions/sites.js';
import type { SiteRef } from '../services/actorContext.js';
import { resolveSite } from '../services/sites.js';
import { readRequestSite } from './requestState.js';

/**
 * Sites (plan agentic-ecosystem §H, ADR 0011). Every API route declares whether it is about one site
 * (`config.site = 'site'`: content, media, publishing, change sets, snapshots, tokens, delivery) or about the
 * whole instance (`'network'`: users, roles, schema, audit, sites, health, setup). Startup fails on an API
 * route without a declaration, like the audit declaration, so a new route cannot forget which it is.
 *
 * For a site route, the site is resolved after authentication: the credential's site (a site token), else
 * the site the request names (the `Shapio-Workspace` or `Shapio-Site` header, `?workspace=` or `?site=`), else
 * the primary site. A request naming a different site than its credential is refused (403 `SITE_MISMATCH`).
 * The admin principal is then narrowed to that site's roles. Network routes keep the network-narrowed
 * principal and have no `request.site`. (User-facing text calls a site a workspace; code keeps `site`.)
 */
export type RouteSiteScope = 'site' | 'network';

declare module 'fastify' {
  interface FastifyContextConfig {
    site?: RouteSiteScope;
    /** `unassigned`: admins without a role on the request's site may still call it (only `me`). */
    siteAccess?: 'unassigned';
    /**
     * A site route whose credential is not a principal (a preview token, resolved by its service) names
     * the credential's site here; undefined when the request carries no such credential. Its site wins and
     * is checked against the requested site like a site token's.
     */
    siteCredential?: (request: FastifyRequest) => Promise<string | undefined>;
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

/**
 * The workspace key the request names: either header (`Shapio-Workspace`, `Shapio-Site`) or either query
 * parameter (`?workspace=`, `?site=`). Every one that is set must agree (403 `SITE_MISMATCH`); a repeated
 * parameter is refused (400).
 */
const requestedSiteKey = (request: FastifyRequest): string | undefined =>
  pickSiteKey([
    ...siteHeaderCandidates(request.headers),
    ...siteQueryCandidates(request.query as Record<string, unknown> | undefined),
  ]);

/**
 * `?workspace=` and `?site=` belong to site resolution, not to the route: they are removed from the parsed
 * query once read, so a route's strict querystring schema never sees them (`rawQueryOf` drops them from the
 * raw query likewise).
 */
const consumeSiteQuery = (request: FastifyRequest): void => {
  deleteSiteParameters(request.query as Record<string, unknown> | undefined);
};

/**
 * The site the principal's credential belongs to, if it names one: any principal carrying a `siteId` (site
 * tokens, app users). Admin and anonymous principals never do: their `siteId` is the result of
 * narrowing to the request's site, not part of the credential. Null or undefined: no credential site.
 */
const principalSiteOf = (request: FastifyRequest): string | undefined => {
  const { principal } = request;
  if (principal.kind === 'admin' || principal.kind === 'anonymous' || !('siteId' in principal)) {
    return undefined;
  }
  return typeof principal.siteId === 'string' ? principal.siteId : undefined;
};

/** The credential's site: the route's own credential (`config.siteCredential`) first, else the principal's. */
const credentialSiteOf = async (request: FastifyRequest): Promise<string | undefined> => {
  const routeCredential = request.routeOptions.config?.siteCredential;
  return (routeCredential ? await routeCredential(request) : undefined) ?? principalSiteOf(request);
};

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
      const requestedKey = requestedSiteKey(request);
      consumeSiteQuery(request);
      // Read with the request's schema and permissions versions, in one statement (`getRequestState`).
      const site = await resolveSite(
        { credentialSiteId: await credentialSiteOf(request), requestedKey },
        (lookup) => readRequestSite(request, lookup),
      );
      request.site = site;
      request.principal = principalForSite(request.principal, site.id);
      // An admin with no role on the site (none there, none on every site) cannot work on it at all; `me`
      // still answers, so the admin can tell where they work and switch sites.
      if (
        request.principal.kind === 'admin' &&
        request.principal.roleIds.length === 0 &&
        request.routeOptions.config?.siteAccess !== 'unassigned'
      ) {
        throw new AppError(403, 'SITE_FORBIDDEN', 'You have no role on this workspace');
      }
    });
  },
  { name: 'shapio-site-resolution', dependencies: ['shapio-admin-session'] },
);
