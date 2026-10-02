import { Type, type Static } from 'typebox';
import { DateTimeSchema, UuidSchema } from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';

const BooleanFlag = Type.Boolean({ default: false });

export const ExportQuerySchema = Type.Object(
  {
    /** Only the revisions entry heads point at, not the whole history. */
    headsOnly: BooleanFlag,
    /** App users with their password hashes and OAuth links (never plain passwords). */
    includeUsers: BooleanFlag,
  },
  { additionalProperties: false },
);
export type ExportQuery = Static<typeof ExportQuerySchema>;

export const ImportQuerySchema = Type.Object(
  { dryRun: BooleanFlag, prune: BooleanFlag },
  { additionalProperties: false },
);
export type ImportQuery = Static<typeof ImportQuerySchema>;

/** The plan's parts are documented in content/transfer/plan.ts (`ImportDiff`). */
const DiffSchema = Type.Object({
  bundle: Type.Unknown(),
  locales: Type.Unknown(),
  schema: Type.Unknown(),
  appRoles: Type.Unknown(),
  deliveryRoles: Type.Unknown(),
  appUsers: Type.Unknown(),
  webhooks: Type.Unknown(),
  deploymentConnections: Type.Unknown(),
  media: Type.Unknown(),
  entries: Type.Unknown(),
  prune: Type.Unknown(),
  conflicts: Type.Integer(),
});

export const exportSchema = {
  querystring: ExportQuerySchema,
  response: { 403: ErrorResponseSchema },
};

export const importSchema = {
  querystring: ImportQuerySchema,
  response: {
    200: Type.Object({ dryRun: Type.Literal(true), diff: DiffSchema }),
    202: Type.Object({
      dryRun: Type.Literal(false),
      importId: UuidSchema,
      diff: DiffSchema,
      webhookSecrets: Type.Array(Type.Object({ id: UuidSchema, name: Type.String(), secret: Type.String() })),
    }),
    400: ErrorResponseSchema,
    403: ErrorResponseSchema,
    409: ErrorResponseSchema,
    413: ErrorResponseSchema,
    415: ErrorResponseSchema,
  },
};

export const importStatusSchema = {
  params: Type.Object({ id: UuidSchema }),
  response: {
    200: Type.Object({
      id: UuidSchema,
      status: Type.String(),
      attempts: Type.Integer(),
      lastError: Type.Union([Type.String(), Type.Null()]),
      progress: Type.Unknown(),
      createdAt: DateTimeSchema,
      finishedAt: Type.Union([DateTimeSchema, Type.Null()]),
    }),
    404: ErrorResponseSchema,
  },
};

const AssetParamsSchema = Type.Object({ assetId: UuidSchema });

export const getMediaFileSchema = {
  params: AssetParamsSchema,
  response: { 404: ErrorResponseSchema },
};

export const MediaUploadQuerySchema = Type.Object(
  {
    storageKey: Type.String({ minLength: 1, maxLength: 1024 }),
    sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
    sizeBytes: Type.Integer({ minimum: 0 }),
    mimeType: Type.String({ minLength: 3, maxLength: 255 }),
  },
  { additionalProperties: false },
);
export type MediaUploadQuery = Static<typeof MediaUploadQuerySchema>;

export const putMediaFileSchema = {
  params: AssetParamsSchema,
  querystring: MediaUploadQuerySchema,
  response: {
    200: Type.Object({ stored: Type.Boolean() }),
    400: ErrorResponseSchema,
    409: ErrorResponseSchema,
    413: ErrorResponseSchema,
    422: ErrorResponseSchema,
  },
};
