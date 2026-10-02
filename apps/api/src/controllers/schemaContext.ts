import type { FastifyRequest } from 'fastify';
import { getRequestSchema } from '../plugins/schemaSnapshot.js';
import type { SchemaChangeJobRow } from '../repositories/schemaChangeJobs.js';
import type { ActiveDefinition } from '../schema/snapshot.js';
import type { SchemaServiceContext } from '../services/schemaAccess.js';

/** Builds the service context for a schema request: the pinned snapshot, the principal and dependencies. */
export const schemaContextFor = async (request: FastifyRequest): Promise<SchemaServiceContext> => ({
  db: request.server.db,
  snapshot: await getRequestSchema(request),
  ports: request.server.schemaContent,
  permissions: request.server.permissions,
  actor: request.principal,
  requestId: request.id,
  ip: request.ip,
});

export const toActiveDefinitionResponse = (active: ActiveDefinition) => ({
  definition: active.definition,
  version: active.version,
  hash: active.hash,
  revisionId: active.revisionId,
  activatedAt: active.activatedAt.toISOString(),
});

export const toChangeJobResponse = (row: SchemaChangeJobRow) => ({
  id: row.id,
  targetType: row.target_type,
  targetId: row.target_id,
  status: row.status,
  fromRevisionId: row.from_revision_id,
  toRevisionId: row.to_revision_id,
  jobId: row.job_id,
  error: row.error,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  finishedAt: row.finished_at?.toISOString() ?? null,
});
