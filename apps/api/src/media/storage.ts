import type { StorageConfig } from '../config/index.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import { createLocalAdapter } from './localAdapter.js';
import { createS3Adapter } from './s3Adapter.js';
import type { MediaStorage, StorageAdapter, StorageDriver } from './types.js';

export type MediaStorageDependencies = {
  urls: UrlBuilder;
  /** Required by the API (private URLs); jobs and the CLI never sign URLs. */
  signingSecret?: string;
};

export class StorageNotConfiguredError extends Error {
  constructor(driver: StorageDriver) {
    super(
      driver === 's3'
        ? 'Media is stored on S3 but STORAGE_S3_BUCKET is not set'
        : `Storage driver ${driver} is not configured`,
    );
    this.name = 'StorageNotConfiguredError';
  }
}

/**
 * Every adapter this instance can reach. Local disk is always available; S3 whenever its bucket is set,
 * whatever STORAGE_DRIVER says, so assets keep being served while `shapio media migrate` moves them.
 */
export const createMediaStorage = (config: StorageConfig, deps: MediaStorageDependencies): MediaStorage => {
  const adapters = new Map<StorageDriver, StorageAdapter>();
  adapters.set(
    'local',
    createLocalAdapter({
      root: config.mediaPath,
      urls: deps.urls,
      signingSecret: deps.signingSecret,
      publicBaseUrl: config.publicBaseUrl,
    }),
  );
  if (config.s3) {
    adapters.set('s3', createS3Adapter({ config: config.s3, publicBaseUrl: config.publicBaseUrl }));
  }
  const get = (driver: StorageDriver): StorageAdapter => {
    const adapter = adapters.get(driver);
    if (!adapter) {
      throw new StorageNotConfiguredError(driver);
    }
    return adapter;
  };
  return { active: get(config.driver), get, has: (driver) => adapters.has(driver) };
};
