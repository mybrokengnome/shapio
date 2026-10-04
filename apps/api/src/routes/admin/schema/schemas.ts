import { Type } from 'typebox';
import {
  ChangeJobSchema,
  DefinitionScopeSchema,
  DefinitionSchema,
  StableIdSchema,
  SyncApplyBodySchema,
} from '../../schemas/schemaRegistry.js';

const SyncItemSchema = Type.Object({
  definitionId: Type.String(),
  apiKey: Type.String(),
  kind: Type.String(),
  decision: Type.Record(Type.String(), Type.Unknown()),
  changes: Type.Array(Type.Record(Type.String(), Type.Unknown())),
  outcome: Type.Optional(Type.String()),
  version: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
  changeId: Type.Optional(Type.String()),
  plan: Type.Optional(Type.Unknown()),
});

export const getSummarySchema = {
  response: {
    200: Type.Object({
      schemaVersion: Type.Integer(),
      defaultLocale: Type.String(),
      definitions: Type.Array(
        Type.Object({
          id: Type.String(),
          kind: Type.String(),
          apiKey: Type.String(),
          label: Type.String(),
          version: Type.Integer(),
          hash: Type.String(),
          /** The key of the site the definition belongs to; null when shared. */
          site: Type.Union([Type.String(), Type.Null()]),
        }),
      ),
    }),
  },
};

const ScopeQuerySchema = Type.Object(
  { scope: Type.Optional(DefinitionScopeSchema) },
  { additionalProperties: false },
);

export const exportSchema = {
  querystring: ScopeQuerySchema,
  response: {
    200: Type.Object({
      schemaVersion: Type.Integer(),
      /** The site whose view this is (shared definitions and its own); null on a network request. */
      site: Type.Union([Type.Object({ id: Type.String(), key: Type.String() }), Type.Null()]),
      definitions: Type.Array(
        Type.Object({
          definition: DefinitionSchema,
          version: Type.Integer(),
          hash: Type.String(),
          /** The key of the site the definition belongs to; null when shared. */
          site: Type.Union([Type.String(), Type.Null()]),
        }),
      ),
    }),
  },
};

export const applySchema = {
  body: SyncApplyBodySchema,
  response: {
    200: Type.Object({
      schemaVersion: Type.Integer(),
      dryRun: Type.Boolean(),
      results: Type.Array(SyncItemSchema),
    }),
  },
};

export const getChangeSchema = {
  params: Type.Object({ changeId: StableIdSchema }),
  response: { 200: ChangeJobSchema },
};

const SettingsSchema = Type.Object({
  readOnly: Type.Boolean(),
  readOnlyReason: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.String({ format: 'date-time' }),
});

export const getSettingsSchema = { response: { 200: SettingsSchema } };

export const updateSettingsSchema = {
  body: Type.Object(
    {
      readOnly: Type.Boolean(),
      readOnlyReason: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
    },
    { additionalProperties: false },
  ),
  response: { 200: SettingsSchema },
};
