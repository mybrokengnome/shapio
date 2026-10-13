import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect, type RawBuilder } from 'kysely';
import { describe, expect, it } from 'vitest';
import {
  compileFixtureFilter,
  FIXTURE_MODEL_ID as MODEL,
  FIXTURE_SITE_ID as SITE,
  parseFixtureQuery,
} from '../../../test/helpers/compilerFixture.js';
import type { Principal } from '../../permissions/types.js';
import { compileFilter, compileHeadPage, compileHeadQuery, type HeadQueryPlan } from './compile.js';
import { mysqlContentDialect } from './dialect/mysql.js';
import { postgresContentDialect } from './dialect/postgres.js';
import { sqliteContentDialect } from './dialect/sqlite.js';
import type { ContentSqlDialect } from './dialect/types.js';
import { compileRowFilter } from './policy.js';
import { compileOrderBy } from './sort.js';
import type { FilterNode } from './types.js';

/**
 * Family reads (plan polymorphic-types, D5): one UNION ALL arm per member, each a derived table that keeps
 * the member's literal model ID (its partial indexes), sorts and stops at `offset + limit`; the union is
 * ordered by the projected sort aliases and paged outside; the total sums the arms' counts.
 */
const CHILD = '0b5d6f3e-2d55-4f6c-9b1a-5d2c8e9f1a02';
const APP_USER = '7e7e7e7e-7777-4777-8777-777777777777';
const actor = { kind: 'appUser', appUserId: APP_USER, siteId: SITE, roleIds: [] } as Principal;

const DIALECTS: Array<[string, ContentSqlDialect, Kysely<Record<string, never>>]> = [
  ['PostgreSQL', postgresContentDialect, new Kysely({ dialect: new PostgresDialect({ pool: {} as never }) })],
  ['SQLite', sqliteContentDialect, new Kysely({ dialect: new SqliteDialect({ database: {} as never }) })],
  ['MySQL', mysqlContentDialect, new Kysely({ dialect: new MysqlDialect({ pool: {} as never }) })],
];

const familyPlan = (
  search: string,
  dialect: ContentSqlDialect,
  overrides: Partial<HeadQueryPlan> = {},
): HeadQueryPlan => {
  const query = parseFixtureQuery(search);
  const filter = compileFixtureFilter(search, dialect);
  const ownRows = compileRowFilter({ kind: 'ownedByPrincipal' }, actor, dialect);
  return {
    siteId: SITE,
    members: [{ modelId: MODEL }, { modelId: CHILD, conditions: ownRows ? [ownRows] : [] }],
    source: query.snapshot
      ? { kind: 'snapshot', seq: query.snapshot }
      : { kind: 'heads', state: 'published' },
    locales: { kind: 'any' },
    conditions: filter ? [filter] : [],
    conditionsReadEntries: false,
    orderBy: compileOrderBy(query.sort, dialect),
    limit: query.pageSize,
    ...(query.page > 1 ? { offset: (query.page - 1) * query.pageSize } : {}),
    ...overrides,
  };
};

const occurrences = (text: string, part: string) => text.split(part).length - 1;

