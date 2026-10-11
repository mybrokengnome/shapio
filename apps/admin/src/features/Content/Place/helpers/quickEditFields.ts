import {
  effectiveFormLayout,
  effectiveLayout,
  entryLayoutOf,
  isCanvasEligible,
  type FieldDefinition,
  type ModelDefinition,
} from '@shapio/schema';

/** Values too large for a row's quick edit; they are edited in the document. */
const DOCUMENT_ONLY_TYPES: ReadonlySet<string> = new Set([
  'richtext',
  'component',
  'dynamiczone',
  'json',
  'code',
]);

/**
 * What a row's quick edit offers, without the values that need the whole entry. A document: the inline title,
 * then the properties strip (the configured one, else every property and every non-block field placed in the
 * document). A form: every live field in form order.
 */
export const quickEditFieldsOf = (model: ModelDefinition): FieldDefinition[] => {
  if (entryLayoutOf(model) === 'form') {
    return effectiveFormLayout(model)
      .sections.flatMap((section) => section.fields)
      .filter((field) => !DOCUMENT_ONLY_TYPES.has(field.type));
  }
  const layout = effectiveLayout(model);
  const title = layout.titleInline && layout.title ? [layout.title] : [];
  const placed = layout.canvas.filter((field) => !isCanvasEligible(field));
  return [...title, ...(layout.strip ?? [...layout.properties, ...placed])].filter(
    (field) => !DOCUMENT_ONLY_TYPES.has(field.type),
  );
};
