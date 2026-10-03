import type { FastifyReply, FastifyRequest } from 'fastify';
import { toSiteActorContext } from '../helpers/requestContext.js';
import { getRequestSite } from '../plugins/siteResolution.js';
import type {
  CreateFolderBody,
  CreateUploadBody,
  ListAssetsQuery,
  MoveAssetsBody,
  ReplaceUploadBody,
  UpdateAssetBody,
  UpdateFolderBody,
} from '../routes/admin/media/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import * as mediaAssetsService from '../services/mediaAssets.js';
import * as mediaFoldersService from '../services/mediaFolders.js';
import * as mediaUploadsService from '../services/mediaUploads.js';
import { mediaContextFor } from './mediaContext.js';

const adminIdOf = (request: FastifyRequest) =>
  request.principal.kind === 'admin' ? request.principal.adminUserId : null;

// Folders

export const listFolders = async (request: FastifyRequest) => ({
  items: await mediaFoldersService.listFolders(getRequestSite(request)),
});

export const createFolder = async (
  request: FastifyRequest<{ Body: CreateFolderBody }>,
  reply: FastifyReply,
) =>
  reply
    .code(201)
    .send(await mediaFoldersService.createFolder(getRequestSite(request), adminIdOf(request), request.body));

export const updateFolder = async (request: FastifyRequest<{ Params: IdParams; Body: UpdateFolderBody }>) =>
  mediaFoldersService.updateFolder(getRequestSite(request), request.params.id, request.body);

export const deleteFolder = async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
  await mediaFoldersService.deleteFolder(toSiteActorContext(request), request.params.id);
  return reply.code(204).send();
};

// Assets

export const listAssets = async (request: FastifyRequest<{ Querystring: ListAssetsQuery }>) => {
  const { folder, mimeType, search, cursor, limit } = request.query;
  return mediaAssetsService.listAssets(mediaContextFor(request), {
    ...(folder !== undefined ? { folderId: folder === 'root' ? null : folder } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(search !== undefined ? { search } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
};

export const getAsset = async (request: FastifyRequest<{ Params: IdParams }>) =>
  mediaAssetsService.getAsset(mediaContextFor(request), request.params.id);

export const updateAsset = async (request: FastifyRequest<{ Params: IdParams; Body: UpdateAssetBody }>) =>
  mediaAssetsService.updateAsset(mediaContextFor(request), request.params.id, request.body);

export const deleteAsset = async (
  request: FastifyRequest<{ Params: IdParams; Querystring: { force?: boolean } }>,
  reply: FastifyReply,
) => {
  await mediaAssetsService.deleteAsset(
    mediaContextFor(request),
    request.params.id,
    request.query.force ?? false,
  );
  return reply.code(204).send();
};

export const moveAssets = async (request: FastifyRequest<{ Body: MoveAssetsBody }>) =>
  mediaAssetsService.moveAssets(getRequestSite(request), request.body.assetIds, request.body.folderId);

export const getAssetUsage = async (request: FastifyRequest<{ Params: IdParams }>) =>
  mediaAssetsService.listUsagesOnSite(getRequestSite(request), request.params.id);

// Uploads

export const createUpload = async (
  request: FastifyRequest<{ Body: CreateUploadBody }>,
  reply: FastifyReply,
) =>
  reply.code(201).send(await mediaUploadsService.createUploadGrant(mediaContextFor(request), request.body));

export const createReplaceUpload = async (
  request: FastifyRequest<{ Params: IdParams; Body: ReplaceUploadBody }>,
  reply: FastifyReply,
) =>
  reply
    .code(201)
    .send(
      await mediaUploadsService.createReplaceGrant(mediaContextFor(request), request.params.id, request.body),
    );

export const confirmUpload = async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
  const { created, asset } = await mediaUploadsService.confirmUpload(
    mediaContextFor(request),
    request.params.id,
  );
  return reply.code(created ? 201 : 200).send(asset);
};
