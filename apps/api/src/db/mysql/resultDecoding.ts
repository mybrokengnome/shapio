import type { UnknownRow } from 'kysely';
import type { ResultType } from '../sql/typed.js';

/** A marked column's value as PostgreSQL's driver would give it (`db/sql/typed.ts`). */
const DECODERS: Readonly<Record<ResultType, (value: unknown) => unknown>> = {
  boolean: (value) => Number(value) !== 0,
  bigint: (value) => String(value),
  json: (value) => (typeof value === 'string' ? (JSON.parse(value) as unknown) : value),
  timestamp: (value) => (value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`)),
  text: (value) => String(value),
};

export const decodeRow = (row: UnknownRow, markers: ReadonlyMap<string, ResultType>): UnknownRow => {
  const decoded: Record<string, unknown> = { ...row };
  for (const [column, type] of markers) {
    const value = decoded[column];
    if (value !== null && value !== undefined) {
      decoded[column] = DECODERS[type](value);
    }
  }
  return decoded;
};
