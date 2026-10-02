import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';

export type SchemaError = { path: string; message: string };

/**
 * TypeBox errors as (JSON pointer, message) pairs. The `schema is false` echo that accompanies every
 * `additionalProperties` error is dropped, and unknown properties are named in the message.
 */
export const collectSchemaErrors = (schema: TSchema, value: unknown, basePath = ''): SchemaError[] =>
  [...Value.Errors(schema, value)]
    .filter((error) => error.keyword !== 'boolean')
    .map((error) => {
      const extra = (error.params as { additionalProperties?: unknown }).additionalProperties;
      const message =
        error.keyword === 'additionalProperties' && Array.isArray(extra)
          ? `unknown propert${extra.length === 1 ? 'y' : 'ies'}: ${extra.join(', ')}`
          : error.message;
      return { path: `${basePath}${error.instancePath}`, message };
    });
