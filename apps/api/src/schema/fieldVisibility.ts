import type { FieldVisibilityLookup, ModelField } from '../permissions/policy.js';
import type { KnownVersions, PermissionExecutor } from '../permissions/types.js';
import type { SchemaRegistry } from './registry.js';

/**
 * The permission evaluator's view of field visibility (`public` flags), served from the active schema.
 * Uses the durable version check on every call (or the version the request read once, `versions`), so a
 * field made non-public is hidden on every instance from the next request, whether or not it got the
 * notification. Deprecated fields are reported as non-public: they are hidden from the API unless a role
 * names them explicitly. Components are not delivery models.
 */
export const createSchemaFieldVisibility = (registry: SchemaRegistry): FieldVisibilityLookup => {
  const activeModel = async (
    modelId: string,
    executor: PermissionExecutor | undefined,
    versions: KnownVersions | undefined,
  ) => {
    const active = (await registry.getSnapshot(executor, versions)).byId.get(modelId);
    return active && active.definition.kind !== 'component' ? active.definition : undefined;
  };
  return {
    getModelFields: async (modelId, executor, versions) =>
      (await activeModel(modelId, executor, versions))?.fields.map((field): ModelField => ({
        id: field.id,
        public: field.public && !field.deprecated,
      })),
    hasModel: async (modelId, executor, versions) =>
      (await activeModel(modelId, executor, versions)) !== undefined,
    // Components too: managing a site's component is a site's schema permission like its models'.
    getModelSite: async (modelId, executor, versions) =>
      (await registry.getSnapshot(executor, versions)).scopeOf(modelId) ?? null,
  };
};
