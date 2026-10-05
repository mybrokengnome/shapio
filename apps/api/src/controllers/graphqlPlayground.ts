import type { FastifyReply, FastifyRequest } from 'fastify';
import { SITE_QUERY_PARAMETER } from '../constants/sites.js';
import { AppError } from '../helpers/appError.js';
import {
  loadPlaygroundAssets,
  renderPlaygroundPage,
  type PlaygroundAsset,
  type PlaygroundTheme,
} from '../schema/codegen/graphql/playground.js';

let assets: Map<string, PlaygroundAsset> | undefined;

type PlaygroundPageRequest = FastifyRequest<{
  Querystring: { site?: string; query?: string; theme?: PlaygroundTheme };
}>;

/**
 * The page is a network route; `?site=` only chooses the site its GraphQL requests name (`?site=` on the
 * endpoint). `?query=` opens the editor on that operation, `?theme=light|dark` fixes GraphiQL's theme.
 */
export const getPlaygroundPage = async (request: PlaygroundPageRequest, reply: FastifyReply) => {
  const { urls } = request.server;
  const endpoint = urls.withBasePath('/api/graphql');
  const { site, query, theme } = request.query;
  return reply.type('text/html; charset=utf-8').send(
    renderPlaygroundPage(
      {
        assets: urls.withBasePath('/api/graphql/playground'),
        endpoint:
          site === undefined ? endpoint : `${endpoint}?${SITE_QUERY_PARAMETER}=${encodeURIComponent(site)}`,
        csrf: urls.withBasePath('/api/admin/auth/csrf'),
      },
      { query, theme },
    ),
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
