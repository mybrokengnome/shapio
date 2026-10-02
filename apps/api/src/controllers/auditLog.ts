import type { FastifyRequest } from 'fastify';
import type { ListAuditQuery } from '../routes/admin/audit/schemas.js';
import * as auditLogService from '../services/auditLog.js';

export const listAuditEvents = async (request: FastifyRequest<{ Querystring: ListAuditQuery }>) => {
  const { cursor, limit, from, to, ...filter } = request.query;
  return auditLogService.listAuditEvents(
    { ...filter, ...(from ? { from: new Date(from) } : {}), ...(to ? { to: new Date(to) } : {}) },
    { ...(cursor ? { cursor } : {}), ...(limit ? { limit } : {}) },
  );
};
