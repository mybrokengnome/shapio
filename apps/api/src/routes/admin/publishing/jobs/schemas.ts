import { Type, type Static } from 'typebox';
import { DateTimeSchema, IdParamsSchema, UuidSchema } from '../../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../../schemas/error.js';
import {
  CursorQueryFields,
  NullableDateTimeSchema,
  NullableString,
  PageSchema,
} from '../../../schemas/publishing.js';

const JobStatusSchema = Type.Enum(['pending', 'running', 'succeeded', 'dead']);

const JobSchema = Type.Object({
  id: UuidSchema,
  type: Type.String(),
  status: JobStatusSchema,
  attempts: Type.Integer(),
  maxAttempts: Type.Integer(),
  runAt: DateTimeSchema,
  idempotencyKey: NullableString,
  lockedBy: NullableString,
  lockedUntil: NullableDateTimeSchema,
  payload: Type.Unknown(),
  result: Type.Unknown(),
  progress: Type.Unknown(),
  lastError: NullableString,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  finishedAt: NullableDateTimeSchema,
});

export const ListJobsQuerySchema = Type.Object(
  {
    ...CursorQueryFields,
    status: Type.Optional(JobStatusSchema),
    type: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type ListJobsQuery = Static<typeof ListJobsQuerySchema>;

export const listJobsSchema = {
  querystring: ListJobsQuerySchema,
  response: { 200: PageSchema(JobSchema), 400: ErrorResponseSchema },
};

export const jobsSummarySchema = {
  response: {
    200: Type.Object({
      counts: Type.Object({
        pending: Type.Integer(),
        running: Type.Integer(),
        succeeded: Type.Integer(),
        dead: Type.Integer(),
      }),
      types: Type.Array(Type.String()),
    }),
  },
};

export const getJobSchema = {
  params: IdParamsSchema,
  response: { 200: JobSchema, 404: ErrorResponseSchema },
};

export const retryJobSchema = {
  params: IdParamsSchema,
  response: { 200: JobSchema, 404: ErrorResponseSchema, 409: ErrorResponseSchema },
};