describe.each(DIALECTS)('family reads on %s', (name, dialect, compiler) => {
  const compile = (node: RawBuilder<unknown>) => {
    const { sql, parameters } = node.compile(compiler);
    return { sql, parameters: [...parameters] };
  };
  const search = 'filters[rank][$gte]=10&sort=title:asc&pageSize=2&page=2';

  it('reads one arm per member, each by its literal model ID and its own conditions', () => {
    const { sql, parameters } = compile(compileHeadQuery(familyPlan(search, dialect), dialect).rows);
    expect(occurrences(sql, 'union all')).toBe(1);
    expect(sql).toContain(`h.model_id = '${MODEL}'`);
    expect(sql).toContain(`h.model_id = '${CHILD}'`);
    // The child's row filter is in its arm only.
    const owner = /.e.\..owner_app_user_id. = /g;
    expect(sql.match(owner)).toHaveLength(1);
    expect(sql.search(owner)).toBeGreaterThan(sql.indexOf(`h.model_id = '${CHILD}'`));
    expect(parameters).toContain(APP_USER);
    // The shared filter is in both arms.
    expect(parameters.filter((value) => value === 10)).toHaveLength(2);
  });

  it('sorts and stops each arm at offset + limit, then orders the union by the projected aliases', () => {
    const { sql, parameters } = compile(compileHeadQuery(familyPlan(search, dialect), dialect).rows);
    expect(sql.match(/ as .s0./g)).toHaveLength(2);
    expect(sql.match(/ as .s1./g)).toHaveLength(2);
    expect(sql).toMatch(/\) u order by \(?.u.\..s0. .*, .u.\..s1. asc limit \S+ offset \S+$/s);
    // Each arm takes offset + limit rows; the page takes `limit` after `offset`.
    expect(parameters.filter((value) => value === 4)).toHaveLength(2);
    expect(parameters.slice(-2)).toEqual([2, 2]);
    if (name === 'MySQL') {
      expect(sql).toContain('(`u`.`s0` is null) asc, `u`.`s0` asc');
    }
  });

  it('counts the family as the sum of the arms, keeping the no-join count where it can', () => {
    const plan = familyPlan('filters[rank][$gte]=10', dialect);
    const count = compile(compileHeadQuery(plan, dialect).count).sql;
    expect(count).toMatch(
      /^select \(\(select count\(\*\) from .*\) \+ \(select count\(\*\) from .*\)\) as total$/s,
    );
    // The parent's arm has no entries condition: no join. The child's row filter reads entries: joined.
    expect(occurrences(count, 'join entries e')).toBe(1);
    const page = compile(compileHeadPage(plan, { total: true }, dialect).rows).sql;
    expect(page).toContain(') + (select count(*) ');
  });

  it('reads a snapshot of the whole family from one CTE', () => {
    const { sql } = compile(compileHeadQuery(familyPlan('snapshot=7', dialect), dialect).rows);
    expect(occurrences(sql, 'from publication_log pl')).toBe(1);
    expect(sql).toContain(`pl.model_id in ('${MODEL}', '${CHILD}')`);
    expect(sql).toContain(`h.model_id = '${MODEL}'`);
    expect(sql).toContain(`h.model_id = '${CHILD}'`);
  });

  it('reads one member exactly as a model without kinds: no union, its model ID by equality', () => {
    const plan = familyPlan(search, dialect, { members: [{ modelId: MODEL }] });
    const { sql } = compile(compileHeadQuery(plan, dialect).rows);
    expect(sql).not.toContain('union all');
    expect(sql).not.toMatch(/ as .s0./);
    expect(
      compile(
        compileHeadQuery(familyPlan('snapshot=7', dialect, { members: [{ modelId: MODEL }] }), dialect).rows,
      ).sql,
    ).toContain(`pl.model_id = '${MODEL}'`);
  });

  it('sees relation targets of every kind of the target, each under its own row filter', () => {
    const filter = parseFixtureQuery('filters[author][$notNull]=true').filter;
    if (filter?.kind !== 'condition') {
      throw new Error('expected one condition');
    }
    const node: FilterNode = {
      ...filter,
      shownTargets: {
        kind: 'relation',
        siteId: SITE,
        members: [
          { modelId: MODEL, rowFilter: null },
          { modelId: CHILD, rowFilter: { kind: 'ownedByPrincipal' } },
        ],
        source: { kind: 'heads', state: 'published' },
        locales: { kind: 'any' },
        actor,
      },
    };
    const { sql } = compile(compileFilter(node, dialect));
    expect(sql).toMatch(
      new RegExp(
        `\\(h\\.model_id = '${MODEL}' or \\(h\\.model_id = '${CHILD}' and .e.\\..owner_app_user_id. = `,
      ),
    );
  });
});
