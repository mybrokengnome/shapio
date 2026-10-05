import { SEO_COMPONENT_ID, SEO_EDITOR_ID, type SchemaDefinition } from '@shapio/schema';
import { createField } from './draft';
import { uniqueNewFieldName } from './newField';

/**
 * The SEO field's label as stored in the schema (data, like the component's own label): its API ID derives
 * from it (`seo`, then `seo2`...), and must not change with the admin's language.
 */
const SEO_FIELD_LABEL = 'SEO';

/** Whether the definition already has a field holding the SEO component (by stable ID, never API ID). */
export const hasSeoField = (definition: SchemaDefinition): boolean =>
  definition.fields.some(
    (field) => field.type === 'component' && field.settings.component === SEO_COMPONENT_ID,
  );

/**
 * A single (non-repeatable) field holding the shared SEO component, with the SEO editor, localized when the
 * model is (the person can still change that in the field's properties).
 */
export const createSeoField = (definition: SchemaDefinition) =>
  createField(definition, {
    type: 'component',
    ...uniqueNewFieldName(definition, SEO_FIELD_LABEL),
    settings: { component: SEO_COMPONENT_ID, repeatable: false },
    editorId: SEO_EDITOR_ID,
    localized: definition.kind !== 'component' && definition.localized,
  });
