import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { MEDIA_FILE_ROUTE_PREFIX } from '../constants/media.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import { InvalidStorageKeyError, ObjectNotFoundError } from './errors.js';
import { encodeKeyPath, isValidStorageKey } from './keys.js';
import { signMediaGet } from './signing.js';
import type { StorageAdapter } from './types.js';

export type LocalAdapterOptions = {
  /** MEDIA_PATH, absolute. */
  root: string;
  urls: UrlBuilder;
  /** Needed to sign private URLs; jobs and the CLI never sign, so they may omit it. */
  signingSecret: string | undefined;
  publicBaseUrl: string | undefined;
};

const isNotFound = (error: unknown) =>
  error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';

/**
 * Files under MEDIA_PATH, served by Shapio itself: public objects at a stable URL, private ones only with
 * an HMAC-signed, expiring URL. Writes go to a temporary file and are renamed into place, so a reader never
 * sees half a file.
 */
export const createLocalAdapter = ({
  root,
  urls,
  signingSecret,
  publicBaseUrl,
}: LocalAdapterOptions): StorageAdapter => {
  const pathOf = (key: string): string => {
    const path = resolve(root, key);
    if (!isValidStorageKey(key) || relative(root, path).startsWith('..') || !path.startsWith(root + sep)) {
      throw new InvalidStorageKeyError(key);
    }
    return path;
  };

  const statOrThrow = async (key: string) => {
    try {
      return await stat(pathOf(key));
    } catch (error) {
      throw isNotFound(error) ? new ObjectNotFoundError(key, { cause: error }) : error;
    }
  };

  /** Removes now-empty directories up to the asset folder; a non-empty one stops the walk. */
  const pruneEmptyParents = async (path: string) => {
    let directory = dirname(path);
    while (directory.startsWith(root + sep) && relative(root, directory).split(sep).length > 1) {
      try {
        await rmdir(directory);
      } catch {
        return;
      }
      directory = dirname(directory);
    }
  };

  return {
    driver: 'local',
    put: async (key, body) => {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        if (Buffer.isBuffer(body)) {
          await writeFile(temporary, body);
        } else {
          await pipeline(body, createWriteStream(temporary));
        }
        await rename(temporary, path);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    },
    getStream: async (key, range) => {
      await statOrThrow(key);
      return createReadStream(pathOf(key), range ? { start: range.start, end: range.end } : {});
    },
    head: async (key) => {
      try {
        const info = await statOrThrow(key);
        return { size: info.size, contentType: undefined };
      } catch (error) {
        if (error instanceof ObjectNotFoundError) {
          return undefined;
        }
        throw error;
      }
    },
    exists: async (key) => {
      try {
        await statOrThrow(key);
        return true;
      } catch (error) {
        if (error instanceof ObjectNotFoundError) {
          return false;
        }
        throw error;
      }
    },
    delete: async (key) => {
      const path = pathOf(key);
      await rm(path, { force: true });
      await pruneEmptyParents(path);
    },
    signedGetUrl: async (key, { expiresInSeconds }) => {
      if (!signingSecret) {
        throw new Error('The local media adapter was created without a signing secret');
      }
      pathOf(key);
      const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
      const signature = signMediaGet(signingSecret, key, expiresAt);
      return urls.absoluteUrl(
        `${MEDIA_FILE_ROUTE_PREFIX}${encodeKeyPath(key)}?expires=${expiresAt}&signature=${signature}`,
      );
    },
    publicUrl: (key) => (publicBaseUrl ? `${publicBaseUrl}/${encodeKeyPath(key)}` : undefined),
  };
};
