import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect, type RawBuilder } from 'kysely';
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_FIELDS as F,
  FIXTURE_MODEL_ID as MODEL,
  FIXTURE_SITE_ID as SITE,
  parseFixtureQuery,
} from '../../../test/helpers/compilerFixture.js';
import type { Principal } from '../../permissions/types.js';
import { compileFilter } from './compile.js';
import { mysqlContentDialect } from './dialect/mysql.js';
import { postgresContentDialect } from './dialect/postgres.js';
import { sqliteContentDialect } from './dialect/sqlite.js';
import type { ContentSqlDialect } from './dialect/types.js';
import type { FilterNode, ShownTargets } from './types.js';

/**
 * `$null`/`$notNull` on a reference field with the rule for what the read shows (issue #82): `exists` over the
 * stored IDs, each looked up as a target head (same source, locale chain and row filter) or a live asset.
 */

const APP_USER = '7e7e7e7e-7777-4777-8777-777777777777';
const actor = { kind: 'appUser', appUserId: APP_USER, siteId: SITE, roleIds: [] } as Principal;

const relation = (overrides: Partial<Extract<ShownTargets, { kind: 'relation' }>> = {}): ShownTargets => ({
  kind: 'relation',
  siteId: SITE,
  members: [{ modelId: MODEL, rowFilter: { kind: 'ownedByPrincipal' } }],
  source: { kind: 'heads', state: 'published' },
  locales: { kind: 'chain', chain: ['fr', 'en'] },
  actor,
  ...overrides,
});

/** The parsed `filters[author][<operator>]=<value>` condition with `shownTargets` attached. */
const authorCondition = (operator: string, value: string, shownTargets: ShownTargets): FilterNode => {
  const filter = parseFixtureQuery(`filters[author][${operator}]=${value}`).filter;
  if (filter?.kind !== 'condition') {
    throw new Error('expected one condition');
  }
  return { ...filter, shownTargets };
};

type DialectCase = {
  name: string;
  dialect: ContentSqlDialect;
  compiler: Kysely<Record<string, never>>;
  /** How the dialect reads the single `author` ID (`data` is the enclosing query's head: no FROM in between). */
  singleId: string;
};

const CASES: DialectCase[] = [
  {
    name: 'PostgreSQL',
    dialect: postgresContentDialect,
    compiler: new Kysely({ dialect: new PostgresDialect({ pool: {} as never }) }),
    singleId: `jsonb_typeof(("data" -> '${F.author}')) = 'string'`,
  },
  {
    name: 'SQLite',
    dialect: sqliteContentDialect,
    compiler: new Kysely({ dialect: new SqliteDialect({ database: {} as never }) }),
    singleId: `json_type(("data" -> '${F.author}')) = 'text'`,
  },
  {
    name: 'MySQL',
    dialect: mysqlContentDialect,
    compiler: new Kysely({ dialect: new MysqlDialect({ pool: {} as never }) }),
    singleId: `json_value(\`data\`, _utf8mb4'$."${F.author}"' returning char(36) null on error)`,
  },
];

describe.each(CASES)('$null and $notNull on references on $name', ({ dialect, compiler, singleId }) => {
  const compile = (node: RawBuilder<unknown>) => {
    const { sql, parameters } = node.compile(compiler);
    return { sql: sql.replace(/\s+/g, ' '), parameters: [...parameters] };
  };
  const sqlOf = (node: FilterNode) => compile(compileFilter(node, dialect));

  it('$notNull is "a stored ID has a target head the read shows"', () => {
    const { sql, parameters } = sqlOf(authorCondition('$notNull', 'true', relation()));
    expect(sql.startsWith('exists (select 1 from ')).toBe(true);
    expect(sql).toContain(singleId);
    // The target query reuses `h` and `e`: the site, the model, the state, the locale chain and the row filter.
    expect(sql).toContain('join entries e on e.id = h.entry_id and e.deleted_at is null');
    expect(sql).toContain(`h.model_id = '${MODEL}'`);
    expect(sql).toContain('h.entry_id = v.id');
    expect(sql).toMatch(/not exists \(select 1 from [`"]entry_heads[`"] h2/);
    expect(sql).toContain('owner_app_user_id');
    expect(parameters).toEqual(expect.arrayContaining([SITE, 'published', APP_USER]));
  });

  it('$null is its negation, and $null=false is $notNull', () => {
    const present = sqlOf(authorCondition('$notNull', 'true', relation())).sql;
    expect(sqlOf(authorCondition('$null', 'true', relation())).sql).toBe(`(not ${present})`);
    expect(sqlOf(authorCondition('$null', 'false', relation())).sql).toBe(present);
  });

  it('a snapshot read looks the targets up in the publication log as of the same sequence', () => {
    const { sql, parameters } = sqlOf(
      authorCondition('$notNull', 'true', relation({ source: { kind: 'snapshot', seq: 7 } })),
    );
    expect(sql).toContain('from publication_log pl');
    expect(sql).not.toContain('h.state =');
    expect(parameters).toContain(7);
  });

  it('a read without a row filter or locale chain adds neither', () => {
    const { sql } = sqlOf(
      authorCondition(
        '$notNull',
        'true',
        relation({ members: [{ modelId: MODEL, rowFilter: null }], locales: { kind: 'any' } }),
      ),
    );
    expect(sql).not.toContain('owner_app_user_id');
    expect(sql).not.toContain('h2');
  });

  it('media look up live assets of the site', () => {
    const { sql, parameters } = sqlOf(authorCondition('$notNull', 'true', { kind: 'media', siteId: SITE }));
    expect(sql).toContain('from media_assets m where m.id = v.id');
    expect(sql).toContain('m.deleted_at is null');
    expect(parameters).toEqual([SITE]);
  });

  it('a target model that is gone shows nothing: every entry is null', () => {
    expect(sqlOf(authorCondition('$notNull', 'true', { kind: 'none' })).sql).toBe('false');
    expect(sqlOf(authorCondition('$null', 'true', { kind: 'none' })).sql).toBe('(not false)');
  });

  it('without the rule the stored value decides, as before', () => {
    const filter = parseFixtureQuery('filters[author][$notNull]=true').filter;
    expect(filter && sqlOf(filter).sql).not.toContain('exists');
  });
});
