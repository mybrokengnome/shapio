import { MEDIA_FILE_ROUTE_PREFIX, MEDIA_SIGNED_URL_TTL_SECONDS } from '../constants/media.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import { encodeKeyPath, visibilityOfKey, withVisibility, type MediaVisibility } from './keys.js';
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
  if (visibilityOfKey(object.key) !== object.visibility) {
    return resolveMovingObjectUrl(storage, urls, object, ttlSeconds);
  }
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

/**
 * An object whose visibility changed while the relocate job has not moved it yet (its key still has the old
 * prefix). Neither the old key (purged after the move) nor the bucket or CDN at the new key (empty until the
 * copy) works at every moment, so the URL goes through Shapio's own file route with the key under the new
 * prefix: the route serves whichever copy the row points at, before and after the move. Private objects get
 * a route URL signed like the local adapter's (local storage is always configured, with the same secret).
 */
const resolveMovingObjectUrl = async (
  storage: MediaStorage,
  urls: UrlBuilder,
  object: StoredObjectRef,
  ttlSeconds: number,
): Promise<ResolvedUrl> => {
  const key = withVisibility(object.key, object.visibility);
  if (object.visibility === 'public') {
    return { url: urls.absoluteUrl(`${MEDIA_FILE_ROUTE_PREFIX}${encodeKeyPath(key)}`), expiresAt: null };
  }
  const url = await storage.get('local').signedGetUrl(key, {
    expiresInSeconds: ttlSeconds,
    filename: object.filename,
    contentType: object.mimeType,
  });
  return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
};
