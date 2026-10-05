import type { DocumentLayout, FieldDefinition } from '@shapio/schema';

/**
 * A field "Summarize from body" can fill (mirrors the server, services/assist/summarize.ts): a live string or
 * text field, not the title, of a model whose document has a rich-text canvas field, wherever it is placed.
 */
export const isSummarizable = (layout: DocumentLayout, field: FieldDefinition) =>
  (field.type === 'string' || field.type === 'text') &&
  !field.deprecated &&
  layout.title?.apiKey !== field.apiKey &&
  layout.canvas.some((canvasField) => canvasField.type === 'richtext');
