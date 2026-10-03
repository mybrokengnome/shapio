import { sql, type Compilable } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { DB } from '../types.js';
import { planOf } from './compiler.js';
import { createMysqlDb } from './index.js';

// Compiles SQL without connecting (the pool is created lazily, on the first query).
const db = createMysqlDb<DB>({ url: 'mysql://root@127.0.0.1:1/unused', poolMax: 1 });
const compile = (query: Compilable) => query.compile();

const UUID = /^'?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'?$/;

describe('MySQL plugin', () => {
  it('fills a generated UUID key an insert leaves out', () => {
    const query = compile(db.insertInto('locales').values({ code: 'de', label: 'German' }));
    expect(query.sql).toBe('insert into `locales` (`code`, `label`) values (?, ?)');
    const withKey = compile(
      db.insertInto('audit_events').values({ actor_type: 'system', action: 'x', outcome: 'success' }),
    );
    expect(withKey.sql).toBe(
      'insert into `audit_events` (`actor_type`, `action`, `outcome`, `id`) values (?, ?, ?, ?)',
    );
    expect(String(withKey.parameters[3])).toMatch(UUID);
  });

  it('spells casts the MySQL way', () => {
    const query = compile(db.selectFrom('jobs').select((eb) => eb.cast<string>('id', 'text').as('id')));
    expect(query.sql).toBe('select cast(`id` as char) as `id` from `jobs`');
  });

  it("keeps PostgreSQL's NULL placement for nullable columns only", () => {
    expect(compile(db.selectFrom('jobs').select('id').orderBy('created_at', 'desc')).sql).toBe(
      'select `id` from `jobs` order by `created_at` desc',
    );
    expect(compile(db.selectFrom('jobs').select('id').orderBy('finished_at', 'asc')).sql).toBe(
      'select `id` from `jobs` order by (`finished_at` is null) asc, `finished_at` asc',
    );
    expect(compile(db.selectFrom('jobs').select('id').orderBy('finished_at', 'desc')).sql).toBe(
      'select `id` from `jobs` order by (`finished_at` is null) desc, `finished_at` desc',
    );
  });

  it('turns ON CONFLICT … DO UPDATE into ON DUPLICATE KEY UPDATE with the excluded row alias', () => {
    const query = compile(
      db
        .insertInto('model_active_versions')
        .values({ model_id: 'm', revision_id: 'r', version: 1, schema_version: 1 })
        .onConflict((oc) =>
          oc.column('model_id').doUpdateSet((eb) => ({ revision_id: eb.ref('excluded.revision_id') })),
        ),
    );
    expect(query.sql).toBe(
      'insert into `model_active_versions` (`model_id`, `revision_id`, `version`, `schema_version`) values (?, ?, ?, ?) as `excluded` on duplicate key update `revision_id` = `excluded`.`revision_id`',
    );
    expect(planOf(query)).toBeUndefined();
  });

  it('turns an untargeted DO NOTHING without RETURNING into a no-op duplicate-key update', () => {
    const query = compile(
      db
        .insertInto('media_references')
        .values({ entry_id: 'e', model_id: 'm', locale: 'en', state: 'draft', field_id: 'f', asset_id: 'a' })
        .onConflict((oc) => oc.doNothing()),
    );
    expect(query.sql).toMatch(/ on duplicate key update `(\w+)` = `media_references`.`\1`$/);
    expect(planOf(query)).toBeUndefined();
  });

  it('wraps a same-table IN subquery of a DELETE in a derived table', () => {
    const query = compile(
      db
        .deleteFrom('jobs')
        .where('id', 'in', (eb) =>
          eb.selectFrom('jobs').select('id').where('status', '=', 'succeeded').limit(10),
        ),
    );
    expect(query.sql).toBe(
      'delete from `jobs` where `id` in (select * from (select `id` from `jobs` where `status` = ? limit ?) as `shapio_derived`)',
    );
  });

  it('plans an upsert whose other unique keys could fire instead of the target', () => {
    const query = compile(
      db
        .insertInto('admin_users')
        .values({ id: 'x', email: 'a@b.c', password_hash: 'h', name: 'n' })
        .onConflict((oc) => oc.column('id').doUpdateSet({ name: 'n' })),
    );
    expect(query.sql).not.toContain('on duplicate key');
    expect(planOf(query)).toBeTypeOf('function');
  });
});

describe('MySQL statement plans', () => {
  it('plans RETURNING and ON CONFLICT … DO NOTHING … RETURNING', () => {
    expect(
      planOf(compile(db.insertInto('locales').values({ code: 'de', label: 'G' }).returningAll())),
    ).toBeTypeOf('function');
    expect(
      planOf(
        compile(
          db
            .insertInto('system_settings')
            .values({ key: 'k', value: 'v' })
            .onConflict((oc) => oc.column('key').doNothing())
            .returning('key'),
        ),
      ),
    ).toBeTypeOf('function');
    expect(planOf(compile(db.updateTable('jobs').set({ status: 'dead' }).returning('id')))).toBeTypeOf(
      'function',
    );
    expect(planOf(compile(db.deleteFrom('jobs').returning('id')))).toBeTypeOf('function');
  });

  it('shows the planned statement without RETURNING', () => {
    expect(
      compile(db.updateTable('jobs').set({ status: 'dead' }).where('id', '=', 'x').returning('id')).sql,
    ).toBe('update `jobs` set `status` = ? where `id` = ?');
  });

  it('leaves raw SQL alone', () => {
    expect(planOf(sql`select 1`.compile(db))).toBeUndefined();
  });
});
