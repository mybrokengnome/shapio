import { Kysely, MysqlDialect, type RawBuilder } from 'kysely';
import { describe, expect, it } from 'vitest';
import {
  compileFixtureFilter,
  compileFixtureQuery,
  FIXTURE_FIELDS as F,
  FIXTURE_MODEL_ID as MODEL,
  FIXTURE_SITE_ID as SITE,
} from '../../../test/helpers/compilerFixture.js';
import type { Principal } from '../../permissions/types.js';
import { entryIdIn, entryIdIs } from './conditions.js';
import { mysqlContentDialect as mysql } from './dialect/mysql.js';
import {
  analyzeHeadsStatement,
  createFieldIndexColumnStatement,
  createFieldIndexStatement,
  createFieldStatisticsStatement,
  dropFieldIndexColumnStatement,
  dropIndexStatement,
  dropStatisticsStatement,
  fieldIndexName,
} from './expressions.js';
import { compileModelRowFilters, compileRowFilter } from './policy.js';

// Compiles SQL without a connection.
const compiler = new Kysely<Record<string, never>>({ dialect: new MysqlDialect({ pool: {} as never }) });
const compile = (node: RawBuilder<unknown> | null) => {
  if (!node) {
    throw new Error('expected a statement');
  }
  const { sql, parameters } = node.compile(compiler);
  return { sql, parameters: [...parameters] };
};
const filterOf = (search: string) => compile(compileFixtureFilter(search, mysql));

const path = (id: string) => `_utf8mb4'$."${id}"'`;
const full = (id: string) => `json_value(\`data\`, ${path(id)} returning char(1000000))`;
const text = (id: string) => `left(${full(id)}, 255)`;
const json = (id: string) => `json_extract(\`data\`, ${path(id)})`;
const numeric = (id: string) => `json_value(\`data\`, ${path(id)} returning double)`;
const bool = (id: string) => `json_value(\`data\`, ${path(id)} returning char(5))`;
const present = (expression: string, value: string) =>
  `(${expression} = ${value} and ${expression} is not null)`;
const member = (id: string) =>
  `(${json(id)} is not null and json_type(${json(id)}) = 'ARRAY' collate utf8mb4_bin and ? member of (${json(id)}))`;
const decimal = (id: string) => `json_value(\`data\`, ${path(id)} returning decimal(65,30))`;
const missing = (id: string) =>
  `(${json(id)} is null or ${json(id)} = cast('null' as json) or ${json(id)} = cast('""' as json) or ${json(id)} = json_array())`;

