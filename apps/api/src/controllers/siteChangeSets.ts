import type { FastifyRequest } from 'fastify';
import { toSiteActorContext } from '../helpers/requestContext.js';
import type { UpdateSiteChangeSetsBody } from '../routes/admin/site/schemas.js';
import * as siteChangeSetsService from '../services/siteChangeSets.js';

const contextFor = (request: FastifyRequest): siteChangeSetsService.SiteChangeSetsContext => ({
  ...toSiteActorContext(request),
  db: request.server.db,
});

export const getSiteChangeSets = async (request: FastifyRequest) =>
  siteChangeSetsService.getSiteChangeSets(contextFor(request));

export const updateSiteChangeSets = async (request: FastifyRequest<{ Body: UpdateSiteChangeSetsBody }>) =>
  siteChangeSetsService.updateSiteChangeSets(contextFor(request), request.body);
