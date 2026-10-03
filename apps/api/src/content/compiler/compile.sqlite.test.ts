import { Kysely, SqliteDialect, type RawBuilder } from 'kysely';
import { describe, expect, it } from 'vitest';
import {
  compileFixtureFilter,
  compileFixtureQuery,
  FIXTURE_FIELDS as F,
  FIXTURE_MODEL_ID as MODEL,
  FIXTURE_SITE_ID as SITE,
} from '../../../test/helpers/compilerFixture.js';
import type { Principal } from '../../permissions/types.js';
import { compileAuthorCondition, compileStatusCondition } from './compile.js';
import { entryIdIn, entryIdIs } from './conditions.js';
import { sqliteContentDialect as sqlite } from './dialect/sqlite.js';
import {
  analyzeHeadsStatement,
  createFieldIndexStatement,
  createFieldStatisticsStatement,
  dropIndexStatement,
  dropStatisticsStatement,
  fieldIndexName,
} from './expressions.js';
import { compileModelRowFilters, compileRowFilter } from './policy.js';

// Compiles SQL without a connection.
const compiler = new Kysely<Record<string, never>>({ dialect: new SqliteDialect({ database: {} as never }) });
const compile = (node: RawBuilder<unknown> | null) => {
  if (!node) {
    throw new Error('expected a statement');
  }
  const { sql, parameters } = node.compile(compiler);
  return { sql, parameters: [...parameters] };
};
const filterOf = (search: string) => compile(compileFixtureFilter(search, sqlite));

const text = (id: string) => `("data" ->> '${id}')`;
const json = (id: string) => `("data" -> '${id}')`;
const numeric = (id: string) => `cast(${text(id)} as numeric)`;
const member = (id: string) =>
  `(json_type(${json(id)}) = 'array' and exists (select 1 from json_each(${json(id)}) where value = ?))`;
const missing = (id: string) => `(${json(id)} is null or ${json(id)} in ('null', '""', '[]'))`;

