import { DATA_TYPES, MEDIA_KINDS } from '@shapio/schema';
import { Type } from 'typebox';

const closed = { additionalProperties: false } as const;

/**
 * The simplified definition shape the model fills in (plan §I): API IDs instead of stable IDs, flat
 * settings. The server turns it into real definitions (services/assist/schemaDraft.ts).
 */
export const DraftFieldSchema = Type.Object(
  {
    apiKey: Type.String(),
    label: Type.String(),
    type: Type.Enum(DATA_TYPES),
    description: Type.Optional(Type.String()),
    required: Type.Optional(Type.Boolean()),
    localized: Type.Optional(Type.Boolean()),
    maxLength: Type.Optional(Type.Integer({ minimum: 1 })),
    values: Type.Optional(Type.Array(Type.Object({ value: Type.String(), label: Type.String() }, closed))),
    multiple: Type.Optional(Type.Boolean()),
    allowedKinds: Type.Optional(Type.Array(Type.Enum(MEDIA_KINDS))),
    target: Type.Optional(Type.String()),
    cardinality: Type.Optional(Type.Enum(['one', 'many'])),
    component: Type.Optional(Type.String()),
    repeatable: Type.Optional(Type.Boolean()),
    components: Type.Optional(Type.Array(Type.String())),
  },
  closed,
);

export const DraftDefinitionSchema = Type.Object(
  {
    kind: Type.Enum(['collection', 'singleton', 'component']),
    apiKey: Type.String(),
    label: Type.String(),
    description: Type.Optional(Type.String()),
    localized: Type.Optional(Type.Boolean()),
    titleField: Type.Optional(Type.String()),
    fields: Type.Array(DraftFieldSchema, { minItems: 1 }),
  },
  closed,
);

export const SchemaDraftAnswerSchema = Type.Object(
  { definitions: Type.Array(DraftDefinitionSchema, { minItems: 1, maxItems: 20 }) },
  closed,
);

export const schemaDraftPrompt = (input: {
  existing: readonly { apiKey: string; kind: string; label: string }[];
  locales: readonly string[];
}) => ({
  system: [
    "You design content models for Shapio, a headless CMS. From the editor's description, propose the content",
    'types (collections: many entries; singletons: one entry) and reusable components they need.',
    'Answer with a JSON object {"definitions": [...]}. Each definition has kind, apiKey, label, optional',
    'description, localized (models only), titleField (the apiKey of the field that names an entry) and fields.',
    `Field types: ${DATA_TYPES.join(', ')}.`,
    'API IDs (apiKey) are camelCase names matching ^[A-Za-z][A-Za-z0-9]*$, singular for models (article, not',
    'articles), unique across all definitions including the existing ones. Labels are short and human.',
    'Field settings are flat: maxLength (string, text, richtext); values [{value, label}] for enum, where value',
    'is a name like draftPost (letters, digits, _); multiple and allowedKinds (image, video, audio, document,',
    'other) for media; target (a collection apiKey) and cardinality (one or many) for relation; component',
    '(a component apiKey) and repeatable for component; components (component apiKeys) for dynamiczone.',
    'Relations must target collections; reference new definitions or existing ones by apiKey. New models must',
    'not reference each other in a cycle. Use richtext for long formatted bodies, text for plain paragraphs,',
    'slug for URL slugs, media for images and files. Mark a field localized only when its model is localized.',
    input.existing.length > 0
      ? `Existing definitions (reuse or reference them, never redefine): ${JSON.stringify(input.existing)}`
      : 'There are no existing definitions.',
    `Configured locales: ${input.locales.join(', ')}.`,
  ].join('\n'),
});
