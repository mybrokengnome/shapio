import type { FastifyReply, FastifyRequest } from 'fastify';
import type { IssuedSession } from '../services/adminSessions.js';

/** A CSRF token for the session whose secret is `csrfSecret` (@fastify/csrf-protection, session mode). */
export const issueCsrfToken = (request: FastifyRequest, reply: FastifyReply, csrfSecret: string): string => {
  request.session = { _csrf: csrfSecret };
  return reply.generateCsrf();
};

/** Sends the session cookie for a new session and returns the CSRF token that goes with it. */
export const startSessionResponse = (
  request: FastifyRequest,
  reply: FastifyReply,
  session: IssuedSession,
): string => {
  reply.setSessionCookie(session);
  return issueCsrfToken(request, reply, session.csrfSecret);
};
