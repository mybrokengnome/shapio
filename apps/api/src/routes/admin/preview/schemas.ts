import { Type, type Static } from 'typebox';
import { DateTimeSchema, IdParamsSchema, UuidSchema } from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';
import {
  LocaleCodeSchema,
  ModelKeySchema,
  NullableDateTimeSchema,
  NullableString,
} from '../../schemas/publishing.js';

const PreviewTokenSchema = Type.Object({
  id: UuidSchema,
  tokenPrefix: Type.String(),
  modelId: UuidSchema,
  modelKey: NullableString,
  entryId: UuidSchema,
  locale: NullableString,
  connectionId: Type.Union([UuidSchema, Type.Null()]),
  deliveryRoleId: Type.Union([UuidSchema, Type.Null()]),
  createdBy: UuidSchema,
  expiresAt: DateTimeSchema,
  revokedAt: NullableDateTimeSchema,
  lastUsedAt: NullableDateTimeSchema,
  createdAt: DateTimeSchema,
});

const errors = { 400: ErrorResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema };

export const ListPreviewTokensQuerySchema = Type.Object(
  { entryId: Type.Optional(UuidSchema) },
  { additionalProperties: false },
);
export type ListPreviewTokensQuery = Static<typeof ListPreviewTokensQuerySchema>;
export const listPreviewTokensSchema = {
  querystring: ListPreviewTokensQuerySchema,
  response: { 200: Type.Array(PreviewTokenSchema), ...errors },
};

export const CreatePreviewTokenBodySchema = Type.Object(
  {
    modelKey: ModelKeySchema,
    /** A preview token previews one entry of the request's site. */
    entryId: UuidSchema,
    locale: Type.Optional(LocaleCodeSchema),
    ttlSeconds: Type.Optional(Type.Integer({ minimum: 60, maximum: 30 * 24 * 60 * 60 })),
    connectionId: Type.Optional(UuidSchema),
    deliveryRoleId: Type.Optional(UuidSchema),
  },
  { additionalProperties: false },
);
export type CreatePreviewTokenBody = Static<typeof CreatePreviewTokenBodySchema>;
export const createPreviewTokenSchema = {
  body: CreatePreviewTokenBodySchema,
  response: {
    201: Type.Object({ token: Type.String(), previewToken: PreviewTokenSchema, url: NullableString }),
    ...errors,
  },
};

export const revokePreviewTokenSchema = { params: IdParamsSchema, response: { 204: Type.Null(), ...errors } };

export const OpenPreviewBodySchema = Type.Object(
  {
    modelKey: ModelKeySchema,
    entryId: UuidSchema,
    locale: Type.Optional(LocaleCodeSchema),
    connectionId: Type.Optional(UuidSchema),
  },
  { additionalProperties: false },
);
export type OpenPreviewBody = Static<typeof OpenPreviewBodySchema>;
export const openPreviewSchema = {
  body: OpenPreviewBodySchema,
  response: {
    200: Type.Object({
      url: NullableString,
      apiUrl: Type.String(),
      token: Type.String(),
      expiresAt: DateTimeSchema,
      connectionId: Type.Union([UuidSchema, Type.Null()]),
    }),
    ...errors,
  },
};
