import { Type } from 'typebox';
import { ErrorResponseSchema } from '../schemas/error.js';

const CheckStatusSchema = Type.Union([Type.Literal('ok'), Type.Literal('failing')]);

export const getHealthSchema = {
  response: { 200: Type.Object({ status: Type.Literal('ok') }) },
};

export const getReadySchema = {
  response: {
    200: Type.Object({
      status: Type.Literal('ready'),
      checks: Type.Object({ database: CheckStatusSchema, migrations: CheckStatusSchema }),
    }),
    503: ErrorResponseSchema,
  },
};

export const getVersionSchema = {
  response: {
    200: Type.Object({ name: Type.Literal('shapio'), version: Type.String(), node: Type.String() }),
  },
};
