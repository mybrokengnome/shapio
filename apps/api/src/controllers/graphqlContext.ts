import type { FastifyRequest } from 'fastify';
import { getRequestPermissions } from '../plugins/requestState.js';
import { getRequestSite } from '../plugins/siteResolution.js';
import type { GraphqlRequestContext } from '../schema/codegen/graphql/context.js';
import { createGraphqlContext } from '../schema/codegen/graphql/requestContext.js';
import { contentContextFor } from './contentContext.js';

/** The context every resolver of one `/api/graphql` request receives (built after site resolution). */
export const createGraphqlRequestContext = (request: FastifyRequest): GraphqlRequestContext =>
  createGraphqlContext({
    site: getRequestSite(request),
    permissions: getRequestPermissions(request),
    content: () => contentContextFor(request),
  });
