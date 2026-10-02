import type { FastifyRequest } from 'fastify';
import type { ActorContext, ClientInfo } from '../services/actorContext.js';

/** Who is acting on this request, for services that audit. */
export const toActorContext = (request: FastifyRequest): ActorContext => ({
  actor: request.principal,
  requestId: request.id,
  ip: request.ip,
});

export const toClientInfo = (request: FastifyRequest): ClientInfo => ({
  ip: request.ip,
  userAgent: request.headers['user-agent'],
});
