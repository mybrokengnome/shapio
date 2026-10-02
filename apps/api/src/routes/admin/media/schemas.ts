import { Type, type Static, type TSchema } from 'typebox';
import {
  DateTimeSchema,
  IdParamsSchema,
  NullableDateTimeSchema,
  UuidSchema,
} from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';

const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

const VisibilitySchema = Type.Union([Type.Literal('public'), Type.Literal('private')]);
const FilenameSchema = Type.String({ minLength: 1, maxLength: 255 });
const MimeTypeSchema = Type.String({
  minLength: 3,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9!#$&^_.+*-]+',
});
const FolderNameSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '\\S' });
const FocalPointSchema = Type.Object(
  { x: Type.Number({ minimum: 0, maximum: 1 }), y: Type.Number({ minimum: 0, maximum: 1 }) },
  { additionalProperties: false },
);

const VariantSchema = Type.Object({
  name: Type.String(),
  width: Nullable(Type.Integer()),
  height: Nullable(Type.Integer()),
  format: Type.String(),
  mimeType: Type.String(),
  sizeBytes: Nullable(Type.Integer()),
  status: Type.Union([Type.Literal('pending'), Type.Literal('ready'), Type.Literal('failed')]),
  url: Nullable(Type.String()),
});

export const MediaAssetSchema = Type.Object({
  id: UuidSchema,
  folderId: Nullable(UuidSchema),
  filename: Type.String(),
  mimeType: Type.String(),
  sizeBytes: Type.Integer(),
  width: Nullable(Type.Integer()),
  height: Nullable(Type.Integer()),
  checksumSha256: Nullable(Type.String()),
  alt: Type.String(),
  caption: Type.String(),
  focalPoint: Nullable(FocalPointSchema),
  visibility: VisibilitySchema,
  status: Type.Union([Type.Literal('processing'), Type.Literal('ready'), Type.Literal('failed')]),
  processingError: Nullable(Type.String()),
  storageDriver: Type.Union([Type.Literal('local'), Type.Literal('s3')]),
  url: Type.String(),
  urlExpiresAt: NullableDateTimeSchema,
  variants: Type.Array(VariantSchema),
  createdBy: Nullable(UuidSchema),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  version: Type.Integer(),
});

const MediaFolderSchema = Type.Object({
  id: UuidSchema,
  parentId: Nullable(UuidSchema),
  name: Type.String(),
  assetCount: Type.Integer(),
  version: Type.Integer(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

const UploadGrantSchema = Type.Object({
  grantId: UuidSchema,
  assetId: UuidSchema,
  expiresAt: DateTimeSchema,
  maxSizeBytes: Type.Integer(),
  upload: Type.Object({
    method: Type.Literal('POST'),
    url: Type.String(),
    fields: Type.Record(Type.String(), Type.String()),
    fileField: Type.Literal('file'),
  }),
});

const errors = {
  400: ErrorResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
};

// Folders

export const listFoldersSchema = { response: { 200: Type.Object({ items: Type.Array(MediaFolderSchema) }) } };

export const CreateFolderBodySchema = Type.Object(
  { name: FolderNameSchema, parentId: Type.Optional(Nullable(UuidSchema)) },
  { additionalProperties: false },
);
export type CreateFolderBody = Static<typeof CreateFolderBodySchema>;
export const createFolderSchema = {
  body: CreateFolderBodySchema,
  response: { 201: MediaFolderSchema, ...errors },
};

export const UpdateFolderBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1 }),
    name: Type.Optional(FolderNameSchema),
    parentId: Type.Optional(Nullable(UuidSchema)),
  },
  { additionalProperties: false },
);
export type UpdateFolderBody = Static<typeof UpdateFolderBodySchema>;
export const updateFolderSchema = {
  params: IdParamsSchema,
  body: UpdateFolderBodySchema,
  response: { 200: MediaFolderSchema, ...errors },
};

export const deleteFolderSchema = { params: IdParamsSchema, response: { 204: Type.Null(), ...errors } };

// Assets

