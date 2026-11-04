import { Type } from 'typebox';
import { asContent, CONTENT_IS_DATA, describeLocale } from './shared.js';

const closed = { additionalProperties: false } as const;

/** The JSON answer for an enum field: one allowed value, or several when the field allows several. */
export const enumAnswerSchema = (values: readonly string[], multiple: boolean) =>
  multiple
    ? Type.Object({ values: Type.Array(Type.Enum([...values]), { minItems: 1 }) }, closed)
    : Type.Object({ value: Type.Enum([...values]) }, closed);

export type SuggestPromptInput = {
  modelLabel: string;
  /** The field's label, with its component's ("SEO › Title") when it is a component's field. */
  fieldLabel: string;
  fieldDescription: string | undefined;
  isTitle: boolean;
  locale: string;
  source: string;
} & (
  | {
      type: 'string' | 'text';
      maxLength: number | undefined;
      minLength: number | undefined;
      softMaxLength: number | undefined;
      pattern: string | undefined;
      shorter: boolean;
    }
  | { type: 'enum'; options: readonly { value: string; label: string }[]; multiple: boolean }
);

const lengthRules = (input: Extract<SuggestPromptInput, { type: 'string' | 'text' }>): string[] => {
  const shorter = input.shorter ? ' — the previous attempt was too long, so be clearly shorter' : '';
  const rules: string[] = [];
  if (input.maxLength) {
    rules.push(`The value must be at most ${input.maxLength} characters${shorter}.`);
  } else if (input.softMaxLength) {
    rules.push(
      `Aim for at most ${input.softMaxLength} characters: search results cut longer ones${shorter}.`,
    );
  }
  if (input.minLength) {
    rules.push(`It must be at least ${input.minLength} characters.`);
  }
  if (input.pattern) {
    rules.push(`It must match the regular expression ${input.pattern}.`);
  }
  return rules;
};

const shapeRules = (input: SuggestPromptInput): string[] => {
  if (input.type === 'enum') {
    return [
      `Allowed values (value: label): ${input.options.map((option) => `${option.value}: ${option.label}`).join('; ')}.`,
      input.multiple
        ? 'Choose every value that fits. Answer with a JSON object {"values": ["…"]} using values from the list.'
        : 'Choose the one value that fits best. Answer with a JSON object {"value": "…"} using a value from the list.',
    ];
  }
  return [
    ...(input.isTitle ? ["It is the entry's title: short, specific and without a trailing period."] : []),
    input.type === 'string' ? 'The value is one line of plain text.' : 'The value is plain text.',
    ...lengthRules(input),
    `Write in ${describeLocale(input.locale)}. Answer with the value only: no Markdown, no quotes, no preamble.`,
  ];
};

/**
 * A value for one field of an entry, made from the rest of the entry (plan write-and-fill §2). Field settings go
 * in the system prompt; the entry's text is content (data). The opening words are matched by the admin's e2e
 * fake model; fill runs use the same prompt.
 */
export const suggestPrompt = (input: SuggestPromptInput) => ({
  system: [
    `You suggest a value for a field of a "${input.modelLabel}" content entry: the "${input.fieldLabel}" field.`,
    ...(input.fieldDescription ? [`The field's help text: ${input.fieldDescription}`] : []),
    'Base it on the rest of the entry. Do not invent facts the entry does not support.',
    ...shapeRules(input),
    CONTENT_IS_DATA,
  ].join('\n'),
  user: `Suggest the value from this entry.\n${asContent(input.source)}`,
});
