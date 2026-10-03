import type { FastifyRequest } from 'fastify';
import { toActorContext } from '../helpers/requestContext.js';
import type { SetSiteAppRolesBody } from '../routes/admin/sites/appRoleSchemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import { requireAdminOrAdminToken } from '../services/auth.js';
import * as siteAppRolesService from '../services/siteAppRoles.js';

export const getSiteAppRoles = async (request: FastifyRequest<{ Params: IdParams }>) =>
  siteAppRolesService.getSiteAppRoles(requireAdminOrAdminToken(request.principal), request.params.id);

export const setSiteAppRoles = async (
  request: FastifyRequest<{ Params: IdParams; Body: SetSiteAppRolesBody }>,
) => siteAppRolesService.setSiteAppRoles(toActorContext(request), request.params.id, request.body);
