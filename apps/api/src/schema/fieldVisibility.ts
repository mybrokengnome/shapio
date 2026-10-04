import type { FieldVisibilityLookup, ModelField } from '../permissions/policy.js';
import type { SchemaRegistry } from './registry.js';

/**
 * The permission evaluator's view of field visibility (`public` flags), served from the active schema.
 * Uses the durable version check on every call, so a field made non-public is hidden on every instance at
 * once, whether or not it got the notification. Deprecated fields are reported as non-public: they are
 * hidden from the API unless a role names them explicitly. Components are not delivery models.
 */
export const createSchemaFieldVisibility = (registry: SchemaRegistry): FieldVisibilityLookup => {
  const activeModel = async (modelId: string) => {
    const active = (await registry.getSnapshot()).byId.get(modelId);
    return active && active.definition.kind !== 'component' ? active.definition : undefined;
  };
  return {
    getModelFields: async (modelId) =>
      (await activeModel(modelId))?.fields.map((field): ModelField => ({
        id: field.id,
        public: field.public && !field.deprecated,
      })),
    hasModel: async (modelId) => (await activeModel(modelId)) !== undefined,
    // Components too: managing a site's component is a site's schema permission like its models'.
    getModelSite: async (modelId) => (await registry.getSnapshot()).scopeOf(modelId) ?? null,
  };
};
