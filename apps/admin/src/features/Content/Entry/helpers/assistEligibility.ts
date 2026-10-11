import {
  effectiveTitleField,
  richTextBodyOf,
  type FieldDefinition,
  type ModelDefinition,
} from '@shapio/schema';

/**
 * A field "Summarize from body" can fill (the server's rule, services/assist/summarize.ts): a live string or
 * text field, not the title, of a model with a rich-text body (`richTextBodyOf`: the document's rich-text
 * canvas fields, or every rich-text field of a form).
 */
export const isSummarizable = (model: ModelDefinition, field: FieldDefinition) =>
  (field.type === 'string' || field.type === 'text') &&
  !field.deprecated &&
  effectiveTitleField(model)?.apiKey !== field.apiKey &&
  richTextBodyOf(model).length > 0;
