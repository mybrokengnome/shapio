import type { FastifyRequest } from 'fastify';
import type { Principal } from '../permissions/types.js';
import { getRequestSite } from '../plugins/siteResolution.js';
import type { GraphqlRequestContext } from '../schema/codegen/graphql/context.js';
import { createLoaders } from '../schema/codegen/graphql/loaders.js';
import { memoizePermissions } from '../schema/codegen/graphql/permissions.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import type { ContentServiceContext } from '../services/contentAccess.js';
import { contentContextFor } from './contentContext.js';

/** Admin users and admin-scope API tokens: may read drafts. */
const isAdminPrincipal = (principal: Principal) =>
  principal.kind === 'admin' || (principal.kind === 'token' && principal.scope === 'admin');

/** The context every resolver of one `/api/graphql` request receives (built after site resolution). */
export const createGraphqlRequestContext = (request: FastifyRequest): GraphqlRequestContext => {
  const site = getRequestSite(request);
  const permissions = memoizePermissions(request.server.permissions, request.principal);
  let base: Promise<ContentServiceContext> | undefined;
  const content = async (snapshot: SchemaSnapshot): Promise<ContentServiceContext> => {
    base ??= contentContextFor(request);
    return { ...(await base), snapshot, permissions };
  };
  return {
    request,
    permissions,
    isAdmin: isAdminPrincipal(request.principal),
    site,
    loaders: createLoaders(() => site.id, content),
    content,
  };
};
