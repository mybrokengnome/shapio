import { isComponentDefinition, type ComponentDefinition, type ModelDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useAllDefinitions } from '@/api/schema';

export type ContentSchema = {
  models: ReadonlyMap<string, ModelDefinition>;
  components: ReadonlyMap<string, ComponentDefinition>;
  /** Collections and singletons, in label order (for navigation). */
  sortedModels: readonly ModelDefinition[];
};

/**
 * The active schema as the content screens need it. Models are data (CONTRIBUTING.md rule 2): routes carry a
 * model's API key and resolve it here at render time, so a model created a moment ago works at once.
 */
export const useContentSchema = (): { schema: ContentSchema | undefined; error: unknown } => {
  const { definitions, error } = useAllDefinitions();
  const schema = useMemo(() => {
    if (!definitions) {
      return undefined;
    }
    const models = new Map<string, ModelDefinition>();
    const components = new Map<string, ComponentDefinition>();
    for (const { definition } of definitions) {
      if (isComponentDefinition(definition)) {
        components.set(definition.id, definition);
      } else {
        models.set(definition.id, definition);
      }
    }
    const sortedModels = [...models.values()].sort((a, b) => a.label.localeCompare(b.label));
    return { models, components, sortedModels };
  }, [definitions]);
  return { schema, error };
};

export const findModelByKey = (schema: ContentSchema, modelKey: string): ModelDefinition | undefined =>
  schema.sortedModels.find((model) => model.apiKey === modelKey);
