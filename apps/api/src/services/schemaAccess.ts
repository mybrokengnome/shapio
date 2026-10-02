import type { Database } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import type { PermissionEvaluator, Principal } from '../permissions/types.js';
import type { SchemaContentPorts } from '../schema/planner/contentPorts.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';

/** Everything a schema service call needs: no HTTP objects (CONTRIBUTING.md, code organisation). */
export type SchemaServiceContext = {
  db: Database;
  /** The request's pinned snapshot. */
  snapshot: SchemaSnapshot;
  ports: SchemaContentPorts;
  permissions: PermissionEvaluator;
  actor: Principal;
  requestId?: string;
  ip?: string;
};

/**
 * Authorization inside the services, through the shared evaluator (ADR 0005). Routes also guard with
 * `requireAdmin` / `requireGlobalPermission`; these checks are the per-definition ones and keep the
 * services safe to call from anywhere (CONTRIBUTING.md rule 5).
 */
const forbidden = (message: string) => new AppError(403, 'FORBIDDEN', message);

export const assertCanManage = async (context: SchemaServiceContext, definitionId: string): Promise<void> => {
  const policy = await context.permissions.evaluate(context.actor, {
    action: 'schemaManage',
    modelId: definitionId,
  });
  if (!policy.allowed) {
    throw forbidden('Your role does not allow changing this definition');
  }
};

/** Creating definitions and changing instance-wide schema settings (locales, the read-only lock). */
export const assertCanCreate = async (context: SchemaServiceContext): Promise<void> => {
  if (!(await context.permissions.canPerform(context.actor, 'schema.create'))) {
    throw forbidden('Your role does not allow schema.create');
  }
};

/** Admins see a definition if they may manage it or read its content (editors need the shape to edit). */
export const canReadDefinition = async (
  context: SchemaServiceContext,
  definitionId: string,
): Promise<boolean> => {
  for (const action of ['schemaManage', 'read'] as const) {
    if ((await context.permissions.evaluate(context.actor, { action, modelId: definitionId })).allowed) {
      return true;
    }
  }
  return false;
};

export const filterReadable = async <T extends { definition: { id: string } }>(
  context: SchemaServiceContext,
  items: readonly T[],
): Promise<T[]> => {
  const allowed = await Promise.all(items.map((item) => canReadDefinition(context, item.definition.id)));
  return items.filter((_item, index) => allowed[index]);
};
