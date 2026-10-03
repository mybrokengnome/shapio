import type { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { BUNDLE_CONTENT_TYPE } from '../content/transfer/format.js';
import * as transferService from '../content/transfer/service.js';
import type { TransferContext } from '../content/transfer/service.js';
import { toSiteActorContext } from '../helpers/requestContext.js';
import type { ExportQuery, ImportQuery, MediaUploadQuery } from '../routes/admin/transfer/schemas.js';

/** The transfer service context for a request: the principal and the instance's storage and runtimes. */
const transferContextFor = (request: FastifyRequest): TransferContext => ({
  ...toSiteActorContext(request),
  db: request.server.db,
  permissions: request.server.permissions,
  storage: request.server.mediaStorage,
  // The current snapshot on every call (not the request's pin): an import's locale and schema steps must
  // each see the previous one's result.
  schemaContext: async () => ({
    db: request.server.db,
    snapshot: await request.server.schemaRegistry.getSnapshot(),
    ports: request.server.schemaContent,
    permissions: request.server.permissions,
    actor: request.principal,
    requestId: request.id,
    ip: request.ip,
  }),
  publishing: request.server.publishing,
  fieldVisibility: request.server.schemaLookup,
  log: request.log,
  maxUploadBytes: request.server.config.storage.maxUploadBytes,
});

export const exportBundle = async (
  request: FastifyRequest<{ Querystring: ExportQuery }>,
  reply: FastifyReply,
) => {
  const stream = await transferService.exportBundle(transferContextFor(request), request.query);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return reply
    .type(BUNDLE_CONTENT_TYPE)
    .header('content-disposition', `attachment; filename="shapio-export-${stamp}.ndjson"`)
    .header('cache-control', 'no-store')
    .send(stream);
};

export const importBundle = async (
  request: FastifyRequest<{ Querystring: ImportQuery }>,
  reply: FastifyReply,
) => {
  const result = await transferService.importBundle(
    transferContextFor(request),
    request.body as Readable,
    request.query,
  );
  return reply.code(result.dryRun ? 200 : 202).send(result);
};

export const getImportStatus = async (request: FastifyRequest<{ Params: { id: string } }>) =>
  transferService.getImportStatus(transferContextFor(request), request.params.id);

export const getMediaFile = async (
  request: FastifyRequest<{ Params: { assetId: string } }>,
  reply: FastifyReply,
) => {
  const file = await transferService.readMediaFile(transferContextFor(request), request.params.assetId);
  return reply
    .type('application/octet-stream')
    .header('content-length', file.sizeBytes)
    .header('cache-control', 'no-store')
    .send(file.stream);
};

export const putMediaFile = async (
  request: FastifyRequest<{ Params: { assetId: string }; Querystring: MediaUploadQuery }>,
) =>
  transferService.writeMediaFile(
    transferContextFor(request),
    request.params.assetId,
    request.body as Readable,
    request.query,
  );
