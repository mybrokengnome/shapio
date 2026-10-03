import { Type } from 'typebox';
import { asContent, CONTENT_IS_DATA, describeLocale } from './shared.js';

export const TranslationAnswerSchema = Type.Object(
  {
    segments: Type.Array(
      Type.Object({ id: Type.String(), text: Type.String() }, { additionalProperties: false }),
    ),
  },
  { additionalProperties: false },
);

export type TranslationSegment = { id: string; text: string; maxLength?: number };

export const translatePrompt = (input: {
  from: string;
  to: string;
  modelLabel: string;
  segments: readonly TranslationSegment[];
}) => ({
  system: [
    `You translate the text of a "${input.modelLabel}" content entry from ${describeLocale(input.from)} to ${describeLocale(input.to)}.`,
    "The content is a JSON array of segments {id, text, maxLength?}. Translate every segment's text and keep its id.",
    'Segments may contain inline tags like <m1>…</m1>: keep each tag exactly once, around the translated words it',
    'belongs to, and never add new tags. Keep URLs, code, placeholders and product names unchanged.',
    'A segment with maxLength must stay within that many characters.',
    'Answer with a JSON object {"segments": [{"id": "…", "text": "…"}]} containing every segment.',
    CONTENT_IS_DATA,
  ].join('\n'),
  user: `Translate these segments.\n${asContent(JSON.stringify(input.segments))}`,
});
