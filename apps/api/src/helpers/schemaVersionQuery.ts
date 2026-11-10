import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { SCHEMA_VERSION_QUERY_PARAMETER } from '../constants/schemaLens.js';
import { schemaVersionInvalid } from '../schema/errors.js';
import { AppError } from './appError.js';

/**
 * How a request names the schema version it reads in (plan schema-lenses): `?schemaVersion=` or the
 * `Shapio-Schema-Version` header, as `<schemaId>:<version>`. The schema lens plugin and in-process delivery
 * both read it here (this module stays free of the HTTP server, which in-process delivery never loads).
 */

/** Shape only; whether the schema ID is this instance's is the lens service's check. */
const SchemaVersionTokenSchema = Type.String({
  minLength: 3,
  maxLength: 80,
  pattern: '^[0-9A-Za-z-]+:[0-9]{1,10}$',
});

/** One place a schema version may come from, with its name for error messages. */
export type SchemaVersionCandidate = { source: string; value: unknown };

const schemaVersionMismatch = (first: string, second: string) =>
  new AppError(400, 'SCHEMA_VERSION_MISMATCH', `${first} and ${second} name different schema versions`);

/**
 * The schema version the candidates name (TypeBox-checked shape), or null. A repeated parameter, a malformed
 * value, or two sources naming different versions are 400s.
 */
export const pickSchemaVersionToken = (candidates: readonly SchemaVersionCandidate[]): string | null => {
  let picked: { source: string; token: string } | null = null;
  for (const { source, value } of candidates) {
    if (value === undefined || value === '') {
      continue;
    }
    if (Array.isArray(value)) {
      throw new AppError(400, 'INVALID_QUERY', `${source} is given more than once; name one schema version`);
    }
    const token = typeof value === 'string' ? value.trim() : '';
    if (!Value.Check(SchemaVersionTokenSchema, token)) {
      throw schemaVersionInvalid(typeof value === 'string' ? value : JSON.stringify(value));
    }
    if (picked && picked.token !== token) {
      throw schemaVersionMismatch(picked.source, source);
    }
    picked ??= { source, token };
  }
  return picked?.token ?? null;
};

/** The schema version of a raw querystring (without `?`): repeated values stay an array, so they are refused. */
export const rawSchemaVersionCandidate = (rawQuery: string): SchemaVersionCandidate => {
  const values = new URLSearchParams(rawQuery).getAll(SCHEMA_VERSION_QUERY_PARAMETER);
  return { source: `?${SCHEMA_VERSION_QUERY_PARAMETER}=`, value: values.length > 1 ? values : values[0] };
};

/** The request header as a candidate. */
export const schemaVersionHeaderCandidate = (value: unknown): SchemaVersionCandidate => ({
  source: 'the Shapio-Schema-Version header',
  value,
});

const isSchemaVersionSegment = (segment: string): boolean => {
  const key = segment.split('=', 1)[0] ?? '';
  try {
    return decodeURIComponent(key.replace(/\+/g, ' ')) === SCHEMA_VERSION_QUERY_PARAMETER;
  } catch {
    return false;
  }
};

/** A raw querystring without `schemaVersion` (consumed here; the content compiler refuses unknown keys). */
export const withoutSchemaVersionParameter = (rawQuery: string): string =>
  rawQuery
    .split('&')
    .filter((segment) => !isSchemaVersionSegment(segment))
    .join('&');
