import { STABLE_ID_PATTERN } from '@shapio/schema';
import { Type, type Static } from 'typebox';
import { AI_PROVIDERS } from '../../../config/schema.js';
import {
  ASSIST_WRITE_AFTER_CHARS,
  ASSIST_WRITE_BEFORE_CHARS,
  CONTENT_OPS_RULES,
} from '../../../constants/assist.js';
import { EntryIdSchema, LocaleCodeSchema, ModelKeySchema } from '../../schemas/content.js';
import { DefinitionSchema } from '../../schemas/schemaRegistry.js';

/** Request and response schemas of the assist endpoints (plan agentic-ecosystem §A0, §I). */
const closed = { additionalProperties: false } as const;
const ApiKeySchema = Type.String({ minLength: 1, maxLength: 64 });
const ModelNameSchema = Type.String();

export const assistStatusSchema = {
  response: {
    200: Type.Object({
      enabled: Type.Boolean(),
      provider: Type.Optional(Type.Enum(AI_PROVIDERS)),
      model: Type.Optional(ModelNameSchema),
      usage: Type.Optional(
        Type.Object({
          month: Type.String(),
          runs: Type.Integer(),
          inputTokens: Type.Integer(),
          outputTokens: Type.Integer(),
        }),
      ),
    }),
  },
};

const AltTextBodySchema = Type.Object(
  { assetId: Type.String({ pattern: STABLE_ID_PATTERN.source }), locale: Type.Optional(LocaleCodeSchema) },
  closed,
);
export type AltTextBody = Static<typeof AltTextBodySchema>;
export const altTextSchema = {
  body: AltTextBodySchema,
  response: { 200: Type.Object({ alt: Type.String(), model: ModelNameSchema }) },
};

const TextResultSchema = Type.Object({
  text: Type.String(),
  truncated: Type.Boolean(),
  model: ModelNameSchema,
});

const SummarizeBodySchema = Type.Object(
  {
    modelKey: ModelKeySchema,
    entryId: EntryIdSchema,
    locale: Type.Optional(LocaleCodeSchema),
    fieldApiKey: ApiKeySchema,
  },
  closed,
);
export type SummarizeBody = Static<typeof SummarizeBodySchema>;
export const summarizeSchema = { body: SummarizeBodySchema, response: { 200: TextResultSchema } };

const TranslateBodySchema = Type.Object(
  { modelKey: ModelKeySchema, entryId: EntryIdSchema, from: LocaleCodeSchema, to: LocaleCodeSchema },
  closed,
);
export type TranslateBody = Static<typeof TranslateBodySchema>;
export const translateSchema = {
  body: TranslateBodySchema,
  response: {
    200: Type.Object({
      data: Type.Record(Type.String(), Type.Unknown()),
      issues: Type.Array(Type.Object({ path: Type.String(), code: Type.String(), message: Type.String() })),
      model: ModelNameSchema,
    }),
  },
};

const RewriteBodySchema = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: 20_000 }),
    instruction: Type.String({ minLength: 1, maxLength: 500 }),
    maxLength: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  },
  closed,
);
export type RewriteBody = Static<typeof RewriteBodySchema>;
export const rewriteSchema = { body: RewriteBodySchema, response: { 200: TextResultSchema } };

const InstructionSchema = Type.String({ minLength: 1, maxLength: 500 });
const writeContext = {
  before: Type.String({ maxLength: ASSIST_WRITE_BEFORE_CHARS }),
  after: Type.Optional(Type.String({ maxLength: ASSIST_WRITE_AFTER_CHARS })),
  title: Type.Optional(Type.String({ maxLength: 500 })),
  fieldLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  locale: Type.Optional(LocaleCodeSchema),
};
const WriteBodySchema = Type.Union([
  Type.Object({ kind: Type.Literal('section'), instruction: InstructionSchema, ...writeContext }, closed),
  Type.Object(
    { kind: Type.Literal('continue'), instruction: Type.Optional(InstructionSchema), ...writeContext },
    closed,
  ),
]);
export type WriteBody = Static<typeof WriteBodySchema>;
export const writeSchema = {
  body: WriteBodySchema,
  response: { 200: Type.Object({ markdown: Type.String(), model: ModelNameSchema }) },
};

