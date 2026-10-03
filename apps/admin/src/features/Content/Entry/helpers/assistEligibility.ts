import type { DocumentLayout, FieldDefinition } from '@shapio/schema';

/**
 * A property "Summarize from body" can fill (mirrors the server, services/assist/summarize.ts): a string or
 * text property, not the title, of a model whose document has a rich-text canvas field.
 */
export const isSummarizable = (layout: DocumentLayout, field: FieldDefinition) =>
  (field.type === 'string' || field.type === 'text') &&
  layout.title?.apiKey !== field.apiKey &&
  layout.properties.some((property) => property.apiKey === field.apiKey) &&
  layout.canvas.some((canvasField) => canvasField.type === 'richtext');
