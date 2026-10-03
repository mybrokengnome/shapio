import { createContentHooks, type ContentHooks } from '../content/hooks.js';
import { createPermissionCache } from '../permissions/cache.js';
import { createPermissionEvaluator } from '../permissions/evaluator.js';
import type { PermissionEvaluator, Principal } from '../permissions/types.js';
import { createSchemaFieldVisibility } from '../schema/fieldVisibility.js';
import { createSchemaRegistry, type SchemaRegistry } from '../schema/registry.js';
import type { ContentServiceContext } from '../services/contentAccess.js';
import { getSiteRef } from '../services/sites.js';
import type { PublishingRuntime } from './runtime.js';

/**
 * What publishing job handlers need beyond the runtime: a schema registry (version-checked snapshots), the
 * permission evaluator and the content lifecycle hooks, the same pieces a request gets from the app.
 */
export type PublishingJobEnvironment = {
  runtime: PublishingRuntime;
  registry: SchemaRegistry;
  permissions: PermissionEvaluator;
  hooks: ContentHooks;
};

export const createPublishingJobEnvironment = (
  runtime: PublishingRuntime,
  overrides: { hooks?: ContentHooks; permissions?: PermissionEvaluator } = {},
): PublishingJobEnvironment => {
  const registry = createSchemaRegistry({ db: runtime.db, log: runtime.log });
  return {
    runtime,
    registry,
    permissions:
      overrides.permissions ??
      createPermissionEvaluator({
        grants: createPermissionCache(runtime.db),
        fields: createSchemaFieldVisibility(registry),
      }),
    hooks: overrides.hooks ?? createContentHooks(),
  };
};

/** A content service context for work a job does as `actor`, at the current schema version. */
export const jobContentContext = async (
  environment: PublishingJobEnvironment,
  actor: Principal,
  /** The site the job works on (the scheduled publication's, the change set's). */
  siteId: string,
): Promise<ContentServiceContext> => ({
  db: environment.runtime.db,
  snapshot: await environment.registry.getSnapshot(),
  permissions: environment.permissions,
  actor,
  site: await getSiteRef(siteId, environment.runtime.db),
  hooks: environment.hooks,
});