describe('content query compiler on MySQL', () => {
  it.each([
    // Equality on the index expression; `and expr is not null` keeps a missing value false, not null.
    ['filters[title][$eq]=x', present(text(F.title), '?'), ['x']],
    ['filters[title][$ne]=x', `(not ${present(text(F.title), '?')})`, ['x']],
    ['filters[rank][$eq]=3', present(numeric(F.rank), 'cast(? as double)'), [3]],
    ['filters[live][$eq]=true', present(bool(F.live), '?'), ['true']],
    ['filters[author][$eq]=' + MODEL, present(full(F.author), '?'), [MODEL]],
    // Numbers stored as strings compare numerically, as on PostgreSQL ("12.5" equals "12.50").
    ['filters[price][$eq]=12.50', `(${decimal(F.price)} = cast(? as decimal(65,30)))`, ['12.50']],
    ['filters[tags][$eq]=a', member(F.tags), ['a']],
    ['filters[title][$null]=true', missing(F.title), []],
    ['filters[title][$lt]=m', `(${text(F.title)} < ?)`, ['m']],
    ['filters[rank][$gte]=3', `(${numeric(F.rank)} >= cast(? as double))`, [3]],
    ['filters[day][$gte]=2026-02-01', `(${text(F.day)} >= ?)`, ['2026-02-01']],
    // Text matches: `locate` in the binary collation, case-sensitive, nothing to escape.
    ['filters[title][$contains]=a%b', `(locate(?, ${full(F.title)}) > 0)`, ['a%b']],
    ['filters[title][$startsWith]=a_', `(locate(?, ${full(F.title)}) = 1)`, ['a_']],
    ['filters[title][$endsWith]=ab', `(right(${full(F.title)}, 2) = ?)`, ['ab']],
    ['filters[title][$notContains]=a', `(locate(?, coalesce(${full(F.title)}, '')) = 0)`, ['a']],
    ['filters[title][$containsi]=ÉTÉ', `(locate(lower(?), lower(${full(F.title)})) > 0)`, ['ÉTÉ']],
    // System attributes: lists as `in (?, …)`, timestamps as UTC DATETIME text.
    ['filters[id][$in][0]=' + MODEL, '(`h`.`entry_id` in (?))', [MODEL]],
    [
      'filters[createdAt][$gt]=2026-10-01T10:00:00%2B02:00',
      '(`h`.`entry_created_at` > ?)',
      ['2026-10-01 08:00:00.000000'],
    ],
  ] as const)('%s', (search, sql, parameters) => {
    expect(filterOf(search)).toEqual({ sql, parameters });
  });

  it('compares a long text value by its indexed prefix and in full', () => {
    const long = 'x'.repeat(300);
    expect(filterOf(`filters[title][$eq]=${long}`)).toEqual({
      sql: `(${text(F.title)} = left(?, 255) and ${full(F.title)} = ?)`,
      parameters: [long, long],
    });
  });

  it('sorts missing values like PostgreSQL by sorting on `is null` first', () => {
    const { sql } = compile(compileFixtureQuery('sort=title:asc,rank:desc', mysql).rows);
    expect(sql).toContain(
      `order by (${text(F.title)} is null) asc, ${text(F.title)} asc, (${numeric(F.rank)} is null) desc, ${numeric(F.rank)} desc, h.entry_id asc`,
    );
  });

  it('compiles entry and row-filter conditions', () => {
    const admin = { kind: 'admin', adminUserId: MODEL } as Principal;
    expect(compile(entryIdIs(MODEL, mysql))).toEqual({ sql: 'h.entry_id = ?', parameters: [MODEL] });
    expect(compile(entryIdIn([MODEL, SITE], mysql))).toEqual({
      sql: 'h.entry_id in (?, ?)',
      parameters: [MODEL, SITE],
    });
    expect(compile(entryIdIn([], mysql)).sql).toBe('false');
    expect(
      compile(
        compileModelRowFilters(
          [
            { modelId: MODEL, rowFilter: null },
            { modelId: SITE, rowFilter: { kind: 'ownedByPrincipal' } },
          ],
          admin,
          mysql,
        ),
      ),
    ).toEqual({
      sql: '(e.model_id in (?) or (e.model_id = ? and `e`.`created_by_admin_id` = ?))',
      parameters: [MODEL, SITE, MODEL],
    });
    expect(compile(compileRowFilter({ kind: 'ownedByPrincipal' }, admin, mysql)).sql).toBe(
      '`e`.`created_by_admin_id` = ?',
    );
  });

  it('builds a field index online on an invisible virtual column holding the expression', () => {
    const spec = { modelId: MODEL, fieldId: F.rank, type: 'integer' as const };
    const name = fieldIndexName(spec);
    const column = name.replace(/^eh_/, 'ev_');
    expect(compile(createFieldIndexColumnStatement(spec, mysql)).sql).toBe(
      `alter table \`entry_heads\` add column \`${column}\` double
    generated always as (${numeric(F.rank)}) virtual invisible, algorithm=inplace, lock=none`,
    );
    expect(compile(createFieldIndexStatement(spec, mysql)).sql).toBe(
      `create index \`${name}\` on \`entry_heads\` (\`site_id\`, \`model_id\`, \`locale\`, \`state\`, \`${column}\`) algorithm=inplace lock=none`,
    );
    expect(compile(createFieldIndexStatement({ ...spec, localized: false }, mysql)).sql).toContain(
      '(`site_id`, `model_id`, `state`, ',
    );
    expect(compile(dropIndexStatement(name, mysql)).sql).toBe(
      `drop index \`${name}\` on \`entry_heads\` algorithm=inplace lock=none`,
    );
    expect(compile(dropFieldIndexColumnStatement(name, mysql)).sql).toBe(
      `alter table \`entry_heads\` drop column \`${column}\`, algorithm=inplace, lock=none`,
    );
    expect(createFieldStatisticsStatement(spec, mysql)).toBeNull();
    expect(dropStatisticsStatement(name, mysql)).toBeNull();
    expect(compile(analyzeHeadsStatement(mysql)).sql).toBe('analyze table `entry_heads`');
  });

  it('never emits a PostgreSQL cast, array, LIKE or NULLS FIRST/LAST', () => {
    const searches = [
      'filters[title][$eq]=x&filters[rank][$gt]=1&filters[price][$eq]=1&filters[live][$eq]=true',
      'filters[tags][$in][0]=a&filters[id][$nin][0]=' +
        MODEL +
        '&filters[createdAt][$lt]=2026-01-01T00:00:00Z',
      'filters[title][$containsi]=x&filters[title][$startsWith]=y&sort=price:desc',
      'snapshot=2&q=x',
    ];
    for (const search of searches) {
      const { sql } = compile(compileFixtureQuery(search, mysql).rows);
      expect(sql).not.toMatch(/::|\bany\(|array_position|\bi?like\b|@>|jsonb|\bnulls (first|last)\b/);
    }
  });
});
