import { Type, type Static } from 'typebox';
import { DateTimeSchema, IdParamsSchema, UuidSchema } from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';
import {
  CursorQueryFields,
  NameSchema,
  NullableDateTimeSchema,
  NullableInteger,
  NullableString,
  PageSchema,
  VersionSchema,
} from '../../schemas/publishing.js';

const ProviderSchema = Type.Enum(['generic_webhook', 'cloudflare_pages', 'github']);
const RunStatusSchema = Type.Enum(['queued', 'triggered', 'building', 'unknown', 'deployed', 'failed']);
const TriggerPolicySchema = Type.Enum(['publish', 'change_set', 'schema', 'manual']);
const StringMapSchema = Type.Record(Type.String({ maxLength: 50 }), Type.String({ maxLength: 4000 }));

const RunSchema = Type.Object({
  id: UuidSchema,
  connectionId: UuidSchema,
  connectionName: Type.String(),
  provider: ProviderSchema,
  status: RunStatusSchema,
  trigger: Type.Enum(['publish', 'change_set', 'schema', 'manual', 'retry']),
  snapshot: NullableInteger,
  schemaVersion: NullableInteger,
  retryOf: Type.Union([UuidSchema, Type.Null()]),
  providerRef: NullableString,
  logUrl: NullableString,
  siteUrl: NullableString,
  error: NullableString,
  completionReported: Type.Boolean(),
  timeline: Type.Array(
    Type.Object({
      status: RunStatusSchema,
      at: Type.String(),
      source: Type.Enum(['shapio', 'callback', 'provider']),
      message: NullableString,
    }),
  ),
  triggeredAt: NullableDateTimeSchema,
  finishedAt: NullableDateTimeSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

const ConnectionSchema = Type.Object({
  id: UuidSchema,
  name: Type.String(),
  provider: ProviderSchema,
  settings: Type.Record(Type.String(), Type.String()),
  secrets: Type.Record(Type.String(), Type.Object({ set: Type.Boolean(), envVar: NullableString })),
  previewUrlTemplate: NullableString,
  deliveryRoleId: Type.Union([UuidSchema, Type.Null()]),
  triggerPolicy: Type.Array(TriggerPolicySchema),
  debounceSeconds: Type.Integer(),
  allowPrivateNetwork: Type.Boolean(),
  enabled: Type.Boolean(),
  callbackUrl: Type.String(),
  latestRun: Type.Union([RunSchema, Type.Null()]),
  currentRun: Type.Union([RunSchema, Type.Null()]),
  createdBy: Type.Union([UuidSchema, Type.Null()]),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  version: Type.Integer(),
});

const errors = { 400: ErrorResponseSchema, 404: ErrorResponseSchema, 409: ErrorResponseSchema };

export const listConnectionsSchema = { response: { 200: Type.Array(ConnectionSchema) } };
export const getConnectionSchema = { params: IdParamsSchema, response: { 200: ConnectionSchema, ...errors } };

const connectionFields = {
  name: NameSchema,
  settings: StringMapSchema,
  secrets: StringMapSchema,
  previewUrlTemplate: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  triggerPolicy: Type.Array(TriggerPolicySchema, { maxItems: 4 }),
  debounceSeconds: Type.Optional(Type.Integer({ minimum: 0, maximum: 3600 })),
  allowPrivateNetwork: Type.Optional(Type.Boolean()),
  enabled: Type.Optional(Type.Boolean()),
  deliveryRoleId: Type.Optional(Type.Union([UuidSchema, Type.Null()])),
};

export const CreateConnectionBodySchema = Type.Object(
  { ...connectionFields, provider: ProviderSchema },
  { additionalProperties: false },
);
export type CreateConnectionBody = Static<typeof CreateConnectionBodySchema>;
export const createConnectionSchema = {
  body: CreateConnectionBodySchema,
  response: {
    201: Type.Object({
      connection: ConnectionSchema,
      generatedSecrets: Type.Record(Type.String(), Type.String()),
    }),
    ...errors,
  },
};

export const UpdateConnectionBodySchema = Type.Object(
  {
    name: Type.Optional(connectionFields.name),
    settings: Type.Optional(connectionFields.settings),
    secrets: Type.Optional(connectionFields.secrets),
    previewUrlTemplate: connectionFields.previewUrlTemplate,
    triggerPolicy: Type.Optional(connectionFields.triggerPolicy),
    debounceSeconds: connectionFields.debounceSeconds,
    allowPrivateNetwork: connectionFields.allowPrivateNetwork,
    enabled: connectionFields.enabled,
    deliveryRoleId: connectionFields.deliveryRoleId,
    expectedVersion: VersionSchema,
  },
  { additionalProperties: false },
);
export type UpdateConnectionBody = Static<typeof UpdateConnectionBodySchema>;
export const updateConnectionSchema = {
  params: IdParamsSchema,
  body: UpdateConnectionBodySchema,
  response: { 200: ConnectionSchema, ...errors },
};

export const deleteConnectionSchema = { params: IdParamsSchema, response: { 204: Type.Null(), ...errors } };

export const testConnectionSchema = {
  params: IdParamsSchema,
  response: {
    200: Type.Object({
      ok: Type.Boolean(),
      checks: Type.Array(Type.Object({ name: Type.String(), ok: Type.Boolean(), message: Type.String() })),
    }),
    ...errors,
  },
};

export const triggerRunSchema = { params: IdParamsSchema, response: { 201: RunSchema, ...errors } };

export const ListRunsQuerySchema = Type.Object(
  { ...CursorQueryFields, connectionId: Type.Optional(UuidSchema) },
  { additionalProperties: false },
);
export type ListRunsQuery = Static<typeof ListRunsQuerySchema>;
export const listRunsSchema = {
  querystring: ListRunsQuerySchema,
  response: { 200: PageSchema(RunSchema), ...errors },
};
export const getRunSchema = { params: IdParamsSchema, response: { 200: RunSchema, ...errors } };
export const retryRunSchema = { params: IdParamsSchema, response: { 201: RunSchema, ...errors } };
