import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3StorageConfig } from '../config/index.js';
import { bucketContentDisposition, contentDisposition } from './contentDisposition.js';
import { InvalidStorageKeyError, ObjectNotFoundError } from './errors.js';
import { encodeKeyPath, isValidStorageKey } from './keys.js';
import type { StorageAdapter } from './types.js';

/** R2 accepts any region name ("auto" by convention); AWS needs the bucket's real region. */
const DEFAULT_REGION = 'us-east-1';

const isNotFound = (error: unknown): boolean =>
  error instanceof S3ServiceException &&
  (error.$metadata.httpStatusCode === 404 || error.name === 'NotFound' || error.name === 'NoSuchKey');

export const createS3Client = (config: S3StorageConfig): S3Client =>
  new S3Client({
    region: config.region ?? DEFAULT_REGION,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: config.forcePathStyle,
    ...(config.accessKeyId && config.secretAccessKey
      ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
      : {}),
    // Only send/validate checksums when an operation requires them: several S3-compatible services
    // (R2, B2 and other gateways) reject the SDK's default streaming CRC32 trailers.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

export type S3AdapterOptions = {
  config: S3StorageConfig;
  publicBaseUrl: string | undefined;
  /** Injected in tests; created from `config` otherwise. */
  client?: S3Client;
};

/**
 * Any S3-compatible service (AWS S3, Cloudflare R2, B2, Spaces, Wasabi, versitygw). Private objects are read
 * through presigned GET URLs; browsers upload straight to the bucket with a presigned POST whose policy
 * limits size and content type, so Shapio never streams upload bytes.
 */
export const createS3Adapter = ({ config, publicBaseUrl, client }: S3AdapterOptions): StorageAdapter => {
  const s3 = client ?? createS3Client(config);
  const Bucket = config.bucket;
  const checkKey = (key: string) => {
    if (!isValidStorageKey(key)) {
      throw new InvalidStorageKeyError(key);
    }
    return key;
  };

  const head = async (key: string) => {
    try {
      const result = await s3.send(new HeadObjectCommand({ Bucket, Key: checkKey(key) }));
      return { size: result.ContentLength ?? 0, contentType: result.ContentType };
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  };

  return {
    driver: 's3',
    put: async (key, body, { contentType, contentLength }) => {
      await s3.send(
        new PutObjectCommand({
          Bucket,
          Key: checkKey(key),
          Body: body,
          ContentType: contentType,
          ContentLength: Buffer.isBuffer(body) ? body.length : contentLength,
          ContentDisposition: bucketContentDisposition(contentType),
        }),
      );
    },
    getStream: async (key, range) => {
      try {
        const result = await s3.send(
          new GetObjectCommand({
            Bucket,
            Key: checkKey(key),
            ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
          }),
        );
        if (!result.Body) {
          throw new ObjectNotFoundError(key);
        }
        return result.Body as Readable;
      } catch (error) {
        throw isNotFound(error) ? new ObjectNotFoundError(key, { cause: error }) : error;
      }
    },
    head,
    exists: async (key) => (await head(key)) !== undefined,
    delete: async (key) => {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: checkKey(key) }));
    },
    signedGetUrl: async (key, { expiresInSeconds, filename, contentType }) =>
      getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket,
          Key: checkKey(key),
          ResponseContentType: contentType,
          ResponseContentDisposition: contentDisposition(filename),
        }),
        { expiresIn: expiresInSeconds },
      ),
    publicUrl: (key) => (publicBaseUrl ? `${publicBaseUrl}/${encodeKeyPath(checkKey(key))}` : undefined),
    presignedUpload: async ({ key, contentType, maxSizeBytes, expiresInSeconds }) => {
      const disposition = bucketContentDisposition(contentType);
      const { url, fields } = await createPresignedPost(s3, {
        Bucket,
        Key: checkKey(key),
        Conditions: [
          ['content-length-range', 1, maxSizeBytes],
          ['eq', '$Content-Type', contentType],
          ...(disposition ? [['eq', '$Content-Disposition', disposition] as ['eq', string, string]] : []),
        ],
        Fields: {
          'Content-Type': contentType,
          ...(disposition ? { 'Content-Disposition': disposition } : {}),
        },
        Expires: expiresInSeconds,
      });
      return { url, fields };
    },
  };
};
