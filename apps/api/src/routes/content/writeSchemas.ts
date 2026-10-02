import { Type } from 'typebox';
import {
  ContentDataSchema,
  RouteEntryParamsSchema,
  LocaleCodeSchema,
  RouteParamsSchema,
} from '../schemas/content.js';
import { ErrorResponseSchema } from '../schemas/error.js';

/** Delivery writes (package I): app users and permitted anonymous callers create and change entries. */

const closed = { additionalProperties: false } as const;

/** Identity and state of the written entry; never its values (writes produce drafts, which delivery never serves). */
const DeliveryWriteResponseSchema = Type.Object({
  data: Type.Object({
    id: Type.String(),
    locale: Type.String(),
    version: Type.Integer(),
    status: Type.Enum(['draft', 'published', 'modified']),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
    publishedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  }),
  meta: Type.Object({}),
});

const errors = {
  400: ErrorResponseSchema,
  401: ErrorResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
};

export const createDeliveryEntrySchema = {
  params: RouteParamsSchema,
  body: Type.Object(
    {
      locale: Type.Optional(LocaleCodeSchema),
      data: Type.Optional(ContentDataSchema),
      /** Publish at once (needs the `publish` permission on the model). */
      publish: Type.Optional(Type.Boolean()),
    },
    closed,
  ),
  response: { 201: DeliveryWriteResponseSchema, ...errors },
};

export const updateDeliveryEntrySchema = {
  params: RouteEntryParamsSchema,
  body: Type.Object(
    {
      locale: Type.Optional(LocaleCodeSchema),
      /** The version the caller last saw (from the create or previous update response); 409 when stale. */
      expectedVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      /** Changed fields only: a field set to null is cleared, absent fields are kept. */
      data: Type.Optional(ContentDataSchema),
    },
    closed,
  ),
  response: { 200: DeliveryWriteResponseSchema, ...errors },
};

export const deleteDeliveryEntrySchema = {
  params: RouteEntryParamsSchema,
  response: { 204: Type.Null(), ...errors },
};
