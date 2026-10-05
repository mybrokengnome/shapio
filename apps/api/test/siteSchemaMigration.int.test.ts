import { describe, expect, it } from 'vitest';
import { createMigrator } from '../src/db/migrator.js';
import * as schemaModelsRepository from '../src/repositories/schemaModels.js';
import * as sitesRepository from '../src/repositories/sites.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const SITE_SCOPE = '20261004120000_models_site_scope';
const MODEL_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

/**
 * The per-site schema migration (plan site-schema) on every dialect: existing definitions become shared, API
 * IDs are unique per scope (two sites may each have a `post`), and `down` refuses while a definition belongs
 * to a site, then rolls back losslessly.
 */
describe('per-site schema migration', () => {
  const database = useTestDatabase({ empty: true });

  it('scopes API IDs per site, and rolls back only once no definition belongs to a site', async () => {
    const { db } = database.current;
    const migrator = createMigrator(db);
    expect((await migrator.migrateToLatest()).error).toBeUndefined();

    const site = await sitesRepository.insert({ key: 'blog', name: 'Blog' }, db);
    await schemaModelsRepository.insertModel(
      { id: MODEL_ID, kind: 'collection', apiKey: 'post', siteId: null },
      db,
    );
    await schemaModelsRepository.insertModel(
      { id: OTHER_ID, kind: 'collection', apiKey: 'post', siteId: site.id },
      db,
    );
    // The same scope still refuses a second `post` (case-folded).
    await expect(
      schemaModelsRepository.insertModel(
        { id: '33333333-3333-4333-8333-333333333333', kind: 'collection', apiKey: 'Post', siteId: site.id },
        db,
      ),
    ).rejects.toThrow();

    // Later migrations first, so the next step down is the site-scope migration itself.
    expect((await migrator.migrateTo(SITE_SCOPE)).error).toBeUndefined();
    const refused = await migrator.migrateDown();
    expect(refused.error).toBeDefined();
    expect(String(refused.error)).toContain('definitions belong to a site');

    await db.deleteFrom('models').where('id', '=', OTHER_ID).execute();
    const down = await migrator.migrateDown();
    expect(down.error).toBeUndefined();
    expect(down.results?.[0]).toMatchObject({
      migrationName: SITE_SCOPE,
      direction: 'Down',
      status: 'Success',
    });
    expect(await db.selectFrom('models').select(['id', 'api_key']).execute()).toEqual([
      { id: MODEL_ID, api_key: 'post' },
    ]);

    expect((await migrator.migrateToLatest()).error).toBeUndefined();
    const [model] = await db.selectFrom('models').select(['id', 'site_id']).execute();
    expect(model).toEqual({ id: MODEL_ID, site_id: null });
  });
});
