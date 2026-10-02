import type { StorageConfig } from '../config/index.js';
import { createS3Adapter } from './s3Adapter.js';

const SAMPLE_KEY = 'public/00000000-0000-0000-0000-000000000000/sample/origin-probe';

const originOf = (url: string | undefined): string | undefined => {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Origins outside PUBLIC_URL that the admin loads media from or uploads to: the CDN/public base, and the
 * bucket's endpoint as the S3 SDK addresses it (path-style or virtual-hosted), found by presigning a
 * sample request, which is local computation with no network call. The Content-Security-Policy allows
 * these for images, media and uploads.
 */
export const resolveMediaOrigins = async (storage: StorageConfig): Promise<string[]> => {
  const origins = new Set<string>();
  const base = originOf(storage.publicBaseUrl);
  if (base) {
    origins.add(base);
  }
  if (storage.s3) {
    const adapter = createS3Adapter({ config: storage.s3, publicBaseUrl: undefined });
    const signed = await adapter.signedGetUrl(SAMPLE_KEY, {
      expiresInSeconds: 60,
      filename: 'probe',
      contentType: 'application/octet-stream',
    });
    const upload = await adapter.presignedUpload?.({
      key: SAMPLE_KEY,
      contentType: 'application/octet-stream',
      maxSizeBytes: 1,
      expiresInSeconds: 60,
    });
    for (const origin of [originOf(signed), originOf(upload?.url)]) {
      if (origin) {
        origins.add(origin);
      }
    }
  }
  return [...origins];
};
