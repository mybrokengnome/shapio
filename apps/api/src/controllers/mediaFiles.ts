import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../helpers/appError.js';
import { parseByteRange } from '../helpers/httpRange.js';
import { contentDisposition } from '../media/contentDisposition.js';
import { authorizeMediaFile, openMediaFile, type ServableFile } from '../services/mediaFiles.js';
import { receiveLocalUpload } from '../services/mediaUploads.js';

type GetFileRequest = FastifyRequest<{
  Params: { '*': string };
  Querystring: { expires?: number; signature?: string };
}>;

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Public keys change on every upload, so their URLs can be cached forever; signed ones until expiry. */
const cacheControlFor = (file: ServableFile): string =>
  file.expiresAt === undefined
    ? `public, max-age=${ONE_YEAR_SECONDS}, immutable`
    : `private, max-age=${Math.max(0, file.expiresAt - Math.floor(Date.now() / 1000))}`;

export const getMediaFile = async (request: GetFileRequest, reply: FastifyReply) => {
  const file = await authorizeMediaFile(request.server.signingSecret, request.params['*'], request.query);
  const range = parseByteRange(request.headers.range, file.sizeBytes);
  if (range === 'unsatisfiable') {
    reply.header('content-range', `bytes */${file.sizeBytes}`);
    throw new AppError(416, 'RANGE_NOT_SATISFIABLE', 'The requested range is outside the file');
  }
  const stream = await openMediaFile(request.server.mediaStorage, file, range);
  reply
    .header('content-type', file.mimeType)
    .header('content-disposition', contentDisposition(file.filename))
    .header('cache-control', cacheControlFor(file))
    .header('accept-ranges', 'bytes')
    .header('x-content-type-options', 'nosniff')
    // A headless CMS's media is embedded by other origins (the user's sites, the admin's dev server).
    // Helmet's same-origin default would block every cross-origin <img>; for private files the signature,
    // not the embedding origin, is the access control.
    .header('cross-origin-resource-policy', 'cross-origin')
    // Uploaded files never run as a page on this origin (an SVG or HTML file cannot script the admin).
    .header(
      'content-security-policy',
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    );
  if (range) {
    reply
      .code(206)
      .header('content-range', `bytes ${range.start}-${range.end}/${file.sizeBytes}`)
      .header('content-length', range.end - range.start + 1);
  } else {
    reply.header('content-length', file.sizeBytes);
  }
  return reply.send(stream);
};

type ReceiveUploadRequest = FastifyRequest<{ Params: { grantId: string } }>;

const fieldValue = (field: unknown): string | undefined => {
  const value = (Array.isArray(field) ? field[0] : field) as { type?: string; value?: unknown } | undefined;
  return value?.type === 'field' && typeof value.value === 'string' ? value.value : undefined;
};

/** Local driver: the browser's form upload of a grant's bytes (fields first, then `file`). */
export const receiveUpload = async (request: ReceiveUploadRequest, reply: FastifyReply) => {
  if (!request.isMultipart()) {
    throw new AppError(415, 'MULTIPART_REQUIRED', 'Send the upload as multipart/form-data');
  }
  await receiveLocalUpload(
    { storage: request.server.mediaStorage, signingSecret: request.server.signingSecret },
    request.params.grantId,
    async (maxSizeBytes) => {
      const part = await request.file({
        limits: { fileSize: maxSizeBytes, files: 1, fields: 10, fieldSize: 1024 },
      });
      if (!part || part.fieldname !== 'file') {
        part?.file.resume();
        return undefined;
      }
      return {
        fields: {
          'Content-Type': fieldValue(part.fields['Content-Type']),
          expires: fieldValue(part.fields.expires),
          signature: fieldValue(part.fields.signature),
        },
        file: part.file,
        truncated: () => part.file.truncated,
      };
    },
  );
  return reply.code(204).send();
};
