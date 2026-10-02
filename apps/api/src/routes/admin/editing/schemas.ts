import { Type } from 'typebox';
import { HEALTH_RULES } from '../../../content/health/rules.js';
import { EntryParamsSchema, LocaleCodeSchema, ModelParamsSchema } from '../../schemas/content.js';

/** Request and response schemas of the entry document's endpoints (plan editor-experience §2, §9). */
const closed = { additionalProperties: false } as const;

const HealthRuleSchema = Type.Enum(HEALTH_RULES);
const ParamsSchema = Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Null()]));
const DateTime = Type.String({ format: 'date-time' });

const PreflightCheckSchema = Type.Object({
  rule: Type.Union([HealthRuleSchema, Type.Literal('invalid'), Type.Literal('mediaMissing')]),
  severity: Type.Enum(['error', 'warning']),
  path: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  params: ParamsSchema,
});

export const preflightSchema = {
  params: EntryParamsSchema,
  body: Type.Object(
    { locales: Type.Optional(Type.Array(LocaleCodeSchema, { minItems: 1, maxItems: 100 })) },
    closed,
  ),
  response: {
    200: Type.Object({
      locales: Type.Array(
        Type.Object({
          locale: Type.String(),
          ready: Type.Boolean(),
          checks: Type.Array(PreflightCheckSchema),
        }),
      ),
      entry: Type.Array(PreflightCheckSchema),
    }),
  },
};

const FindingSchema = Type.Object({
  id: Type.String(),
  entryId: Type.String(),
  modelId: Type.String(),
  modelKey: Type.String(),
  entryTitle: Type.Union([Type.String(), Type.Null()]),
  locale: Type.String(),
  rule: HealthRuleSchema,
  subject: Type.String(),
  severity: Type.Enum(['error', 'warning']),
  path: Type.Optional(Type.String()),
  params: ParamsSchema,
  firstSeenAt: DateTime,
  lastSeenAt: DateTime,
});

export const listFindingsSchema = {
  querystring: Type.Object(
    {
      rule: Type.Optional(HealthRuleSchema),
      modelKey: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
      cursor: Type.Optional(Type.String({ maxLength: 500 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    },
    closed,
  ),
  response: {
    200: Type.Object({
      items: Type.Array(FindingSchema),
      nextCursor: Type.Union([Type.String(), Type.Null()]),
    }),
  },
};

export const findingsSummarySchema = {
  response: {
    200: Type.Object({ rules: Type.Array(Type.Object({ rule: HealthRuleSchema, count: Type.Integer() })) }),
  },
};

const PersonSchema = Type.Object({
  userId: Type.String(),
  name: Type.String(),
  locale: Type.Union([Type.String(), Type.Null()]),
  since: DateTime,
  you: Type.Boolean(),
});
const EntryPresenceSchema = Type.Object({ people: Type.Array(PersonSchema) });
const TabIdSchema = Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' });

export const heartbeatSchema = {
  params: EntryParamsSchema,
  body: Type.Object(
    { tabId: TabIdSchema, locale: Type.Optional(Type.Union([LocaleCodeSchema, Type.Null()])) },
    closed,
  ),
  response: { 200: EntryPresenceSchema },
};

export const entryPresenceSchema = { params: EntryParamsSchema, response: { 200: EntryPresenceSchema } };

export const leavePresenceSchema = {
  params: EntryParamsSchema,
  querystring: Type.Object({ tabId: TabIdSchema }, closed),
};

export const modelPresenceSchema = {
  params: ModelParamsSchema,
  response: {
    200: Type.Object({
      entries: Type.Array(Type.Object({ entryId: Type.String(), people: Type.Array(PersonSchema) })),
    }),
  },
};

export const contentCountsSchema = {
  response: {
    200: Type.Object({
      counts: Type.Array(
        Type.Object({ modelId: Type.String(), modelKey: Type.String(), total: Type.Integer() }),
      ),
    }),
  },
};
