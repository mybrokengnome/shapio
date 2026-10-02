import type { Readable } from 'node:stream';

export const STORAGE_DRIVERS = ['local', 's3'] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

export type ObjectInfo = { size: number; contentType: string | undefined };

/** Inclusive byte range, as in an HTTP `Range: bytes=start-end` header. */
export type ByteRange = { start: number; end: number };

export type PutObjectOptions = {
  contentType: string;
  /** Required for streams: S3 needs the length up front. */
  contentLength?: number;
};

export type SignedGetOptions = {
  expiresInSeconds: number;
  /** Shown to the browser as the download name. */
  filename: string;
  contentType: string;
};

export type PresignedUploadInput = {
  key: string;
  contentType: string;
  maxSizeBytes: number;
  expiresInSeconds: number;
};

/** A browser form upload: POST `url` as multipart/form-data with `fields` first, then the file as `file`. */
export type PresignedUpload = { url: string; fields: Record<string, string> };

/**
 * One place bytes live (ADR 0001 keeps media out of the database). Keys are relative paths made by
 * media/keys.ts; adapters reject anything else. Every operation is idempotent: `put` overwrites and
 * `delete` of a missing object succeeds, so jobs can retry them.
 */
export type StorageAdapter = {
  readonly driver: StorageDriver;
  put: (key: string, body: Readable | Buffer, options: PutObjectOptions) => Promise<void>;
  getStream: (key: string, range?: ByteRange) => Promise<Readable>;
  /** Size and stored content type, or undefined when the object does not exist. */
  head: (key: string) => Promise<ObjectInfo | undefined>;
  exists: (key: string) => Promise<boolean>;
  delete: (key: string) => Promise<void>;
  /** An expiring URL that serves the object without other credentials. */
  signedGetUrl: (key: string, options: SignedGetOptions) => Promise<string>;
  /** The stable URL of a public object, or undefined when Shapio serves it (GET /api/media/f/<key>). */
  publicUrl: (key: string) => string | undefined;
  /** Direct-to-storage browser upload with size and type constraints, when the storage supports it. */
  presignedUpload?: (input: PresignedUploadInput) => Promise<PresignedUpload>;
};

/** The configured adapters: `active` takes new uploads; existing assets are read from their own driver. */
export type MediaStorage = {
  readonly active: StorageAdapter;
  /** Throws when the driver is not configured (e.g. an asset on S3 after the S3 settings were removed). */
  get: (driver: StorageDriver) => StorageAdapter;
  has: (driver: StorageDriver) => boolean;
};
