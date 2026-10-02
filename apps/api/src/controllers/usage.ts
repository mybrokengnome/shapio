import type { FastifyRequest } from 'fastify';
import { getRequestSchema } from '../plugins/schemaSnapshot.js';
import type { FieldUsageQuery } from '../routes/admin/usage/schemas.js';
import * as usageService from '../services/usage.js';

export const getFieldUsage = async (request: FastifyRequest<{ Querystring: FieldUsageQuery }>) => {
  const { config } = request.server;
  const days = Math.min(request.query.days ?? usageService.DEFAULT_USAGE_DAYS, config.usage.retentionDays);
  const usage = await usageService.modelUsage(await getRequestSchema(request), request.query.modelId, days);
  return { tracking: config.usage.enabled, ...usage };
};
