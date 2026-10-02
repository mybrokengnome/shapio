import { Type, type Static } from 'typebox';
import {
  DateTimeInputSchema,
  DateTimeSchema,
  IdParamsSchema,
  UuidSchema,
} from '../../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../../schemas/error.js';
import {
  CursorQueryFields,
  LocaleCodeSchema,
  ModelKeySchema,
  NullableDateTimeSchema,
  NullableInteger,
  NullableString,
  PageSchema,
  PublicationActionSchema,
} from '../../../schemas/publishing.js';

const ScheduleStatusSchema = Type.Enum(['scheduled', 'done', 'failed', 'cancelled']);

export const ScheduleSchema = Type.Object({
  id: UuidSchema,
  entryId: UuidSchema,
  modelId: UuidSchema,
  modelKey: NullableString,
  locale: Type.String(),
  action: PublicationActionSchema,
  runAt: DateTimeSchema,
  status: ScheduleStatusSchema,
  error: NullableString,
  snapshot: NullableInteger,
  createdBy: Type.Union([UuidSchema, Type.Null()]),
  createdAt: DateTimeSchema,
  executedAt: NullableDateTimeSchema,
});

export const ListSchedulesQuerySchema = Type.Object(
  { ...CursorQueryFields, status: Type.Optional(ScheduleStatusSchema), entryId: Type.Optional(UuidSchema) },
  { additionalProperties: false },
);
export type ListSchedulesQuery = Static<typeof ListSchedulesQuerySchema>;

export const listSchedulesSchema = {
  querystring: ListSchedulesQuerySchema,
  response: { 200: PageSchema(ScheduleSchema), 400: ErrorResponseSchema, 403: ErrorResponseSchema },
};

export const CreateScheduleBodySchema = Type.Object(
  {
    modelKey: ModelKeySchema,
    entryId: UuidSchema,
    locale: Type.Optional(LocaleCodeSchema),
    action: PublicationActionSchema,
    runAt: DateTimeInputSchema,
  },
  { additionalProperties: false },
);
export type CreateScheduleBody = Static<typeof CreateScheduleBodySchema>;

export const createScheduleSchema = {
  body: CreateScheduleBodySchema,
  response: {
    201: ScheduleSchema,
    400: ErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
  },
};

export const cancelScheduleSchema = {
  params: IdParamsSchema,
  response: { 204: Type.Null(), 404: ErrorResponseSchema, 409: ErrorResponseSchema },
};