export const ListAssetsQuerySchema = Type.Object(
  {
    /** A folder ID, or `root` for assets in no folder. Omit for every folder. */
    folder: Type.Optional(Type.Union([UuidSchema, Type.Literal('root')])),
    /** `image/png` or `image/*`. */
    mimeType: Type.Optional(MimeTypeSchema),
    search: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    cursor: Type.Optional(Type.String({ maxLength: 500 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
);
export type ListAssetsQuery = Static<typeof ListAssetsQuerySchema>;
export const listAssetsSchema = {
  querystring: ListAssetsQuerySchema,
  response: {
    200: Type.Object({ items: Type.Array(MediaAssetSchema), nextCursor: Nullable(Type.String()) }),
    400: ErrorResponseSchema,
  },
};

export const getAssetSchema = { params: IdParamsSchema, response: { 200: MediaAssetSchema, ...errors } };

export const UpdateAssetBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1 }),
    alt: Type.Optional(Type.String({ maxLength: 1000 })),
    caption: Type.Optional(Type.String({ maxLength: 4000 })),
    filename: Type.Optional(FilenameSchema),
    focalPoint: Type.Optional(Nullable(FocalPointSchema)),
    folderId: Type.Optional(Nullable(UuidSchema)),
    visibility: Type.Optional(VisibilitySchema),
  },
  { additionalProperties: false },
);
export type UpdateAssetBody = Static<typeof UpdateAssetBodySchema>;
export const updateAssetSchema = {
  params: IdParamsSchema,
  body: UpdateAssetBodySchema,
  response: { 200: MediaAssetSchema, ...errors },
};

export const DeleteAssetQuerySchema = Type.Object(
  { force: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export const deleteAssetSchema = {
  params: IdParamsSchema,
  querystring: DeleteAssetQuerySchema,
  response: { 204: Type.Null(), ...errors },
};

export const MoveAssetsBodySchema = Type.Object(
  {
    assetIds: Type.Array(UuidSchema, { minItems: 1, maxItems: 500 }),
    folderId: Nullable(UuidSchema),
  },
  { additionalProperties: false },
);
export type MoveAssetsBody = Static<typeof MoveAssetsBodySchema>;
export const moveAssetsSchema = {
  body: MoveAssetsBodySchema,
  response: {
    200: Type.Object({ moved: Type.Array(UuidSchema), skipped: Type.Array(UuidSchema) }),
    ...errors,
  },
};

export const assetUsageSchema = {
  params: IdParamsSchema,
  response: {
    200: Type.Object({
      items: Type.Array(
        Type.Object({
          entryId: UuidSchema,
          modelId: Type.String(),
          fieldId: Type.String(),
          locale: Type.String(),
          state: Type.Union([Type.Literal('draft'), Type.Literal('published')]),
          since: DateTimeSchema,
        }),
      ),
      total: Type.Integer(),
    }),
    ...errors,
  },
};

// Uploads

const uploadErrors = {
  ...errors,
  410: ErrorResponseSchema,
  413: ErrorResponseSchema,
  415: ErrorResponseSchema,
};

export const CreateUploadBodySchema = Type.Object(
  {
    filename: FilenameSchema,
    mimeType: MimeTypeSchema,
    sizeBytes: Type.Integer({ minimum: 1 }),
    folderId: Type.Optional(Nullable(UuidSchema)),
    visibility: Type.Optional(VisibilitySchema),
  },
  { additionalProperties: false },
);
export type CreateUploadBody = Static<typeof CreateUploadBodySchema>;
export const createUploadSchema = {
  body: CreateUploadBodySchema,
  response: { 201: UploadGrantSchema, ...uploadErrors },
};

export const ReplaceUploadBodySchema = Type.Object(
  { filename: FilenameSchema, mimeType: MimeTypeSchema, sizeBytes: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export type ReplaceUploadBody = Static<typeof ReplaceUploadBodySchema>;
export const createReplaceUploadSchema = {
  params: IdParamsSchema,
  body: ReplaceUploadBodySchema,
  response: { 201: UploadGrantSchema, ...uploadErrors },
};

export const confirmUploadSchema = {
  params: IdParamsSchema,
  response: { 200: MediaAssetSchema, 201: MediaAssetSchema, ...uploadErrors },
};
