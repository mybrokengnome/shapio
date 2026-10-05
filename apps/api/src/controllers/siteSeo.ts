import type { FastifyRequest } from 'fastify';
import { toSiteActorContext } from '../helpers/requestContext.js';
import { getRequestPermissions } from '../plugins/requestState.js';
import { getRequestSchema } from '../plugins/schemaSnapshot.js';
import type { UpdateSiteSeoBody } from '../routes/admin/site/schemas.js';
import * as siteSeoService from '../services/siteSeo.js';

const contextFor = async (request: FastifyRequest): Promise<siteSeoService.SiteSeoContext> => ({
  ...toSiteActorContext(request),
  db: request.server.db,
  snapshot: await getRequestSchema(request),
  permissions: getRequestPermissions(request),
});

export const getSiteSeo = async (request: FastifyRequest) =>
  siteSeoService.getSiteSeo(await contextFor(request));

export const updateSiteSeo = async (request: FastifyRequest<{ Body: UpdateSiteSeoBody }>) =>
  siteSeoService.updateSiteSeo(await contextFor(request), request.body);
