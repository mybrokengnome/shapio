import {
  isComponentDefinition,
  type ComponentDefinition,
  type DefinitionIndex,
  type ResolvedModelDefinition,
} from '@shapio/schema';
import { useMemo } from 'react';
import { useDefinitions } from '@/api/schema';
import { useResolvedDefinitions } from '@/hooks/useResolvedDefinitions';

export type ContentSchema = {
  /** Collections and singletons by stable ID, with their effective fields (inherited ones first). */
  models: ReadonlyMap<string, ResolvedModelDefinition>;
  components: ReadonlyMap<string, ComponentDefinition>;
  /** Collections and singletons, in label order (for navigation). */
  sortedModels: readonly ResolvedModelDefinition[];
  /** Families: a type's ancestors, children and descendants (plan polymorphic-types). */
  index: DefinitionIndex;
};

/**
 * The active schema as the content screens need it. Models are data (CONTRIBUTING.md rule 2): routes carry a
 * model's API key and resolve it here at render time, so a model created a moment ago works at once. A type
 * that extends another carries its effective fields, so every content screen sees inherited fields.
 */
export const useContentSchema = (): { schema: ContentSchema | undefined; error: unknown } => {
  const { resolved, error: modelsError } = useResolvedDefinitions();
  const componentList = useDefinitions('component');
  const schema = useMemo(() => {
    if (!resolved || !componentList.data) {
      return undefined;
    }
    const components = new Map<string, ComponentDefinition>();
    for (const { definition } of componentList.data) {
      if (isComponentDefinition(definition)) {
        components.set(definition.id, definition);
      }
    }
    const sortedModels = [...resolved.byId.values()].sort((a, b) => a.label.localeCompare(b.label));
    return { models: resolved.byId, components, sortedModels, index: resolved.index };
  }, [resolved, componentList.data]);
  return { schema, error: modelsError ?? componentList.error };
};

export const findModelByKey = (
  schema: ContentSchema,
  modelKey: string,
): ResolvedModelDefinition | undefined => schema.sortedModels.find((model) => model.apiKey === modelKey);
