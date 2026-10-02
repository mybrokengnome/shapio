import { Type } from 'typebox';
import {
  AdminEntrySchema,
  AdminListSchema,
  ContentDataSchema,
  ContentQuerySchema,
  EntryParamsSchema,
  LocaleCodeSchema,
  ModelParamsSchema,
  RevisionParamsSchema,
  RevisionSummarySchema,
} from '../../schemas/content.js';

const closed = { additionalProperties: false } as const;
const entry = { 200: AdminEntrySchema };
const LocaleQuery = Type.Object({ locale: Type.Optional(LocaleCodeSchema) }, closed);
const LocalesBody = Type.Object(
  { locales: Type.Optional(Type.Array(LocaleCodeSchema, { minItems: 1, maxItems: 100 })) },
  closed,
);

export const listEntriesSchema = {
  params: ModelParamsSchema,
  querystring: ContentQuerySchema,
  response: { 200: AdminListSchema },
};

export const createEntrySchema = {
  params: ModelParamsSchema,
  body: Type.Object(
    {
      locale: Type.Optional(LocaleCodeSchema),
      data: Type.Optional(ContentDataSchema),
      /** Publish the new entry's locale in the same transaction. */
      publish: Type.Optional(Type.Boolean()),
    },
    closed,
  ),
  response: { 201: AdminEntrySchema },
};

export const getEntrySchema = { params: EntryParamsSchema, querystring: LocaleQuery, response: entry };

export const updateEntrySchema = {
  params: EntryParamsSchema,
  body: Type.Object(
    {
      locale: Type.Optional(LocaleCodeSchema),
      /** The draft version the editor loaded; null creates the entry's version in this locale. */
      expectedVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      /** Changed fields only: a field set to null is cleared, absent fields are kept. */
      data: Type.Optional(ContentDataSchema),
      autosave: Type.Optional(Type.Boolean()),
    },
    closed,
  ),
  response: entry,
};

export const deleteEntrySchema = { params: EntryParamsSchema };
export const duplicateEntrySchema = { params: EntryParamsSchema, response: { 201: AdminEntrySchema } };
export const publishEntrySchema = { params: EntryParamsSchema, body: LocalesBody, response: entry };

export const listRevisionsSchema = {
  params: EntryParamsSchema,
  querystring: LocaleQuery,
  response: { 200: Type.Object({ items: Type.Array(RevisionSummarySchema) }) },
};

export const getRevisionSchema = {
  params: RevisionParamsSchema,
  response: { 200: Type.Intersect([RevisionSummarySchema, Type.Object({ data: ContentDataSchema })]) },
};

export const restoreRevisionSchema = {
  params: RevisionParamsSchema,
  body: Type.Object({ expectedVersion: Type.Integer({ minimum: 1 }) }, closed),
  response: entry,
};
