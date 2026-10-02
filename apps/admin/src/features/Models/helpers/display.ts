import {
  effectiveLayout,
  isCanvasEligible,
  isCoverEligible,
  validateDefinition,
  type FieldDefinition,
  type ModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';

/**
 * Fields that may label entries (`display.titleFieldId`). Asks the definition validator rather than
 * duplicating its rule: each field is checked alone, as the only field of a minimal definition.
 */
export const titleFieldCandidates = (definition: SchemaDefinition): FieldDefinition[] =>
  definition.fields.filter((field) => {
    const probe = {
      ...definition,
      fields: [field],
      display: { titleFieldId: field.id },
    } as SchemaDefinition;
    return !validateDefinition(probe).some((found) => found.path === '/display/titleFieldId');
  });

/**
 * Appends a new field. The first field that can label entries also becomes the title field while none is
 * set, so entries get a readable title without a trip to the model settings. A title field left unset on
 * purpose next to existing candidates stays unset.
 */
export const withAddedField = (definition: SchemaDefinition, field: FieldDefinition): SchemaDefinition => {
  const next = { ...definition, fields: [...definition.fields, field] };
  const becomesTitle =
    definition.display.titleFieldId === undefined &&
    titleFieldCandidates(definition).length === 0 &&
    titleFieldCandidates(next).some((candidate) => candidate.id === field.id);
  return becomesTitle ? { ...next, display: { ...next.display, titleFieldId: field.id } } : next;
};

export type DocumentLayoutChoices = {
  /** Single image fields that can be the cover. */
  coverOptions: FieldDefinition[];
  /** Canvas-eligible fields: the current canvas in its order, then the others in field order. */
  canvasOptions: FieldDefinition[];
  /** The canvas as the document shows it (configured, or the default). */
  canvas: string[];
  /** Fields the strip can show (the document's properties). */
  stripOptions: FieldDefinition[];
};

/** What the Display section offers for the entry document, from the definition being edited. */
export const documentLayoutChoices = (model: ModelDefinition): DocumentLayoutChoices => {
  const live = model.fields.filter((field) => !field.deprecated);
  const layout = effectiveLayout(model);
  const canvas = layout.canvas.map((field) => field.id);
  const others = live.filter((field) => isCanvasEligible(field) && !canvas.includes(field.id));
  return {
    coverOptions: live.filter(isCoverEligible),
    canvasOptions: [...layout.canvas, ...others],
    canvas,
    stripOptions: layout.properties,
  };
};
