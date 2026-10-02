import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createPng, pathOf, uploadAsset, type MediaAssetBody } from './helpers/media.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const GLOBAL_MAX = 20;
const MEDIA_MAX = 40;
/** Any route under the global limit. */
const GLOBAL_ROUTE = '/api/admin/media/assets';

describe('media file rate limits', () => {
  const database = useTestDatabase();
  const mediaPath = mkdtempSync(join(tmpdir(), 'shapio-media-rl-'));
  let testApp: TestApp;
  let editor: TestSession;
  let publicAsset: MediaAssetBody;
  let privateAsset: MediaAssetBody;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      env: {
        MEDIA_PATH: mediaPath,
        RATE_LIMIT_MAX: String(GLOBAL_MAX),
        MEDIA_RATE_LIMIT_MAX: String(MEDIA_MAX),
      },
    });
    editor = await login(testApp.app, await createAdmin(testApp.db, { roleKeys: ['editor'] }));
    publicAsset = await uploadAsset(testApp.app, editor.headers, {
      file: await createPng(8, 8),
      filename: 'a.png',
      mimeType: 'image/png',
    });
    privateAsset = await uploadAsset(testApp.app, editor.headers, {
      file: await createPng(9, 9),
      filename: 'b.png',
      mimeType: 'image/png',
      visibility: 'private',
    });
  });
  afterAll(async () => {
    await testApp.app.close();
    rmSync(mediaPath, { recursive: true, force: true });
  });

  const fetchFrom = (remoteAddress: string, url: string) =>
    testApp.app.inject({ method: 'GET', url, remoteAddress });

  const statuses = async (remoteAddress: string, url: string, count: number) => {
    const codes: number[] = [];
    for (let index = 0; index < count; index += 1) {
      codes.push((await fetchFrom(remoteAddress, url)).statusCode);
    }
    return codes;
  };

  it('gives public files their own, higher limit that does not use up the global one', async () => {
    const codes = await statuses('10.9.0.1', pathOf(publicAsset.url), MEDIA_MAX + 1);
    expect(codes.slice(0, MEDIA_MAX).every((code) => code === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
    // An ordinary, globally limited request from the same IP is unaffected (401: not signed in, not 429).
    expect((await fetchFrom('10.9.0.1', GLOBAL_ROUTE)).statusCode).toBe(401);
  });

  it('keeps signed (private) URLs on the global limit, shared with other requests', async () => {
    const signed = pathOf(privateAsset.url);
    expect(await statuses('10.9.0.2', GLOBAL_ROUTE, GLOBAL_MAX - 1)).not.toContain(429);
    expect((await fetchFrom('10.9.0.2', signed)).statusCode).toBe(200);
    expect((await fetchFrom('10.9.0.2', signed)).statusCode).toBe(429);
  });
});
