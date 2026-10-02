import { Kysely, PostgresDialect } from 'kysely';
import { describe, expect, it } from 'vitest';
import {
  createFieldIndexStatement,
  createFieldStatisticsStatement,
  dropIndexStatement,
  dropStatisticsStatement,
  fieldIndexName,
  fieldValueExpression,
  UnsafeIdentifierError,
  valueCastFor,
} from './expressions.js';

// Compiles SQL without a connection.
const compiler = new Kysely<Record<string, never>>({ dialect: new PostgresDialect({ pool: {} as never }) });
const compile = (node: {
  compile: (db: typeof compiler) => { sql: string; parameters: readonly unknown[] };
}) => node.compile(compiler);

const MODEL = '00000000-0000-4000-8000-000000000001';
const FIELD = '00000000-0000-4000-8000-000000000002';

describe('content expressions', () => {
  it.each([
    ['date', 'text'],
    ['datetime', 'text'],
    ['time', 'text'],
    ['string', 'text'],
    ['enum', 'text'],
    ['number', 'numeric'],
    ['integer', 'numeric'],
    ['decimal', 'numeric'],
    ['biginteger', 'numeric'],
    ['boolean', 'boolean'],
  ] as const)('%s values compare as %s', (type, cast) => {
    expect(valueCastFor(type)).toBe(cast);
  });

  it('embeds the field ID as a literal (never a parameter) so indexes match', () => {
    expect(compile(fieldValueExpression(FIELD, 'datetime'))).toMatchObject({
      sql: `("data" ->> '${FIELD}')`,
      parameters: [],
    });
    expect(compile(fieldValueExpression(FIELD, 'integer')).sql).toBe(`(("data" ->> '${FIELD}')::numeric)`);
  });

  it('refuses anything that is not a stable ID, and non-scalar types', () => {
    expect(() => fieldValueExpression("x') or 1=1 --", 'string')).toThrow(UnsafeIdentifierError);
    expect(() => fieldValueExpression(FIELD, 'json')).toThrow(/no scalar expression/);
    expect(() => createFieldIndexStatement({ modelId: 'model', fieldId: FIELD, type: 'string' })).toThrow(
      UnsafeIdentifierError,
    );
    expect(() => dropIndexStatement('entry_heads_pkey')).toThrow(UnsafeIdentifierError);
  });

  it('names indexes deterministically by model, field and cast', () => {
    const name = fieldIndexName({ modelId: MODEL, fieldId: FIELD, type: 'string' });
    expect(name).toMatch(/^eh_[0-9a-f]{32}$/);
    expect(fieldIndexName({ modelId: MODEL, fieldId: FIELD, type: 'text' })).toBe(name);
    expect(fieldIndexName({ modelId: MODEL, fieldId: FIELD, type: 'integer' })).not.toBe(name);
  });

  it('builds a concurrent partial index over (locale, state, value)', () => {
    const { sql, parameters } = compile(
      createFieldIndexStatement({ modelId: MODEL, fieldId: FIELD, type: 'number' }),
    );
    expect(parameters).toEqual([]);
    expect(sql).toBe(
      `create index concurrently if not exists "${fieldIndexName({ modelId: MODEL, fieldId: FIELD, type: 'number' })}" on "entry_heads" ("locale", "state", (("data" ->> '${FIELD}')::numeric)) where "model_id" = '${MODEL}'`,
    );
  });

  it('omits the locale column for non-localized models, under a different name', () => {
    const spec = { modelId: MODEL, fieldId: FIELD, type: 'number' as const, localized: false };
    expect(fieldIndexName(spec)).not.toBe(fieldIndexName({ ...spec, localized: true }));
    expect(fieldIndexName({ ...spec, localized: true })).toBe(
      fieldIndexName({ modelId: MODEL, fieldId: FIELD, type: 'number' }),
    );
    expect(compile(createFieldIndexStatement(spec)).sql).toBe(
      `create index concurrently if not exists "${fieldIndexName(spec)}" on "entry_heads" ("state", (("data" ->> '${FIELD}')::numeric)) where "model_id" = '${MODEL}'`,
    );
  });

  it('pairs every index with a statistics object on the same expression', () => {
    const spec = { modelId: MODEL, fieldId: FIELD, type: 'integer' as const };
    const statistics = fieldIndexName(spec).replace(/^eh_/, 'es_');
    expect(compile(createFieldStatisticsStatement(spec)).sql).toBe(
      `create statistics if not exists "${statistics}" on (("data" ->> '${FIELD}')::numeric) from "entry_heads"`,
    );
    expect(compile(dropStatisticsStatement(fieldIndexName(spec))).sql).toBe(
      `drop statistics if exists "${statistics}"`,
    );
    expect(() => dropStatisticsStatement('pg_class')).toThrow(UnsafeIdentifierError);
  });
});