/** A JSON pointer in API IDs: `/apiKey` or `/component/apiKey`. */
const FieldPathSchema = Type.String({ minLength: 2, maxLength: 200, pattern: '^/' });
const SuggestedValueSchema = Type.Union([Type.String(), Type.Array(Type.String())]);

const SuggestBodySchema = Type.Object(
  {
    modelKey: ModelKeySchema,
    entryId: EntryIdSchema,
    locale: Type.Optional(LocaleCodeSchema),
    fieldPath: FieldPathSchema,
  },
  closed,
);
export type SuggestBody = Static<typeof SuggestBodySchema>;
export const suggestSchema = {
  body: SuggestBodySchema,
  response: {
    200: Type.Object({ value: SuggestedValueSchema, truncated: Type.Boolean(), model: ModelNameSchema }),
  },
};

const SchemaDraftBodySchema = Type.Object(
  { description: Type.String({ minLength: 1, maxLength: 4000 }) },
  closed,
);
export type SchemaDraftBody = Static<typeof SchemaDraftBodySchema>;
export const schemaDraftSchema = {
  body: SchemaDraftBodySchema,
  response: { 200: Type.Object({ definitions: Type.Array(DefinitionSchema), model: ModelNameSchema }) },
};

const ContentOpsRuleSchema = Type.Enum(CONTENT_OPS_RULES);
const ContentOpsBodySchema = Type.Object(
  {
    rule: ContentOpsRuleSchema,
    modelKey: Type.Optional(ModelKeySchema),
    fromLocale: Type.Optional(LocaleCodeSchema),
    fieldPath: Type.Optional(FieldPathSchema),
    locale: Type.Optional(LocaleCodeSchema),
  },
  closed,
);
export type ContentOpsBody = Static<typeof ContentOpsBodySchema>;
export const proposeContentOpsSchema = {
  body: ContentOpsBodySchema,
  response: { 202: Type.Object({ runId: Type.String() }) },
};

const RunParamsSchema = Type.Object({ runId: Type.String({ pattern: STABLE_ID_PATTERN.source }) }, closed);
export type RunParams = Static<typeof RunParamsSchema>;
export const contentOpsRunSchema = {
  params: RunParamsSchema,
  response: {
    200: Type.Object({
      runId: Type.String(),
      rule: ContentOpsRuleSchema,
      status: Type.Enum(['queued', 'running', 'succeeded', 'failed']),
      model: ModelNameSchema,
      createdAt: Type.String({ format: 'date-time' }),
      finishedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
      error: Type.Union([Type.Object({ code: Type.String() }), Type.Null()]),
      result: Type.Unknown(),
    }),
  },
};

const AcceptBodySchema = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        // A string, or a list of strings for a multiple enum. Checked by the service: ajv's type coercion would
        // turn a one-item list into a string under a union.
        { key: Type.String({ minLength: 1, maxLength: 400 }), value: Type.Unknown() },
        closed,
      ),
      { minItems: 1, maxItems: 50 },
    ),
  },
  closed,
);
export type AcceptBody = Static<typeof AcceptBodySchema>;
export const acceptContentOpsSchema = {
  params: RunParamsSchema,
  body: AcceptBodySchema,
  response: {
    200: Type.Object({
      entryId: Type.String(),
      modelKey: Type.String(),
      locale: Type.String(),
      version: Type.Integer(),
      changeSet: Type.Union([
        Type.Object({ added: Type.Literal(true), id: Type.String() }),
        Type.Object({
          added: Type.Literal(false),
          id: Type.Union([Type.String(), Type.Null()]),
          reason: Type.Enum(['unpublishedChanges', 'neverPublished']),
        }),
      ]),
    }),
  },
};
