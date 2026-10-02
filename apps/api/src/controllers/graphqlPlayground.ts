import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../helpers/appError.js';
import {
  loadPlaygroundAssets,
  renderPlaygroundPage,
  type PlaygroundAsset,
} from '../schema/codegen/graphql/playground.js';

let assets: Map<string, PlaygroundAsset> | undefined;

export const getPlaygroundPage = async (request: FastifyRequest, reply: FastifyReply) => {
  const { urls } = request.server;
  return reply.type('text/html; charset=utf-8').send(
    renderPlaygroundPage({
      assets: urls.withBasePath('/api/graphql/playground'),
      endpoint: urls.withBasePath('/api/graphql'),
      csrf: urls.withBasePath('/api/admin/auth/csrf'),
    }),
  );
};

export const getPlaygroundAsset = async (
  request: FastifyRequest<{ Params: { file: string } }>,
  reply: FastifyReply,
) => {
  assets ??= loadPlaygroundAssets();
  const asset = assets.get(request.params.file);
  if (!asset) {
    throw new AppError(404, 'NOT_FOUND', 'No such playground asset');
  }
  return reply.type(asset.contentType).header('cache-control', 'private, max-age=3600').send(asset.body);
};
