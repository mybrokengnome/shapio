import { isInterfaceDefinition } from '@shapio/schema';
import type { Database } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import type { PermissionEvaluator, PermissionExecutor, Principal } from '../permissions/types.js';
import type { SchemaContentPorts } from '../schema/planner/contentPorts.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';

/** Everything a schema service call needs: no HTTP objects (CONTRIBUTING.md, code organization). */
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

/** `executor` (here and below): the caller's open transaction, when there is one. */
export const assertCanManage = async (
  context: SchemaServiceContext,
  definitionId: string,
  executor?: PermissionExecutor,
): Promise<void> => {
  const policy = await context.permissions.evaluate(
    context.actor,
    { action: 'schemaManage', modelId: definitionId },
    executor,
  );
  if (!policy.allowed) {
    throw forbidden('Your role does not allow changing this definition');
  }
};

/**
 * Creating a definition in `scope` (plan site-schema, rule 4): a site's own definition needs `schema.create`
 * from the roles that apply on that site; a shared one (null) from roles on every site. The scope of a
 * site definition is always the request's site: a view never creates on another site.
 */
export const assertCanCreate = async (
  context: SchemaServiceContext,
  scope: string | null,
  executor?: PermissionExecutor,
): Promise<void> => {
  if (scope !== null && scope !== context.snapshot.siteId) {
    throw forbidden('A definition can only be created on the site of the request');
  }
  const allowed =
    scope === null
      ? await context.permissions.canPerform(context.actor, 'schema.create', executor)
      : await context.permissions.canPerformOnSite(context.actor, 'schema.create', scope, executor);
  if (!allowed) {
    throw forbidden(
      scope === null
        ? 'Sharing a definition with all sites needs schema.create on every site'
        : 'Your role does not allow schema.create',
    );
  }
};

/** Instance-wide schema settings (locales, the read-only lock): `schema.create` from roles on every site. */
export const assertCanChangeNetworkSchema = async (context: SchemaServiceContext): Promise<void> => {
  if (!(await context.permissions.canPerform(context.actor, 'schema.create'))) {
    throw forbidden('Your role does not allow schema.create');
  }
};

/** Whether the caller may manage the definition or read its content, by its own grants. */
const mayReadOwn = async (context: SchemaServiceContext, definitionId: string): Promise<boolean> => {
  for (const action of ['schemaManage', 'read'] as const) {
    if ((await context.permissions.evaluate(context.actor, { action, modelId: definitionId })).allowed) {
      return true;
    }
  }
  return false;
};

/**
 * Whether the caller may read some definition of the view that is not an interface (an interface's own
 * readability, plan interfaces Q-a). Stops at the first one.
 */
const mayReadSomeDefinition = async (context: SchemaServiceContext): Promise<boolean> => {
  for (const active of context.snapshot.definitions) {
    if (!isInterfaceDefinition(active.definition) && (await mayReadOwn(context, active.definition.id))) {
      return true;
    }
  }
  return false;
};

const isInterfaceId = (context: SchemaServiceContext, definitionId: string): boolean => {
  const definition = context.snapshot.byId.get(definitionId)?.definition;
  return definition !== undefined && isInterfaceDefinition(definition);
};

/**
 * Admins see a definition if they may manage it or read its content (editors need the shape to edit). An
 * interface holds no content and names only fields, so anyone who may read some definition may read every
 * interface (an editor filling a relation to one needs its name); managing one needs a wildcard
 * `schemaManage`, as for components (plan interfaces, Q-a).
 */
export const canReadDefinition = async (
  context: SchemaServiceContext,
  definitionId: string,
): Promise<boolean> =>
  (await mayReadOwn(context, definitionId)) ||
  (isInterfaceId(context, definitionId) && (await mayReadSomeDefinition(context)));

export const filterReadable = async <T extends { definition: { id: string } }>(
  context: SchemaServiceContext,
  items: readonly T[],
): Promise<T[]> => {
  let readsSome: Promise<boolean> | undefined;
  const allowed = await Promise.all(
    items.map(async (item) => {
      if (await mayReadOwn(context, item.definition.id)) {
        return true;
      }
      if (!isInterfaceId(context, item.definition.id)) {
        return false;
      }
      readsSome ??= mayReadSomeDefinition(context);
      return readsSome;
    }),
  );
  return items.filter((_item, index) => allowed[index]);
};
