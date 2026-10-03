import type { FastifyRequest } from 'fastify';
import { getRequestSite } from '../plugins/siteResolution.js';
import type { ActorContext, ClientInfo, SiteActorContext } from '../services/actorContext.js';

/** Who is acting on this request, for services that audit. */
export const toActorContext = (request: FastifyRequest): ActorContext => ({
  actor: request.principal,
  requestId: request.id,
  ip: request.ip,
  ...(request.site ? { site: request.site } : {}),
});

/** The actor context of a site route: the site is required (sites plan §H). */
export const toSiteActorContext = (request: FastifyRequest): SiteActorContext => ({
  ...toActorContext(request),
  site: getRequestSite(request),
});

export const toClientInfo = (request: FastifyRequest): ClientInfo => ({
  ip: request.ip,
  userAgent: request.headers['user-agent'],
});
