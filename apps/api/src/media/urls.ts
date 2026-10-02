import { MEDIA_FILE_ROUTE_PREFIX, MEDIA_SIGNED_URL_TTL_SECONDS } from '../constants/media.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import { encodeKeyPath, type MediaVisibility } from './keys.js';
import type { MediaStorage, StorageDriver } from './types.js';

export type StoredObjectRef = {
  driver: StorageDriver;
  key: string;
  visibility: MediaVisibility;
  filename: string;
  mimeType: string;
};

export type ResolvedUrl = { url: string; expiresAt: Date | null };

/**
 * The URL a client should use for a stored object. Public: the CDN/bucket base when configured, otherwise
 * Shapio's stable route. Private: always an expiring signed URL; nothing else reaches private bytes.
 */
export const resolveObjectUrl = async (
  storage: MediaStorage,
  urls: UrlBuilder,
  object: StoredObjectRef,
  ttlSeconds = MEDIA_SIGNED_URL_TTL_SECONDS,
): Promise<ResolvedUrl> => {
  const adapter = storage.get(object.driver);
  if (object.visibility === 'public') {
    return {
      url:
        adapter.publicUrl(object.key) ??
        urls.absoluteUrl(`${MEDIA_FILE_ROUTE_PREFIX}${encodeKeyPath(object.key)}`),
      expiresAt: null,
    };
  }
  const url = await adapter.signedGetUrl(object.key, {
    expiresInSeconds: ttlSeconds,
    filename: object.filename,
    contentType: object.mimeType,
  });
  return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
};
