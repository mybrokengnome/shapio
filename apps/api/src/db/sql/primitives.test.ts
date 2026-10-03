import { Kysely, PostgresDialect, sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { isForeignKeyViolation, isUniqueViolation } from './errors.js';
import { emptyJsonArray, jsonAgg, jsonArrayAppend, jsonObject } from './json.js';
import { rowLessThan } from './rows.js';
import { concat, containsInsensitive, pathSegment, startsWith } from './text.js';
import { currentTimestamp, dateParam, greatestOf, timestampCursorText, timestampParam } from './time.js';
import {
  anyOf,
  arrayContains,
  emptyArray,
  latestNonNull,
  nextSequenceValue,
  sortedArrayAgg,
  uuidParam,
} from './values.js';

// Compiles SQL without a connection. Each expectation is the PostgreSQL text the primitive must keep emitting.
const compiler = new Kysely<Record<string, never>>({ dialect: new PostgresDialect({ pool: {} as never }) });
const compile = (node: {
  compile: (db: typeof compiler) => { sql: string; parameters: readonly unknown[] };
}) => node.compile(compiler);

const ID = '00000000-0000-4000-8000-000000000001';

describe('time primitives', () => {
  it('compiles the PostgreSQL forms', () => {
    expect(compile(currentTimestamp()).sql).toBe('now()');
    expect(compile(timestampParam('2026-10-03T12:00:00.123456Z'))).toMatchObject({
      sql: 'cast($1 as timestamptz)',
      parameters: ['2026-10-03T12:00:00.123456Z'],
    });
    expect(compile(dateParam('2026-10-03')).sql).toBe('$1::date');
    expect(compile(timestampCursorText('e.occurred_at')).sql).toBe(
      `to_char("e"."occurred_at" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    );
    expect(compile(greatestOf(sql.ref('a.at'), sql.ref('excluded.at'))).sql).toBe(
      'greatest("a"."at", "excluded"."at")',
    );
  });
});

describe('value primitives', () => {
  it('binds arrays as one parameter', () => {
    expect(compile(anyOf(sql.ref('h.entry_id'), [ID, ID], 'uuid'))).toMatchObject({
      sql: '"h"."entry_id" = any($1::uuid[])',
      parameters: [[ID, ID]],
    });
    expect(compile(anyOf(sql.ref('f'), ['a'], 'text')).sql).toBe('"f" = any($1::text[])');
  });

  it('compiles casts, arrays and sequences', () => {
    expect(compile(uuidParam(ID)).sql).toBe('cast($1 as uuid)');
    expect(compile(arrayContains(sql.ref('trigger_policy'), 'publish')).sql).toBe(
      '$1 = any("trigger_policy")',
    );
    expect(compile(sortedArrayAgg('role_id')).sql).toBe('array_agg("role_id" order by "role_id")');
    expect(compile(sortedArrayAgg('provider', { distinct: true })).sql).toBe(
      'array_agg(distinct "provider" order by "provider")',
    );
    expect(compile(emptyArray('uuid')).sql).toBe(`'{}'::uuid[]`);
    expect(compile(emptyArray('text')).sql).toBe(`'{}'::text[]`);
    expect(compile(latestNonNull('fr.last_snapshot', 'fr.day')).sql.replace(/\s+/g, ' ')).toBe(
      '(array_agg("fr"."last_snapshot" order by "fr"."day" desc) filter (where "fr"."last_snapshot" is not null))[1]',
    );
    expect(compile(nextSequenceValue('entry_heads_change_seq')).sql).toBe(
      `nextval('entry_heads_change_seq')`,
    );
  });
});

describe('json primitives', () => {
  it('builds objects and aggregates with literal keys', () => {
    const object = jsonObject({ roleId: sql.ref('role_id'), siteId: sql.ref('site_id') });
    expect(compile(object).sql).toBe(`jsonb_build_object('roleId', "role_id", 'siteId', "site_id")`);
    expect(compile(jsonObject({ id: sql.ref('r.id') }, 'json')).sql).toBe(
      `json_build_object('id', "r"."id")`,
    );
    expect(compile(jsonAgg(object, [{ column: 'role_id' }, { column: 'site_id', nulls: 'first' }])).sql).toBe(
      `jsonb_agg(jsonb_build_object('roleId', "role_id", 'siteId', "site_id") order by "role_id", "site_id" nulls first)`,
    );
    expect(
      compile(jsonAgg(sql.ref('x'), [{ column: 'at', direction: 'desc', nulls: 'last' }], 'json')).sql,
    ).toBe('json_agg("x" order by "at" desc nulls last)');
    expect(compile(emptyJsonArray()).sql).toBe(`'[]'::jsonb`);
    expect(compile(emptyJsonArray('json')).sql).toBe(`'[]'::json`);
  });

  it('appends one element to a JSON array column', () => {
    expect(compile(jsonArrayAppend('timeline', { a: 1 }))).toMatchObject({
      sql: '"timeline" || $1::jsonb',
      parameters: ['[{"a":1}]'],
    });
  });
});

describe('text primitives', () => {
  it('escapes LIKE wildcards in the bound pattern', () => {
    expect(compile(containsInsensitive(sql.ref('email'), '50%_off\\'))).toMatchObject({
      sql: '"email" ilike $1',
      parameters: ['%50\\%\\_off\\\\%'],
    });
    expect(compile(startsWith(sql.ref('mime_type'), 'image/'))).toMatchObject({
      sql: '"mime_type" like $1',
      parameters: ['image/%'],
    });
  });

  it('concatenates with bound strings and splits paths', () => {
    expect(compile(concat('token:', sql.ref('t.id')))).toMatchObject({
      sql: '$1 || "t"."id"',
      parameters: ['token:'],
    });
    expect(compile(pathSegment(sql.ref('fr.field_path'), 2)).sql).toBe(
      `split_part("fr"."field_path", '.', 2)`,
    );
  });
});

describe('row primitives', () => {
  it('compares row values', () => {
    expect(compile(rowLessThan(['at', 'id'], [timestampParam('t'), uuidParam(ID)])).sql).toBe(
      '("at", "id") < (cast($1 as timestamptz), cast($2 as uuid))',
    );
  });
});

describe('error classification', () => {
  it('recognises constraint violations by SQLSTATE and constraint name', () => {
    const unique = { code: '23505', constraint: 'media_folders_sibling_name_uq' };
    expect(isUniqueViolation(unique)).toBe(true);
    expect(isUniqueViolation(unique, 'media_folders_sibling_name_uq')).toBe(true);
    expect(isUniqueViolation(unique, 'other')).toBe(false);
    expect(isForeignKeyViolation(unique)).toBe(false);
    expect(isForeignKeyViolation({ code: '23503', constraint: 'fk' }, 'fk')).toBe(true);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
  });
});
