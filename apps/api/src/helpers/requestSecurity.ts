import type { FastifyRequest } from 'fastify';

/**
 * Whether the client connected over HTTPS. Direct TLS is detected from the socket; behind a proxy,
 * X-Forwarded-Proto counts only when TRUST_PROXY allows it (Fastify applies that to `protocol`).
 * Use this for every Secure-cookie and HSTS decision.
 */
export const isSecureRequest = (request: FastifyRequest): boolean => request.protocol === 'https';
