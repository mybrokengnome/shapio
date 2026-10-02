import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { StorageConfig } from '../config/index.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import { createMediaStorage } from '../media/storage.js';
import type { MediaStorage } from '../media/types.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Media storage adapters (local disk always, S3 when configured); see media/storage.ts. */
    mediaStorage: MediaStorage;
  }
}

type MediaStoragePluginOptions = { storage: StorageConfig; urls: UrlBuilder; signingSecret: string };

/** Exposes the media storage adapters to routes. Registered after the signing secret is resolved. */
export const mediaStoragePlugin = fp<MediaStoragePluginOptions>(
  async (app: FastifyInstance, { storage, urls, signingSecret }) => {
    app.decorate('mediaStorage', createMediaStorage(storage, { urls, signingSecret }));
  },
  { name: 'shapio-media-storage' },
);
