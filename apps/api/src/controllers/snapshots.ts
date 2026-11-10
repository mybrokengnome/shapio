import type { FastifyRequest } from 'fastify';
import type { SnapshotChangesQuery } from '../routes/snapshots/schemas.js';
import { loadSchemaLens, namesSchemaVersion, type ContentServiceContext } from '../services/contentAccess.js';
import * as snapshotChangesService from '../services/snapshotChanges.js';
import { contextDeferringVersion } from './delivery.js';

/**
 * The context of a snapshot request: a schema version it names is read only once the caller may read the
 * workspace's snapshots (the check every snapshot route makes, without a version), so a caller that may not gets
 * exactly the answer it gets without one (plan schema-lenses).
 */
const snapshotContextOf = async (request: FastifyRequest): Promise<ContentServiceContext> => {
  const { context, versionError } = await contextDeferringVersion(request);
  if (!versionError && !namesSchemaVersion(context)) {
    return context;
  }
  // The snapshot routes' own check (401 for an anonymous caller that may read nothing), without a version.
  await snapshotChangesService.currentSnapshot(context);
  if (versionError) {
    throw versionError;
  }
  return loadSchemaLens(context);
};

export const listSnapshotChanges = async (request: FastifyRequest<{ Querystring: SnapshotChangesQuery }>) =>
  snapshotChangesService.listSnapshotChanges(await snapshotContextOf(request), request.query);

export const getCurrentSnapshot = async (request: FastifyRequest) =>
  snapshotChangesService.currentSnapshot(await snapshotContextOf(request));
