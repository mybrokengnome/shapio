import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import { createMigrator } from '../src/db/migrator.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/**
 * The sites migration (plan §H) on a database that already holds data: every row moves to the primary site,
 * keys and constraints are re-keyed per site, and `down` restores the previous shape losslessly while one
 * site exists (and refuses while several do).
 */
const BEFORE_SITES = '20261003120000_add_changes_ship_permission';
const SITES = '20261003130000_create_sites';

const MODEL_ID = '11111111-1111-4111-8111-111111111111';
const FIELD_ID = '22222222-2222-4222-8222-222222222222';

describe('sites migration', () => {
  const database = useTestDatabase({ empty: true });

  const run = async (statement: ReturnType<typeof sql>) => statement.execute(database.current.db);
  const rows = async <T>(statement: ReturnType<typeof sql<T>>) =>
    (await statement.execute(database.current.db)).rows;

  /** Rows in the shape the schema had before sites. */
  const seedLegacyData = async () => {
    await run(sql`insert into admin_users (id, email, password_hash)
      values ('33333333-3333-4333-8333-333333333333', 'owner@example.com', 'x')`);
    await run(sql`insert into admin_roles (id, key, name, kind) values
      ('44444444-4444-4444-8444-444444444441', 'editor-x', 'Editor', 'admin'),
      ('44444444-4444-4444-8444-444444444442', 'reader-x', 'Reader', 'delivery')`);
    await run(sql`insert into admin_user_roles (admin_user_id, role_id)
      values ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444441')`);
    await run(sql`insert into api_tokens (name, token_hash, token_prefix, role_id) values
      ('ci', 'h1', 'shp_1', '44444444-4444-4444-8444-444444444441'),
      ('site', 'h2', 'shp_2', '44444444-4444-4444-8444-444444444442')`);
    await run(sql`insert into admin_invitations (email, role_ids, expires_at)
      values ('new@example.com', array['44444444-4444-4444-8444-444444444441']::uuid[], now() + interval '1 day')`);
    await run(sql`insert into models (id, kind, api_key) values (${MODEL_ID}, 'collection', 'post')`);
    const [revision] = await rows<{ id: string }>(sql`insert into schema_revisions
      (model_id, version, definition, hash, created_by_type) values (${MODEL_ID}, 1, '{}', 'sha256:x', 'system')
      returning id`);
    const [entry] = await rows<{ id: string }>(
      sql`insert into entries (model_id) values (${MODEL_ID}) returning id`,
    );
    const [content] = await rows<{ id: string }>(sql`insert into content_revisions
      (entry_id, locale, schema_revision_id, data, reason, author_type)
      values (${entry?.id}, 'en', ${revision?.id}, '{}', 'create', 'system') returning id`);
    await run(sql`insert into entry_heads (entry_id, model_id, locale, state, revision_id, data)
      values (${entry?.id}, ${MODEL_ID}, 'en', 'published', ${content?.id}, '{}')`);
    await run(sql`insert into unique_values (field_id, locale, state, value_hash, entry_id, model_id)
      values (${FIELD_ID}, 'en', 'published', 'hash-1', ${entry?.id}, ${MODEL_ID})`);
    await run(sql`update publication_state set last_seq = 1`);
    await run(sql`insert into publication_snapshots (seq, source) values (1, 'publish')`);
    await run(sql`insert into publication_log (entry_id, model_id, locale, revision_id, from_seq)
      values (${entry?.id}, ${MODEL_ID}, 'en', ${content?.id}, 1)`);
    await run(
      sql`insert into media_folders (id, name) values ('55555555-5555-4555-8555-555555555555', 'Photos')`,
    );
    await run(sql`insert into media_assets (id, folder_id, storage_driver, storage_key, original_filename, mime_type,
      size_bytes) values ('66666666-6666-4666-8666-666666666666', '55555555-5555-4555-8555-555555555555', 'local',
      'public/a.png', 'a.png', 'image/png', 10)`);
    await run(
      sql`insert into app_users (id, email) values ('77777777-7777-4777-8777-777777777777', 'reader@example.com')`,
    );
    await run(sql`insert into field_reads (day, model_id, field_path, principal_key, selection, reads, last_read_at)
      values (current_date, ${MODEL_ID}, ${FIELD_ID}, 'anonymous', 'explicit', 3, now())`);
    return { entryId: entry?.id ?? '' };
  };

  it('moves every row to the primary site, re-keys per site, and rolls back losslessly', async () => {
    const migrator = createMigrator(database.current.db);
    expect((await migrator.migrateTo(BEFORE_SITES)).error).toBeUndefined();
    const { entryId } = await seedLegacyData();

    expect((await migrator.migrateTo(SITES)).error).toBeUndefined();
    const [primary] = await rows<{ id: string; key: string; is_primary: boolean }>(
      sql`select id, key, is_primary from sites`,
    );
    expect(primary).toEqual({ id: PRIMARY_SITE_ID, key: 'default', is_primary: true });
    for (const table of [
      'entries',
      'entry_heads',
      'unique_values',
      'publication_log',
      'publication_snapshots',
      'publication_state',
      'media_folders',
      'media_assets',
      'app_users',
      'field_reads',
    ]) {
      const sites = await rows<{ site_id: string }>(sql`select distinct site_id from ${sql.table(table)}`);
      expect({ table, sites: sites.map((row) => row.site_id) }).toEqual({ table, sites: [PRIMARY_SITE_ID] });
    }
    // Delivery tokens belong to the primary site; admin tokens stay network tokens; assignments cover every site.
    const tokens = await rows<{ name: string; site_id: string | null }>(
      sql`select name, site_id from api_tokens order by name`,
    );
    expect(tokens).toEqual([
      { name: 'ci', site_id: null },
      { name: 'site', site_id: PRIMARY_SITE_ID },
    ]);
    expect(await rows(sql`select site_id from admin_user_roles`)).toEqual([{ site_id: null }]);
    expect(await rows(sql`select role_assignments from admin_invitations`)).toEqual([
      { role_assignments: [{ roleId: '44444444-4444-4444-8444-444444444441', siteId: null }] },
    ]);
    expect(await rows(sql`select audience from site_app_roles order by audience`)).toEqual([
      { audience: 'authenticated' },
      { audience: 'public' },
    ]);

    // A second site: its own snapshot numbers and unique values; a copy that disagrees with its entry fails.
    await run(
      sql`insert into sites (id, key, name) values ('88888888-8888-4888-8888-888888888888', 'two', 'Two')`,
    );
    await run(sql`insert into publication_state (site_id) values ('88888888-8888-4888-8888-888888888888')`);
    await run(sql`insert into publication_snapshots (site_id, seq, source)
      values ('88888888-8888-4888-8888-888888888888', 1, 'publish')`);
    await expect(
      run(
        sql`update entry_heads set site_id = '88888888-8888-4888-8888-888888888888' where entry_id = ${entryId}`,
      ),
    ).rejects.toThrow(/entry_heads_entry_site_fk/);
    // Down refuses while two sites exist: merging them would merge ledgers and uniqueness.
    const refused = await migrator.migrateDown();
    expect(String(refused.error)).toMatch(/more than one site/);
    await run(sql`delete from sites where key = 'two'`);

    expect((await migrator.migrateDown()).error).toBeUndefined();
    expect(await rows(sql`select to_regclass('sites') as sites`)).toEqual([{ sites: null }]);
    expect(await rows(sql`select last_seq from publication_state`)).toEqual([{ last_seq: '1' }]);
    expect(await rows(sql`select role_ids from admin_invitations`)).toEqual([
      { role_ids: ['44444444-4444-4444-8444-444444444441'] },
    ]);
    expect(await rows(sql`select count(*)::int as n from admin_user_roles`)).toEqual([{ n: 1 }]);
    const columns = await rows<{ table_name: string }>(sql`select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'site_id'`);
    expect(columns).toEqual([]);

    // And up again on the rolled-back data.
    expect((await migrator.migrateTo(SITES)).error).toBeUndefined();
    expect(
      await rows(sql`select count(*)::int as n from entries where site_id = ${PRIMARY_SITE_ID}`),
    ).toEqual([{ n: 1 }]);
  });
});
