import type { FastifyInstance, HTTPMethods, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Every mutating route must say how it is audited (ADR 0005, build plan §3.11):
 * `config: { audit: { action: 'schema.activate' } }`, or `config: { audit: { exempt: '<why>' } }` for
 * routes whose changes are recorded elsewhere (content saves are recorded as revisions).
 */
export type RouteAuditConfig = { action: string } | { exempt: string };

declare module 'fastify' {
  interface FastifyContextConfig {
    audit?: RouteAuditConfig;
  }
}

const MUTATING_METHODS: ReadonlySet<string> = new Set<HTTPMethods>(['POST', 'PUT', 'PATCH', 'DELETE']);

const isMutating = (method: RouteOptions['method']): boolean =>
  (Array.isArray(method) ? method : [method]).some((m) => MUTATING_METHODS.has(String(m).toUpperCase()));

const isValidDeclaration = (audit: unknown): audit is RouteAuditConfig => {
  if (typeof audit !== 'object' || audit === null) {
    return false;
  }
  const declaration = audit as Record<string, unknown>;
  const isNonEmpty = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
  return isNonEmpty(declaration.action) || isNonEmpty(declaration.exempt);
};

export class MissingAuditDeclarationError extends Error {
  constructor(method: RouteOptions['method'], url: string) {
    super(
      `Route ${String(method)} ${url} changes state but declares no audit policy. ` +
        `Add config.audit = { action } or { exempt: '<reason>' }.`,
    );
    this.name = 'MissingAuditDeclarationError';
  }
}

/** Fails startup (route registration throws) when a mutating route has no audit declaration. */
export const auditDeclarationPlugin = fp(
  async (app: FastifyInstance) => {
    app.addHook('onRoute', (route) => {
      if (isMutating(route.method) && !isValidDeclaration(route.config?.audit)) {
        throw new MissingAuditDeclarationError(route.method, route.url);
      }
    });
  },
  { name: 'shapio-audit-declaration' },
);
