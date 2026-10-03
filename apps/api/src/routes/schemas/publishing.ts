import { Type, type TSchema } from 'typebox';
import { NullableDateTimeSchema, UuidSchema } from './adminIdentity.js';

/** Schemas shared by the publishing routes (jobs, schedules, change sets, webhooks, deployments, preview). */

export const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
export const NullableString = Nullable(Type.String());
export const NullableInteger = Nullable(Type.Integer());
export { NullableDateTimeSchema };

export const CursorQueryFields = {
  cursor: Type.Optional(Type.String({ maxLength: 500 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
};

export const PageSchema = <T extends TSchema>(item: T) =>
  Type.Object({ items: Type.Array(item), nextCursor: NullableString });

/** Model API keys are GraphQL names (CONTRIBUTING.md rule 4). */
export const ModelKeySchema = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: '^[_A-Za-z][_0-9A-Za-z]*$',
});
export const LocaleCodeSchema = Type.String({ minLength: 1, maxLength: 35 });
export const PublicationActionSchema = Type.Union([Type.Literal('publish'), Type.Literal('unpublish')]);
export const NameSchema = Type.String({ minLength: 1, maxLength: 200 });
export const VersionSchema = Type.Integer({ minimum: 1 });

/** The site a publishing record belongs to (sites plan §H): its ID and its key. */
export const SiteRefSchema = Type.Object({ id: UuidSchema, key: Type.String() });
