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

const DeliveryStatusSchema = Type.Enum(['pending', 'retrying', 'succeeded', 'dead']);

const WebhookSchema = Type.Object({
  id: UuidSchema,
  name: Type.String(),
  url: Type.String(),
  events: Type.Array(Type.String()),
  enabled: Type.Boolean(),
  allowPrivateNetwork: Type.Boolean(),
  maxAttempts: Type.Integer(),
  lastDelivery: Type.Union([Type.Object({ status: DeliveryStatusSchema, at: DateTimeSchema }), Type.Null()]),
  createdBy: Type.Union([UuidSchema, Type.Null()]),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  version: Type.Integer(),
});

const WebhookWithSecretSchema = Type.Object({ webhook: WebhookSchema, secret: Type.String() });

const DeliverySchema = Type.Object({
  id: UuidSchema,
  webhookId: UuidSchema,
  eventId: Type.Union([UuidSchema, Type.Null()]),
  eventType: Type.String(),
  isTest: Type.Boolean(),
  status: DeliveryStatusSchema,
  attempts: Type.Integer(),
  lastResponseStatus: NullableInteger,
  lastError: NullableString,
  payload: Type.Unknown(),
  attemptLog: Type.Array(Type.Unknown()),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  deliveredAt: NullableDateTimeSchema,
});

const errors = { 400: ErrorResponseSchema, 404: ErrorResponseSchema, 409: ErrorResponseSchema };

const UrlSchema = Type.String({ minLength: 8, maxLength: 2000, pattern: '^https?://' });
const EventsSchema = Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 100 });
const MaxAttemptsSchema = Type.Integer({ minimum: 1, maximum: 20 });

export const listWebhooksSchema = { response: { 200: Type.Array(WebhookSchema) } };
export const listEventTypesSchema = {
  response: {
    200: Type.Object({ items: Type.Array(Type.Object({ type: Type.String(), group: Type.String() })) }),
  },
};
export const getWebhookSchema = { params: IdParamsSchema, response: { 200: WebhookSchema, ...errors } };

export const CreateWebhookBodySchema = Type.Object(
  {
    name: NameSchema,
    url: UrlSchema,
    events: EventsSchema,
    enabled: Type.Optional(Type.Boolean()),
    allowPrivateNetwork: Type.Optional(Type.Boolean()),
    maxAttempts: Type.Optional(MaxAttemptsSchema),
  },
  { additionalProperties: false },
);
export type CreateWebhookBody = Static<typeof CreateWebhookBodySchema>;
export const createWebhookSchema = {
  body: CreateWebhookBodySchema,
  response: { 201: WebhookWithSecretSchema, ...errors },
};

export const UpdateWebhookBodySchema = Type.Object(
  {
    name: Type.Optional(NameSchema),
    url: Type.Optional(UrlSchema),
    events: Type.Optional(EventsSchema),
    enabled: Type.Optional(Type.Boolean()),
    allowPrivateNetwork: Type.Optional(Type.Boolean()),
    maxAttempts: Type.Optional(MaxAttemptsSchema),
    expectedVersion: VersionSchema,
  },
  { additionalProperties: false },
);
export type UpdateWebhookBody = Static<typeof UpdateWebhookBodySchema>;
export const updateWebhookSchema = {
  params: IdParamsSchema,
  body: UpdateWebhookBodySchema,
  response: { 200: WebhookSchema, ...errors },
};

export const deleteWebhookSchema = { params: IdParamsSchema, response: { 204: Type.Null(), ...errors } };
export const rotateSecretSchema = {
  params: IdParamsSchema,
  response: { 200: WebhookWithSecretSchema, ...errors },
};
export const testWebhookSchema = { params: IdParamsSchema, response: { 202: DeliverySchema, ...errors } };

export const ListDeliveriesQuerySchema = Type.Object(
  { ...CursorQueryFields },
  { additionalProperties: false },
);
export type ListDeliveriesQuery = Static<typeof ListDeliveriesQuerySchema>;
export const listDeliveriesSchema = {
  params: IdParamsSchema,
  querystring: ListDeliveriesQuerySchema,
  response: { 200: PageSchema(DeliverySchema), ...errors },
};

export const DeliveryParamsSchema = Type.Object({ id: UuidSchema, deliveryId: UuidSchema });
export type DeliveryParams = Static<typeof DeliveryParamsSchema>;
export const redeliverSchema = { params: DeliveryParamsSchema, response: { 202: DeliverySchema, ...errors } };
