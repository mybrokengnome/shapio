import {
  effectiveFormLayout,
  effectiveLayout,
  entryLayoutOf,
  type ComponentDefinition,
  type FieldDefinition,
  type ModelDefinition,
} from '@shapio/schema';

/**
 * The form preview's sections, as the entry editor lays them out. A document (`effectiveLayout`): the entry
 * document (inline title, cover, canvas blocks), then the properties by group. A form
 * (`effectiveFormLayout`): one properties section per form section, no document section. `label`
 * undefined: the document, or fields outside any group.
 */
export type PreviewSection = {
  id: string;
  kind: 'document' | 'properties';
  label: string | undefined;
  fields: FieldDefinition[];
};

export const previewSections = (model: ModelDefinition): PreviewSection[] => {
  if (entryLayoutOf(model) === 'form') {
    return effectiveFormLayout(model).sections.map((section) => ({
      id: `group-${section.id}`,
      kind: 'properties' as const,
      label: section.label,
      fields: section.fields,
    }));
  }
  const layout = effectiveLayout(model);
  const document = [layout.titleInline ? layout.title : undefined, layout.cover, ...layout.canvas].filter(
    (field): field is FieldDefinition => field !== undefined,
  );
  return [
    { id: 'document', kind: 'document' as const, label: undefined, fields: document },
    ...layout.propertyGroups.map((group) => ({
      id: `group-${group.id}`,
      kind: 'properties' as const,
      label: group.label,
      fields: group.fields,
    })),
  ].filter((section) => section.fields.length > 0);
};

/**
 * A component previewed on its own: its fields in a stand-in singleton (not localized, no drafts), so the
 * entry form's field editors can render it.
 */
export const previewHostOf = (component: ComponentDefinition): ModelDefinition => ({
  id: component.id,
  kind: 'singleton',
  apiKey: component.apiKey,
  label: component.label,
  localized: false,
  draftAndPublish: false,
  fields: component.fields,
  display: { ...(component.display.groups ? { groups: component.display.groups } : {}) },
});