describe('content query compiler on SQLite', () => {
  it.each([
    // Equality goes through the field's index expression; `is` is false (not null) for a missing value.
    ['filters[title][$eq]=x', `(${text(F.title)} is ?)`, ['x']],
    ['filters[title][$ne]=x', `(not (${text(F.title)} is ?))`, ['x']],
    [
      'filters[title][$in][0]=x&filters[title][$in][1]=y',
      `((${text(F.title)} is ?) or (${text(F.title)} is ?))`,
      ['x', 'y'],
    ],
    ['filters[title][$nin][0]=x', `(not ((${text(F.title)} is ?)))`, ['x']],
    ['filters[rank][$eq]=3', `(${numeric(F.rank)} is cast(? as numeric))`, [3]],
    ['filters[live][$eq]=true', `(${text(F.live)} is ?)`, [1]],
    ['filters[live][$ne]=false', `(not (${text(F.live)} is ?))`, [0]],
    ['filters[author][$eq]=' + MODEL, `(${text(F.author)} is ?)`, [MODEL]],
    // Numbers stored as strings compare numerically, as on PostgreSQL ("12.5" equals "12.50").
    ['filters[price][$eq]=12.50', `(${numeric(F.price)} = cast(? as numeric))`, ['12.50']],
    ['filters[big][$eq]=12', `(${numeric(F.big)} = cast(? as numeric))`, ['12']],
    // Lists: membership through json_each.
    ['filters[tags][$eq]=a', member(F.tags), ['a']],
    [
      'filters[tags][$in][0]=a&filters[tags][$in][1]=b',
      `(${member(F.tags)} or ${member(F.tags)})`,
      ['a', 'b'],
    ],
    ['filters[title][$null]=true', missing(F.title), []],
    ['filters[title][$notNull]=true', `(not ${missing(F.title)})`, []],
    ['filters[tags][$null]=false', `(not ${missing(F.tags)})`, []],
    // Ranges: the index expression on both sides.
    ['filters[title][$lt]=m', `(${text(F.title)} < ?)`, ['m']],
    ['filters[rank][$gte]=3', `(${numeric(F.rank)} >= cast(? as numeric))`, [3]],
    ['filters[price][$gt]=1.5', `(${numeric(F.price)} > cast(? as numeric))`, ['1.5']],
    ['filters[score][$lte]=1.25', `(${numeric(F.score)} <= cast(? as numeric))`, [1.25]],
    ['filters[day][$gte]=2026-02-01', `(${text(F.day)} >= ?)`, ['2026-02-01']],
    // Text matches: case-sensitive without LIKE (SQLite's LIKE folds ASCII case), so nothing is escaped.
    ['filters[title][$contains]=a%b', `(instr(${text(F.title)}, ?) > 0)`, ['a%b']],
    ['filters[title][$startsWith]=a_', `(instr(${text(F.title)}, ?) = 1)`, ['a_']],
    ['filters[title][$endsWith]=a', `(substr(${text(F.title)}, -length(?)) = ?)`, ['a', 'a']],
    ['filters[title][$notContains]=a', `(instr(coalesce(${text(F.title)}, ''), ?) = 0)`, ['a']],
    // Case-insensitive: Unicode folding on both sides.
    ['filters[title][$containsi]=ÉTÉ%', `(instr(shapio_fold(${text(F.title)}), ?) > 0)`, ['été%']],
    ['q=Hello', `(instr(shapio_fold(${text(F.title)}), ?) > 0)`, ['hello']],
    // System attributes: plain parameters, lists as one JSON parameter, timestamps in the stored format.
    ['filters[id][$eq]=' + MODEL, `("h"."entry_id" = ?)`, [MODEL]],
    [
      'filters[id][$in][0]=' + MODEL,
      `("h"."entry_id" in (select value from json_each(?)))`,
      [`["${MODEL}"]`],
    ],
    [
      'filters[createdAt][$gt]=2026-10-01T10:00:00%2B02:00',
      `("e"."created_at" > ?)`,
      ['2026-10-01T08:00:00.000Z'],
    ],
    [
      'filters[updatedAt][$nin][0]=2026-10-01T10:00:00Z',
      `(not ("h"."updated_at" in (select value from json_each(?))))`,
      ['["2026-10-01T10:00:00.000Z"]'],
    ],
    // Logical nodes.
    [
      'filters[$or][0][title][$eq]=x&filters[$or][1][rank][$gt]=1',
      `((${text(F.title)} is ?) or (${numeric(F.rank)} > cast(? as numeric)))`,
      ['x', 1],
    ],
    [
      'filters[$and][0][title][$eq]=x&filters[$and][1][day][$lt]=2026-01-01',
      `((${text(F.title)} is ?) and (${text(F.day)} < ?))`,
      ['x', '2026-01-01'],
    ],
    ['filters[$not][title][$eq]=x', `(not (${text(F.title)} is ?))`, ['x']],
  ] as const)('%s', (search, sql, parameters) => {
    expect(filterOf(search)).toEqual({ sql, parameters });
  });

  const select = `select h.entry_id, h.locale, h.data, h.version, h.revision_id, h.updated_at,
      h.autosaved_at, e.created_at, e.updated_at as entry_updated_at, e.created_by_admin_id, e.owner_app_user_id
      `;
  const from = (table: string) =>
    `from "${table}" h join entries e on e.id = h.entry_id and e.deleted_at is null where h.site_id = ? and h.model_id = '${MODEL}'`;
  const fallback = (table: string, stateMatch: string) =>
    ` and h.locale in (select value from json_each(?)) and not exists (select 1 from "${table}" h2 where h2.entry_id = h.entry_id${stateMatch}
      and h2.locale in (select value from json_each(?))
      and (case h2.locale when ? then 0 when ? then 1 end) < (case h.locale when ? then 0 when ? then 1 end))`;
  const chainParameters = ['["fr","en"]', '["fr","en"]', 'fr', 'en', 'fr', 'en'];
  /** The joined entry's site and model: on the row query of a plain list in `entries` order only. */
  const entryScope = ` and e.site_id = ? and e.model_id = '${MODEL}'`;

  it('ranks the locale chain without arrays and sorts missing values like PostgreSQL', () => {
    const query = compileFixtureQuery('sort=title:asc,rank:desc&page=2', sqlite);
    const where = `${from('entry_heads')} and h.state = ?${fallback('entry_heads', ' and h2.state = h.state')}`;
    expect(compile(query.rows)).toEqual({
      sql: `${select}${where} order by ${text(F.title)} asc nulls last, ${numeric(F.rank)} desc nulls first, e.id asc limit ? offset ?`,
      parameters: [SITE, 'published', ...chainParameters, 25, 25],
    });
    expect(compile(query.count)).toEqual({
      // No condition: live heads are counted without the entries join.
      sql: `select count(*) as total ${where.replace(' join entries e on e.id = h.entry_id and e.deleted_at is null', '')}`,
      parameters: [SITE, 'published', ...chainParameters],
    });
  });

  it('reads one locale, or any locale, with plain conditions', () => {
    expect(
      compile(
        compileFixtureQuery('sort=createdAt:asc', sqlite, { locales: { kind: 'chain', chain: ['en'] } }).rows,
      ),
    ).toEqual({
      sql: `${select}${from('entry_heads')} and h.state = ? and h.locale = ?${entryScope} order by "e"."created_at" asc, e.id asc limit ?`,
      parameters: [SITE, 'published', 'en', SITE, 25],
    });
    expect(
      compile(compileFixtureQuery('', sqlite, { locales: { kind: 'any' }, state: 'draft' }).rows),
    ).toEqual({
      sql: `${select}${from('entry_heads')} and h.state = ? order by e.id asc limit ?`,
      parameters: [SITE, 'draft', 25],
    });
  });

  it('names the entry scope only on an unfiltered list in entries order', () => {
    const rowsOf = (search: string) =>
      compile(compileFixtureQuery(search, sqlite, { locales: { kind: 'any' } }).rows).sql;
    expect(rowsOf('sort=createdAt:desc')).toContain(`${entryScope} order by "e"."created_at" desc`);
    expect(rowsOf('sort=createdAt:desc&filters[title][$eq]=x')).not.toContain('e.site_id');
    expect(rowsOf('sort=updatedAt:desc')).not.toContain('e.site_id');
    expect(compile(compileFixtureQuery('sort=createdAt:desc', sqlite).count).sql).not.toContain('e.site_id');
  });

  it('counts live heads without the entries join unless a condition or a snapshot needs it', () => {
    const countOf = (search: string) => compile(compileFixtureQuery(search, sqlite).count).sql;
    expect(countOf('')).not.toContain('join entries');
    expect(countOf('filters[title][$eq]=x')).toContain(
      'join entries e on e.id = h.entry_id and e.deleted_at is null',
    );
    expect(countOf('snapshot=3')).toContain('join entries e on e.id = h.entry_id and e.deleted_at is null');
  });

  it('reads a snapshot from the publication log without casts', () => {
    const cte = `with "content_snapshot" as (
    select pl.entry_id, pl.site_id, pl.model_id, pl.locale, 'published' as state, r.data, 0 as version,
      r.id as revision_id, pl.published_at as updated_at, null as autosaved_at
    from publication_log pl
    join content_revisions r on r.id = pl.revision_id
    where pl.site_id = ? and pl.model_id = '${MODEL}'
      and pl.from_seq <= ?
      and (pl.to_seq is null or pl.to_seq > ?)
  ) `;
    expect(compile(compileFixtureQuery('snapshot=3&filters[title][$eq]=x', sqlite).rows)).toEqual({
      sql: `${cte}${select}${from('content_snapshot')}${fallback('content_snapshot', '')} and (${text(F.title)} is ?) order by e.id asc limit ?`,
      parameters: [SITE, 3, 3, SITE, ...chainParameters, 'x', 25],
    });
  });

  it('compiles entry, author, status and row-filter conditions', () => {
    const admin = { kind: 'admin', adminUserId: MODEL } as Principal;
    const appUser = { kind: 'appUser', appUserId: SITE } as Principal;
    expect(compile(entryIdIs(MODEL, sqlite))).toEqual({ sql: 'h.entry_id = ?', parameters: [MODEL] });
    expect(compile(entryIdIn([MODEL, SITE], sqlite))).toEqual({
      sql: 'h.entry_id in (select value from json_each(?))',
      parameters: [JSON.stringify([MODEL, SITE])],
    });
    expect(compile(compileAuthorCondition(MODEL, sqlite))).toEqual({
      sql: 'e.created_by_admin_id = ?',
      parameters: [MODEL],
    });
    expect(compile(compileStatusCondition('draft')).sql).toContain('not exists (select 1 from entry_heads p');
    expect(compile(compileRowFilter({ kind: 'ownedByPrincipal' }, admin, sqlite))).toEqual({
      sql: '"e"."created_by_admin_id" = ?',
      parameters: [MODEL],
    });
    expect(compile(compileRowFilter({ kind: 'ownedByPrincipal' }, appUser, sqlite))).toEqual({
      sql: '"e"."owner_app_user_id" = ?',
      parameters: [SITE],
    });
    expect(compile(compileRowFilter({ kind: 'and', filters: [] }, admin, sqlite)).sql).toBe('true');
    expect(compile(compileRowFilter({ kind: 'or', filters: [] }, admin, sqlite)).sql).toBe('false');
    expect(
      compile(
        compileModelRowFilters(
          [
            { modelId: MODEL, rowFilter: null },
            { modelId: SITE, rowFilter: { kind: 'ownedByPrincipal' } },
          ],
          admin,
          sqlite,
        ),
      ),
    ).toEqual({
      sql: '(e.model_id in (select value from json_each(?)) or (e.model_id = ? and "e"."created_by_admin_id" = ?))',
      parameters: [JSON.stringify([MODEL]), SITE, MODEL],
    });
  });

  it('builds one plain partial index per field on the expression queries use, without statistics', () => {
    const spec = { modelId: MODEL, fieldId: F.rank, type: 'integer' as const };
    const name = fieldIndexName(spec);
    expect(compile(createFieldIndexStatement(spec, sqlite))).toEqual({
      sql: `create index if not exists "${name}" on "entry_heads" ("site_id", "locale", "state", ${numeric(F.rank)}) where "model_id" = '${MODEL}'`,
      parameters: [],
    });
    expect(
      compile(createFieldIndexStatement({ ...spec, type: 'string', localized: false }, sqlite)).sql,
    ).toBe(
      `create index if not exists "${fieldIndexName({ ...spec, type: 'string', localized: false })}" on "entry_heads" ("site_id", "state", ${text(F.rank)}) where "model_id" = '${MODEL}'`,
    );
    expect(compile(dropIndexStatement(name, sqlite)).sql).toBe(`drop index if exists "${name}"`);
    expect(createFieldStatisticsStatement(spec, sqlite)).toBeNull();
    expect(dropStatisticsStatement(name, sqlite)).toBeNull();
    expect(compile(analyzeHeadsStatement(sqlite)).sql).toBe('analyze "entry_heads"');
  });

  it('never emits a PostgreSQL cast, array or LIKE', () => {
    const searches = [
      'filters[title][$eq]=x&filters[rank][$gt]=1&filters[price][$eq]=1&filters[live][$eq]=true',
      'filters[tags][$in][0]=a&filters[id][$nin][0]=' +
        MODEL +
        '&filters[createdAt][$lt]=2026-01-01T00:00:00Z',
      'filters[title][$containsi]=x&filters[title][$startsWith]=y&sort=price:desc',
      'snapshot=2&q=x',
    ];
    for (const search of searches) {
      const { sql } = compile(compileFixtureQuery(search, sqlite).rows);
      expect(sql).not.toMatch(/::|\bany\(|array_position|\bi?like\b|@>|jsonb/);
    }
  });
});
