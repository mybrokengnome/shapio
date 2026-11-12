import type { FastifyRequest } from 'fastify';
import { getRequestSchema } from '../plugins/schemaSnapshot.js';
import { getRequestSite } from '../plugins/siteResolution.js';
import type { FieldUsageQuery } from '../routes/admin/usage/schemas.js';
import * as usageService from '../services/usage.js';

export const getFieldUsage = async (request: FastifyRequest<{ Querystring: FieldUsageQuery }>) => {
  const { config } = request.server;
  const days = Math.min(request.query.days ?? usageService.DEFAULT_USAGE_DAYS, config.usage.retentionDays);
  const usage = await usageService.modelUsage(
    await getRequestSchema(request),
    getRequestSite(request),
    request.query.modelId,
    days,
  );
  return { tracking: config.usage.enabled, ...usage };
};

/** `GET /api/admin/usage/schema-versions`: the schema version each reader of the workspace names now. */
export const getSchemaVersions = async (request: FastifyRequest) => ({
  tracking: request.server.config.usage.enabled,
  principals: await usageService.schemaVersionReaders(getRequestSite(request)),
});
