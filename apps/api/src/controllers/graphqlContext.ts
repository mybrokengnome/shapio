import type { FastifyRequest } from 'fastify';
import { getRequestPermissions } from '../plugins/requestState.js';
import { getRequestSite } from '../plugins/siteResolution.js';
import type { GraphqlRequestContext } from '../schema/codegen/graphql/context.js';
import { createGraphqlContext } from '../schema/codegen/graphql/requestContext.js';
import type { ContentServiceContext } from '../services/contentAccess.js';
import { contentContextFor } from './contentContext.js';

/**
 * The context every resolver of one `/api/graphql` request receives (built after site resolution). `lensed`:
 * the content context of a request naming a schema version, already built with its lens.
 */
export const createGraphqlRequestContext = (
  request: FastifyRequest,
  lensed?: ContentServiceContext,
): GraphqlRequestContext =>
  createGraphqlContext({
    site: getRequestSite(request),
    permissions: getRequestPermissions(request),
    content: () => contentContextFor(request),
    ...(lensed ? { lensed } : {}),
  });
