import type { FastifyReply, FastifyRequest } from 'fastify';
import { toActorContext } from '../helpers/requestContext.js';
import type { CreateSiteBody, UpdateSiteBody } from '../routes/admin/sites/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import { requireAdminOrAdminToken } from '../services/auth.js';
import * as sitesService from '../services/sites.js';

/** Sites are listed for admin principals only (`requireAdmin` guards the routes). */
const adminPrincipalOf = (request: FastifyRequest) => requireAdminOrAdminToken(request.principal);

export const listSites = async (request: FastifyRequest) => sitesService.listSites(adminPrincipalOf(request));

export const getSite = async (request: FastifyRequest<{ Params: IdParams }>) =>
  sitesService.getSite(adminPrincipalOf(request), request.params.id);

export const createSite = async (request: FastifyRequest<{ Body: CreateSiteBody }>, reply: FastifyReply) =>
  reply.code(201).send(await sitesService.createSite(toActorContext(request), request.body));

export const updateSite = async (request: FastifyRequest<{ Params: IdParams; Body: UpdateSiteBody }>) =>
  sitesService.renameSite(toActorContext(request), request.params.id, request.body);

export const deleteSite = async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
  await sitesService.deleteSite(toActorContext(request), request.params.id);
  return reply.code(204).send();
};
