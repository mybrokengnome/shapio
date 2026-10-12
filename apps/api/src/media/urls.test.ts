import { describe, expect, it } from 'vitest';
import { createUrlBuilder } from '../helpers/publicUrl.js';
import type { MediaStorage, StorageAdapter, StorageDriver } from './types.js';
import { resolveObjectUrl } from './urls.js';

const urls = createUrlBuilder({ publicUrl: 'https://cms.example.com', basePath: '' });

/** Adapters that only name their URLs: a CDN for public objects, the driver for signed ones. */
const adapter = (driver: StorageDriver) =>
  ({
    signedGetUrl: (key: string) => Promise.resolve(`${driver}-signed:${key}`),
    publicUrl: (key: string) => `cdn:${key}`,
  }) as unknown as StorageAdapter;
const storage: MediaStorage = {
  active: adapter('s3'),
  get: (driver) => adapter(driver),
  has: () => true,
};

const object = (key: string, visibility: 'public' | 'private') => ({
  driver: 's3' as const,
  key,
  visibility,
  filename: 'a.png',
  mimeType: 'image/png',
});

describe('resolveObjectUrl', () => {
  it('uses the driver for an object under its own visibility prefix', async () => {
    expect((await resolveObjectUrl(storage, urls, object('public/a/t/a.png', 'public'))).url).toBe(
      'cdn:public/a/t/a.png',
    );
    expect((await resolveObjectUrl(storage, urls, object('private/a/t/a.png', 'private'))).url).toBe(
      's3-signed:private/a/t/a.png',
    );
  });

  it("points an object still waiting to move at Shapio's route under the new prefix", async () => {
    const madePublic = await resolveObjectUrl(storage, urls, object('private/a/t/a.png', 'public'));
    expect(madePublic).toEqual({
      url: 'https://cms.example.com/api/media/f/public/a/t/a.png',
      expiresAt: null,
    });
    const madePrivate = await resolveObjectUrl(storage, urls, object('public/a/t/a.png', 'private'));
    // Signed by the local adapter, which signs Shapio's route.
    expect(madePrivate.url).toBe('local-signed:private/a/t/a.png');
    expect(madePrivate.expiresAt).toBeInstanceOf(Date);
  });
});
