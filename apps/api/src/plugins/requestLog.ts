import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Principal } from '../permissions/types.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** `debug`: the route's response line is written at debug, not info (health and readiness probes). */
    requestLog?: 'debug';
  }
}

/** How the caller authenticated, as logged: the principal's kind, never its ids. */
const PRINCIPAL_LABELS = {
  anonymous: 'anonymous',
  admin: 'admin',
  token: 'token',
  appUser: 'app',
  system: 'system',
} as const satisfies Record<Principal['kind'], string>;

/** The concrete path without its query string, which may carry credentials (signed media URLs, OAuth). */
const pathOf = (url: string): string => {
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : url.slice(0, queryStart);
};

/** Milliseconds with one decimal. */
const roundMs = (ms: number): number => Math.round(ms * 10) / 10;

/**
 * The request's one response line. `request.principal` is undefined when the request failed before
 * authentication ran; `request.site` only on site routes; `request.errorCode` only when the central error
 * handler (plugins/errorHandler.ts) answered.
 */
const responseLineOf = (request: FastifyRequest, reply: FastifyReply) => {
  const principal = request.principal as Principal | undefined;
  return {
    method: request.method,
    ...(request.routeOptions.url ? { route: request.routeOptions.url } : {}),
    path: pathOf(request.url),
    status: reply.statusCode,
    ms: roundMs(reply.elapsedTime),
    ...(request.site ? { site: request.site.key } : {}),
    ...(principal ? { principal: PRINCIPAL_LABELS[principal.kind] } : {}),
    ...(request.errorCode ? { code: request.errorCode } : {}),
  };
};

/**
 * Replaces Fastify's request logging (`disableRequestLogging`): one info line per response with the fields
 * that matter, and the request-start line (full redacted URL, host, remote address) at debug. The logger's
 * `reqId` binding is `request.id`, the id audit entries and extension contexts carry.
 */
export const requestLogPlugin = fp(
  async (app: FastifyInstance) => {
    app.addHook('onRequest', async (request) => {
      request.log.debug({ req: request }, 'incoming request');
    });
    app.addHook('onResponse', async (request, reply) => {
      const line = responseLineOf(request, reply);
      if (request.routeOptions.config?.requestLog === 'debug') {
        request.log.debug(line, 'request');
      } else {
        request.log.info(line, 'request');
      }
    });
  },
  { name: 'shapio-request-log' },
);
