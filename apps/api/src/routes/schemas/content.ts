import { API_KEY_PATTERN, LOCALE_CODE_PATTERN, STABLE_ID_PATTERN } from '@shapio/schema';
import { Type } from 'typebox';

/**
 * Route schemas shared by the admin content and delivery routes. Entry bodies are generic (their shape is
 * the model's, known only at runtime), so `data` is an open object here and the content validator does the
 * real checking; responses are projected through masks in content/ (build plan §3.10).
 */
const closed = { additionalProperties: false } as const;

/** Admin content API: the model's API ID (`article`). */
export const ModelKeySchema = Type.String({
  pattern: API_KEY_PATTERN.source,
  maxLength: 64,
  description: 'The model API ID',
});
/**
 * Delivery and preview APIs: the model's route key, the plural API ID of a collection (`articles`) or the API
 * ID of a singleton (`homepage`).
 */
export const RouteKeySchema = Type.String({
  pattern: API_KEY_PATTERN.source,
  maxLength: 64,
  description: 'The plural API ID of a collection, or the API ID of a singleton',
});
export const EntryIdSchema = Type.String({ pattern: STABLE_ID_PATTERN.source });
export const LocaleCodeSchema = Type.String({ pattern: LOCALE_CODE_PATTERN.source, maxLength: 35 });

export const ModelParamsSchema = Type.Object({ modelKey: ModelKeySchema }, closed);
export const EntryParamsSchema = Type.Object({ modelKey: ModelKeySchema, id: EntryIdSchema }, closed);
export const RouteParamsSchema = Type.Object({ modelKey: RouteKeySchema }, closed);
export const RouteEntryParamsSchema = Type.Object({ modelKey: RouteKeySchema, id: EntryIdSchema }, closed);
export const RevisionParamsSchema = Type.Object(
  { modelKey: ModelKeySchema, id: EntryIdSchema, revisionId: EntryIdSchema },
  closed,
);

/** Bracket querystrings (`filters[title][$eq]=…`) are parsed by the content compiler from the raw URL. */
export const ContentQuerySchema = Type.Record(
  Type.String({ maxLength: 300 }),
  Type.Union([Type.String(), Type.Array(Type.String())]),
);

export const ContentDataSchema = Type.Record(Type.String(), Type.Unknown());

const Timestamp = Type.String({ format: 'date-time' });
const EntryStatusSchema = Type.Enum(['draft', 'published', 'modified']);

export const LocaleStateSchema = Type.Object({
  locale: Type.String(),
  version: Type.Integer(),
  status: EntryStatusSchema,
  publishedAt: Type.Union([Timestamp, Type.Null()]),
  sharedOutdated: Type.Boolean(),
});

export const AdminEntrySchema = Type.Object({
  id: Type.String(),
  model: Type.String(),
  locale: Type.String(),
  version: Type.Integer(),
  revisionId: Type.String(),
  status: EntryStatusSchema,
  autosaved: Type.Boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  publishedAt: Type.Union([Timestamp, Type.Null()]),
  data: ContentDataSchema,
  locales: Type.Array(LocaleStateSchema),
  sharedOutdatedLocales: Type.Array(Type.String()),
});

export const PaginationSchema = Type.Object({
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
  pageCount: Type.Integer(),
});

export const AdminListSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      id: Type.String(),
      locale: Type.String(),
      version: Type.Integer(),
      status: EntryStatusSchema,
      autosaved: Type.Boolean(),
      createdAt: Timestamp,
      updatedAt: Timestamp,
      data: ContentDataSchema,
      /** The admin who created the entry; null for tokens, app users and imports. */
      author: Type.Union([Type.Object({ id: Type.String(), name: Type.String() }), Type.Null()]),
      /** Localized models only: every locale the entry has, with its status. */
      locales: Type.Optional(Type.Array(Type.Object({ locale: Type.String(), status: EntryStatusSchema }))),
    }),
  ),
  pagination: PaginationSchema,
  locale: Type.String(),
});

export const RevisionSummarySchema = Type.Object({
  id: Type.String(),
  locale: Type.String(),
  reason: Type.String(),
  schemaRevisionId: Type.String(),
  authorType: Type.String(),
  authorId: Type.Union([Type.String(), Type.Null()]),
  parentRevisionId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Timestamp,
});

/** Delivery bodies are pre-serialized by the controller (ETag over the exact bytes); this documents them. */
export const DeliveryResponseSchema = Type.Object({
  data: Type.Unknown(),
  meta: Type.Record(Type.String(), Type.Unknown()),
});
