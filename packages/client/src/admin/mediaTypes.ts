/** Media library types (package G, `apps/api/src/routes/admin/media/schemas.ts`). Dates are ISO-8601 strings. */

export type MediaVisibility = 'public' | 'private';
export type MediaAssetStatus = 'processing' | 'ready' | 'failed';
export type MediaVariantStatus = 'pending' | 'ready' | 'failed';
export type MediaStorageDriver = 'local' | 's3';

export type MediaFocalPoint = { x: number; y: number };

export type MediaVariant = {
  name: string;
  width: number | null;
  height: number | null;
  format: string;
  mimeType: string;
  sizeBytes: number | null;
  status: MediaVariantStatus;
  /** Present once the variant is ready. */
  url: string | null;
};

export type MediaAsset = {
  id: string;
  folderId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  checksumSha256: string | null;
  alt: string;
  caption: string;
  focalPoint: MediaFocalPoint | null;
  visibility: MediaVisibility;
  /** `processing` until the checksum, dimensions and variants are done. */
  status: MediaAssetStatus;
  processingError: string | null;
  storageDriver: MediaStorageDriver;
  /** Stable for public assets; signed and expiring (`urlExpiresAt`) for private ones. */
  url: string;
  urlExpiresAt: string | null;
  variants: MediaVariant[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type MediaAssetQuery = {
  /** A folder ID, or `root` for assets in no folder. Omit for every folder. */
  folder?: string;
  /** `image/png` or `image/*`. */
  mimeType?: string;
  search?: string;
  cursor?: string;
  limit?: number;
};

export type MediaAssetPage = { items: MediaAsset[]; nextCursor: string | null };

export type UpdateMediaAssetInput = {
  expectedVersion: number;
  alt?: string;
  caption?: string;
  filename?: string;
  focalPoint?: MediaFocalPoint | null;
  folderId?: string | null;
  /** Needs `media.manage`. */
  visibility?: MediaVisibility;
};

export type MoveMediaAssetsInput = { assetIds: string[]; folderId: string | null };
export type MoveMediaAssetsResult = { moved: string[]; skipped: string[] };

export type MediaUsage = {
  entryId: string;
  modelId: string;
  fieldId: string;
  locale: string;
  state: 'draft' | 'published';
  since: string;
};

export type MediaUsagePage = { items: MediaUsage[]; total: number };

export type MediaFolder = {
  id: string;
  parentId: string | null;
  name: string;
  assetCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateMediaFolderInput = { name: string; parentId?: string | null };
export type UpdateMediaFolderInput = { expectedVersion: number; name?: string; parentId?: string | null };

export type CreateUploadInput = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  folderId?: string | null;
  visibility?: MediaVisibility;
};

export type ReplaceUploadInput = { filename: string; mimeType: string; sizeBytes: number };

/**
 * Step 1 of an upload. Send the file as `multipart/form-data` to `upload.url`: every entry of `fields`
 * first, then the file as `fileField` (see `buildUploadForm`). The same for every storage driver: the URL
 * is either the bucket (presigned POST) or Shapio's own upload route. Then call `uploads.confirm`.
 */
export type UploadGrant = {
  grantId: string;
  assetId: string;
  expiresAt: string;
  maxSizeBytes: number;
  upload: { method: 'POST'; url: string; fields: Record<string, string>; fileField: 'file' };
};
