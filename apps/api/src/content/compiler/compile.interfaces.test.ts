import type { FieldDefinition } from '@shapio/schema';
import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect, type RawBuilder } from 'kysely';
import { describe, expect, it } from 'vitest';
import { FIXTURE_SITE_ID as SITE } from '../../../test/helpers/compilerFixture.js';
import { compileHeadQuery, compileSearch, type HeadQueryMember, type HeadQueryPlan } from './compile.js';
import { mysqlContentDialect } from './dialect/mysql.js';
import { postgresContentDialect } from './dialect/postgres.js';
import { sqliteContentDialect } from './dialect/sqlite.js';
import type { ContentSqlDialect } from './dialect/types.js';
import { compileOrderBy } from './sort.js';

/**
 * Interface reads (plan interfaces, decision 2): members hold the contract's fields under their own field IDs
 * and may differ in localization, so each arm carries its own sort expressions, search, locale scope and
 * whether its conditions need the entries join.
 */
const POST = '0b5d6f3e-2d55-4f6c-9b1a-5d2c8e9f1a11';
const ABOUT = '0b5d6f3e-2d55-4f6c-9b1a-5d2c8e9f1a12';
const POST_TITLE = '0b5d6f3e-2d55-4f6c-9b1a-5d2c8e9f1b11';
const ABOUT_TITLE = '0b5d6f3e-2d55-4f6c-9b1a-5d2c8e9f1b12';

const title = (id: string) =>
  ({ id, apiKey: 'title', type: 'string', sortable: true, filterable: true }) as FieldDefinition;

const DIALECTS: Array<[string, ContentSqlDialect, Kysely<Record<string, never>>]> = [
  ['PostgreSQL', postgresContentDialect, new Kysely({ dialect: new PostgresDialect({ pool: {} as never }) })],
  ['SQLite', sqliteContentDialect, new Kysely({ dialect: new SqliteDialect({ database: {} as never }) })],
  ['MySQL', mysqlContentDialect, new Kysely({ dialect: new MysqlDialect({ pool: {} as never }) })],
];

describe.each(DIALECTS)('interface reads on %s', (_name, dialect, compiler) => {
  const compile = (node: RawBuilder<unknown>) => node.compile(compiler).sql;
  const member = (modelId: string, fieldId: string, localized: boolean): HeadQueryMember => ({
    modelId,
    conditions: [compileSearch(fieldId, 'sign', dialect)],
    conditionsReadEntries: false,
    orderBy: compileOrderBy(
      [{ target: { kind: 'field', field: title(fieldId) }, direction: 'asc' }],
      dialect,
    ),
    locales: localized ? { kind: 'chain', chain: ['en'] } : { kind: 'any' },
  });
  const plan = (members: HeadQueryMember[]): HeadQueryPlan => ({
    siteId: SITE,
    members,
    source: { kind: 'heads', state: 'published' },
    locales: { kind: 'any' },
    conditions: [],
    conditionsReadEntries: false,
    // The union's terms: only their directions and nullability are used outside the arms.
    orderBy: compileOrderBy(
      [{ target: { kind: 'field', field: title(POST_TITLE) }, direction: 'asc' }],
      dialect,
    ),
    limit: 2,
    offset: 2,
  });

  it('sorts and searches each arm on its own field, in its own locale scope', () => {
    const compiled = compileHeadQuery(
      plan([member(POST, POST_TITLE, true), member(ABOUT, ABOUT_TITLE, false)]),
      dialect,
    );
    const [postArm = '', aboutArm = ''] = compile(compiled.rows).split(/union all/i);
    expect(postArm).toContain(POST_TITLE);
    expect(postArm).not.toContain(ABOUT_TITLE);
    expect(postArm).toContain('h.locale = ');
    expect(aboutArm).toContain(ABOUT_TITLE);
    expect(aboutArm).not.toContain(POST_TITLE);
    expect(aboutArm).not.toContain('h.locale = ');
  });

  it('counts without the entries join when no arm needs it', () => {
    const count = compile(
      compileHeadQuery(plan([member(POST, POST_TITLE, true), member(ABOUT, ABOUT_TITLE, false)]), dialect)
        .count,
    );
    expect(count).not.toContain('join entries');
  });

  it('a lone member uses its own terms and scope', () => {
    const rows = compile(compileHeadQuery(plan([member(ABOUT, ABOUT_TITLE, false)]), dialect).rows);
    expect(rows).toContain(ABOUT_TITLE);
    expect(rows).not.toContain(POST_TITLE);
    expect(rows).not.toContain('h.locale =');
  });
});
