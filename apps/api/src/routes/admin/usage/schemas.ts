import { LENS_EFFECTS } from '@shapio/schema';
import { Type, type Static } from 'typebox';
import { DateTimeSchema, UuidSchema } from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';
import { SiteRefSchema } from '../../schemas/publishing.js';

export const FieldUsageQuerySchema = Type.Object(
  {
    modelId: UuidSchema,
    /** Days counted, today included (at most USAGE_RETENTION_DAYS are kept). */
    days: Type.Optional(Type.Integer({ minimum: 1, maximum: 3650 })),
  },
  { additionalProperties: false },
);
export type FieldUsageQuery = Static<typeof FieldUsageQuerySchema>;

const PrincipalKey = Type.String({ description: '`token:<id>`, `app_users` or `anonymous`' });

const FieldPrincipalUsageSchema = Type.Object({
  principalKey: PrincipalKey,
  tokenName: Type.Optional(Type.String()),
  reads: Type.Integer(),
  lastReadAt: DateTimeSchema,
  /** `implicit`: every read asked for the whole model (no field selection). */
  selection: Type.Enum(['explicit', 'implicit']),
});

export const FieldUsageResponseSchema = Type.Object({
  /** USAGE_TRACKING: false means nothing new is being counted. */
  tracking: Type.Boolean(),
  modelId: UuidSchema,
  days: Type.Integer(),
  /** First day counted (UTC, `YYYY-MM-DD`). */
  since: Type.String(),
  fields: Type.Array(
    Type.Object({
      /** A field ID, or `<relation field ID>.<target field ID>` for a populated relation's field. */
      fieldPath: Type.String(),
      /** API keys along the path in the current schema; null when a field no longer exists. */
      apiKeyPath: Type.Union([Type.String(), Type.Null()]),
      reads: Type.Integer(),
      lastReadAt: DateTimeSchema,
      principals: Type.Array(FieldPrincipalUsageSchema),
    }),
  ),
  principals: Type.Array(
    Type.Object({
      principalKey: PrincipalKey,
      tokenName: Type.Optional(Type.String()),
      requests: Type.Integer(),
      lastReadAt: DateTimeSchema,
      /** The snapshot last pinned with `snapshot`; null when it reads live content. */
      lastSnapshot: Type.Union([Type.Integer(), Type.Null()]),
    }),
  ),
});

export const fieldUsageSchema = {
  querystring: FieldUsageQuerySchema,
  response: { 200: FieldUsageResponseSchema, 400: ErrorResponseSchema, 404: ErrorResponseSchema },
};

const PrincipalKeyField = Type.String({ description: '`token:<id>`, `app_users` or `anonymous`' });

export const SchemaVersionsResponseSchema = Type.Object({
  /** USAGE_TRACKING: false means nothing new is being counted. */
  tracking: Type.Boolean(),
  /** Readers on the request's workspace whose latest request named a schema version (plan schema-lenses). */
  principals: Type.Array(
    Type.Object({
      principalKey: PrincipalKeyField,
      tokenName: Type.Optional(Type.String()),
      /** The schema version the reader's latest request named. */
      schemaVersion: Type.Integer(),
      lastReadAt: DateTimeSchema,
    }),
  ),
});

export const schemaVersionsSchema = {
  response: { 200: SchemaVersionsResponseSchema, 400: ErrorResponseSchema },
};

/** What a client naming an older schema version sees (plan schema-lenses; `LensEffect` in @shapio/schema). */
export const LensEffectSchema = Type.Enum([...LENS_EFFECTS]);

const OlderClientDefinitionSchema = Type.Object({
  definitionId: Type.String(),
  /** The definition's API ID in the client's version. */
  apiKey: Type.String(),
  /** `unavailable`: no record of the definition at that version (reads of it answer 409). */
  status: Type.Enum(['available', 'unavailable']),
  /** The worst effect over its fields; null when unavailable. */
  effect: Type.Union([LensEffectSchema, Type.Null()]),
  /** The oldest version reads of it work from, when unavailable. */
  oldestVersion: Type.Union([Type.Integer(), Type.Null()]),
  /** The client's fields that do not keep working unchanged; every other field reads as before. */
  fields: Type.Array(
    Type.Object({
      fieldId: Type.String(),
      /** The field's API ID in the client's version. */
      apiKey: Type.String(),
      effect: LensEffectSchema,
    }),
  ),
});

/**
 * Readers on older schema versions and what they see once a proposed change is live (plan schema-lenses): per
 * version readers are on now, the composite effect from that version to the proposal.
 */
export const OlderClientsSchema = Type.Object({
  /** Most recently used first; at most a fixed number of versions. */
  versions: Type.Array(
    Type.Object({
      schemaVersion: Type.Integer(),
      /** Readers on that version; null when the viewer may not see token names (needs `tokens.manage`). */
      readers: Type.Union([
        Type.Array(
          Type.Object({
            /** The workspace the reads were made on. */
            site: SiteRefSchema,
            principalKey: PrincipalKeyField,
            /** The token's name; null for app users, anonymous readers and deleted tokens. */
            label: Type.Union([Type.String(), Type.Null()]),
            lastReadAt: DateTimeSchema,
          }),
        ),
        Type.Null(),
      ]),
      /** Readers on that version the viewer sees in detail (with or without names). */
      readerCount: Type.Integer(),
      /** Readers on workspaces the viewer does not see in detail; null when it sees every workspace. */
      otherSites: Type.Union([Type.Object({ consumers: Type.Integer() }), Type.Null()]),
      definitions: Type.Array(OlderClientDefinitionSchema),
    }),
  ),
  /** More versions are in use than the review compiled. */
  truncated: Type.Boolean(),
});
