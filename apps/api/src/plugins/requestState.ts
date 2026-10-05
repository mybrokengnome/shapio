import type { FastifyRequest } from 'fastify';
import { scopePermissions } from '../permissions/scoped.js';
import type { PermissionEvaluator } from '../permissions/types.js';
import type { SiteLookup } from '../repositories/requestState.js';
import type { SiteRef } from '../services/actorContext.js';
import { readRequestState, type RequestState } from '../services/requestState.js';
import { findSite } from '../services/sites.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set on first use by `getRequestState`: the versions (and site) this request read, once. */
    requestState: Promise<RequestState> | null;
    /** Set on first use by `getRequestPermissions`: the request's memoized evaluator. */
    requestPermissions: PermissionEvaluator | null;
  }
}

/**
 * The durable schema and permissions versions this request checks its caches against, read once on the pool
 * before any transaction (ADR 0002, ADR 0005): a change committed after the read applies from the next
 * request. The first caller reads; site resolution (an `onRequest` hook, before any other caller on a site
 * route) passes its site lookup so the site is read in the same statement.
 */
export const getRequestState = (request: FastifyRequest, lookup?: SiteLookup): Promise<RequestState> => {
  request.requestState ??= readRequestState(lookup);
  return request.requestState;
};

/** Reads the request's site with its state, or on its own when the state was already read without it. */
export const readRequestSite = async (
  request: FastifyRequest,
  lookup: SiteLookup,
): Promise<SiteRef | undefined> =>
  request.requestState ? findSite(lookup) : (await getRequestState(request, lookup)).site;

/**
 * The request's evaluator: checked against the request's versions, and memoized per (principal, action,
 * model) for the request (`permissions/memo.ts`), for REST as for GraphQL. Create it after site resolution,
 * which settles the principal.
 */
export const getRequestPermissions = (request: FastifyRequest): PermissionEvaluator => {
  request.requestPermissions ??= scopePermissions(request.server.permissions, request.principal, {
    read: async () => (await getRequestState(request)).versions,
    isRead: () => request.requestState !== null,
  });
  return request.requestPermissions;
};
