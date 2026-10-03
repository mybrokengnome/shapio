import type {
  FastifyInstance,
  FastifyRequest,
  onResponseAsyncHookHandler,
  preHandlerAsyncHookHandler,
} from 'fastify';
import { CREDENTIAL_RATE_LIMIT_PER_EMAIL, CREDENTIAL_RATE_LIMIT_PER_IP } from '../../constants/auth.js';
import { AppError } from '../../helpers/appError.js';
import { normalizeEmail } from '../../services/adminUsers.js';

/**
 * Route config for credential endpoints (they authenticate by the body, not the cookie): a tight per-IP
 * limit instead of the global one, and no CSRF check (see plugins/csrf.ts).
 */
export const CREDENTIAL_ROUTE_CONFIG = { rateLimit: CREDENTIAL_RATE_LIMIT_PER_IP, csrf: false } as const;

const emailOf = (request: FastifyRequest): string => {
  const body = request.body as { email?: unknown } | undefined;
  return typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
};

type PerEmailRateLimitOptions = {
  /** Which responses count against the address. Default: every response. */
  counts?: (statusCode: number) => boolean;
  /**
   * Key by (email, client IP) instead of the email alone. Logins use it: failures from one IP lock out only
   * that IP for that account, so nobody who merely knows an address can keep its owner from signing in.
   * Endpoints that send mail to the address (reset, registration, confirmation) keep the per-email key.
   */
  perClient?: boolean;
};

/**
 * A second limit keyed by the email in the body (and, for logins, the client IP), on top of the per-IP one.
 * The check runs after body validation without counting; the response is counted afterwards, so a login
 * can count only failures and an owner signing in on several devices is never locked out.
 * Uses the rate-limit plugin's in-memory store (per process, ADR 0008).
 */
export const createPerEmailRateLimit = (
  app: FastifyInstance,
  scope: string,
  { counts = () => true, perClient = false }: PerEmailRateLimitOptions = {},
): { preHandler: preHandlerAsyncHookHandler; onResponse: onResponseAsyncHookHandler } => {
  const limiter = app.createRateLimit({
    ...CREDENTIAL_RATE_LIMIT_PER_EMAIL,
    keyGenerator: (request) =>
      perClient
        ? `${scope}:email:${emailOf(request)}:ip:${request.ip}`
        : `${scope}:email:${emailOf(request)}`,
  });
  return {
    preHandler: async (request, reply) => {
      const result = await limiter(request, { increment: false });
      // `read` reports the current count; the limit is reached once it equals `max`.
      if (!result.isAllowed && result.remaining <= 0) {
        void reply.header('retry-after', String(Math.max(1, result.ttlInSeconds)));
        throw new AppError(429, 'RATE_LIMITED', 'Too many attempts for this account; try again later');
      }
    },
    onResponse: async (request, reply) => {
      if (request.body !== undefined && counts(reply.statusCode)) {
        await limiter(request);
      }
    },
  };
};

const actorKeyOf = (request: FastifyRequest): string => {
  const { principal } = request;
  switch (principal.kind) {
    case 'admin':
      return `admin:${principal.adminUserId}`;
    case 'token':
      return `token:${principal.tokenId}`;
    default:
      return `ip:${request.ip}`;
  }
};

/**
 * A limit per signed-in actor (admin user or API token) instead of per IP, for expensive endpoints (assist
 * calls a paid model). Runs as a preHandler after authentication. In-memory, per process (ADR 0008).
 */
export const createPerActorRateLimit = (
  app: FastifyInstance,
  scope: string,
  { max, timeWindow }: { max: number; timeWindow: number },
): preHandlerAsyncHookHandler => {
  const limiter = app.createRateLimit({
    max,
    timeWindow,
    keyGenerator: (request) => `${scope}:${actorKeyOf(request)}`,
  });
  return async (request, reply) => {
    const result = await limiter(request);
    if (!result.isAllowed && result.isExceeded) {
      void reply.header('retry-after', String(Math.max(1, result.ttlInSeconds)));
      throw new AppError(429, 'RATE_LIMITED', `Too many ${scope} requests; try again in a minute`);
    }
  };
};
