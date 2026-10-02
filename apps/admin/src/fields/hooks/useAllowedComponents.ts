import type { ComponentDefinition, FieldDefinition } from '@shapio/schema';
import { useFieldsEnvironment } from '../form/context';

/** Components that can be stored in a field: a zone's allowed ones, a component field's own (else none). */
export const allowedComponentsOf = (
  definition: FieldDefinition,
  components: ReadonlyMap<string, ComponentDefinition>,
): ComponentDefinition[] => {
  const ids =
    definition.type === 'dynamiczone'
      ? definition.settings.components
      : definition.type === 'component'
        ? [definition.settings.component]
        : [];
  return ids
    .map((id) => components.get(id))
    .filter((component): component is ComponentDefinition => component !== undefined);
};

export const useAllowedComponents = (definition: FieldDefinition) =>
  allowedComponentsOf(definition, useFieldsEnvironment().components);
