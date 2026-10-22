import { randomUUID } from 'node:crypto';
import { MEDIA_KINDS } from '@shapio/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import { mediaKindOf } from '../src/content/media.js';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import type { MediaAssetBody } from './helpers/media.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/** One or more MIME types per kind, including the document rules' edge cases. */
const MIME_TYPES = [
  'image/png',
  'image/svg+xml',
  'video/mp4',
  'audio/mpeg',
  'text/plain',
  'text/csv',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'application/epub+zip',
  'application/zip',
  'application/json',
  'font/woff2',
  'application/x-pdf',
];

describe('media list: kind filter', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let reader: TestSession;

  beforeAll(async () => {
    testApp = await createTestApp(database.current);
    reader = await login(testApp.app, await createAdmin(testApp.db, { roleKeys: ['read-only'] }));
    await testApp.db
      .insertInto('media_assets')
      .values(
        MIME_TYPES.map((mimeType, index) => {
          const id = randomUUID();
          return {
            id,
            site_id: PRIMARY_SITE_ID,
            storage_driver: 'local',
            storage_key: `kind-filter/${id}`,
            original_filename: `file-${index}`,
            mime_type: mimeType,
            size_bytes: 1,
            status: 'ready',
          };
        }),
      )
      .execute();
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  const list = async (query: string) => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/admin/media/assets?limit=200&${query}`,
      headers: reader.headers,
    });
    expect(response.statusCode).toBe(200);
    return response
      .json<{ items: MediaAssetBody[] }>()
      .items.map((item) => item.mimeType)
      .sort();
  };

  it.each(MEDIA_KINDS)('lists exactly the %s assets, by the same rules as allowed kinds', async (kind) => {
    const expected = MIME_TYPES.filter((mimeType) => mediaKindOf(mimeType) === kind).sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(await list(`kind=${kind}`)).toEqual(expected);
  });

  it('combines kind and mimeType (both must match)', async () => {
    expect(await list('kind=image&mimeType=image/png')).toEqual(['image/png']);
    expect(await list('kind=document&mimeType=image/png')).toEqual([]);
    expect(await list('kind=document&mimeType=application/*')).toEqual(
      MIME_TYPES.filter(
        (mimeType) => mimeType.startsWith('application/') && mediaKindOf(mimeType) === 'document',
      ).sort(),
    );
  });

  it('refuses an unknown kind', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/admin/media/assets?kind=spreadsheet',
      headers: reader.headers,
    });
    expect(response.statusCode).toBe(400);
  });
});
