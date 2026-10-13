import { API_KEY_PATTERN } from '@shapio/schema';
import { Type } from 'typebox';
import {
  AdminEntrySchema,
  AdminListSchema,
  ContentDataSchema,
  ContentQuerySchema,
  EntryParamsSchema,
  EntryPublicationSchema,
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
const Version = Type.Integer({ minimum: 1 });
const PublishBody = Type.Object(
  {
    locales: LocalesBody.properties.locales,
    /** The draft version the editor saw, when the request publishes one locale (409 when it moved). */
    expectedVersion: Type.Optional(Version),
    /** The draft version per published locale, for a publish of several locales (409 when one moved). */
    expectedVersions: Type.Optional(Type.Record(LocaleCodeSchema, Version)),
  },
  closed,
);
export const publishEntrySchema = { params: EntryParamsSchema, body: PublishBody, response: entry };
export const unpublishEntrySchema = { params: EntryParamsSchema, body: LocalesBody, response: entry };

export const listRevisionsSchema = {
  params: EntryParamsSchema,
  querystring: LocaleQuery,
  response: {
    200: Type.Object({
      items: Type.Array(
        Type.Intersect([
          RevisionSummarySchema,
          Type.Object({ authorName: Type.Union([Type.String(), Type.Null()]) }),
        ]),
      ),
      publications: Type.Array(EntryPublicationSchema),
    }),
  },
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

/** Change kind (plan polymorphic-types, D11): the entry's new kind, within its family. */
export const changeKindSchema = {
  params: EntryParamsSchema,
  querystring: Type.Object(
    { dryRun: Type.Optional(Type.Union([Type.Literal('1'), Type.Literal('true'), Type.Literal('0')])) },
    closed,
  ),
  body: Type.Object(
    {
      /** The API ID of the kind the entry becomes. */
      targetModelKey: Type.String({ pattern: API_KEY_PATTERN.source, maxLength: 64 }),
      /** The draft version the editor saw (of `locale`'s draft); 409 when it moved. */
      expectedVersion: Type.Integer({ minimum: 1 }),
      /** The locale the editor has open; the default locale when absent. */
      locale: Type.Optional(LocaleCodeSchema),
      /** Required (true) on a change that drops fields; optional on a dry run. */
      acknowledgeDroppedFields: Type.Optional(Type.Literal(true)),
    },
    closed,
  ),
  response: {
    200: Type.Object({
      droppedFields: Type.Array(
        Type.Object({ id: Type.String(), apiKey: Type.String(), label: Type.String() }),
      ),
      target: Type.Object({ modelId: Type.String(), modelKey: Type.String(), routeKey: Type.String() }),
      /** The entry as its new kind; absent on a dry run. */
      entry: Type.Optional(AdminEntrySchema),
    }),
  },
};
