import type { FastifyRequest } from 'fastify';
import type { SnapshotChangesQuery } from '../routes/snapshots/schemas.js';
import type { ContentServiceContext } from '../services/contentAccess.js';
import * as snapshotChangesService from '../services/snapshotChanges.js';
import { contextDeferringVersion } from './delivery.js';

/**
 * The snapshot routes' content context (plan schema-lenses): a version that cannot be read or served is
 * answered only after the request succeeds without one, so a caller that may not read gets exactly the answer
 * it gets without a version (401 for an anonymous caller allowed nothing), whatever version it names.
 */
const withVersion = async <T>(
  request: FastifyRequest,
  run: (context: ContentServiceContext) => Promise<T>,
): Promise<T> => {
  const { context, versionError } = await contextDeferringVersion(request);
  if (versionError) {
    await run(context);
    throw versionError;
  }
  return run(context);
};

export const listSnapshotChanges = async (request: FastifyRequest<{ Querystring: SnapshotChangesQuery }>) =>
  withVersion(request, (context) => snapshotChangesService.listSnapshotChanges(context, request.query));

export const getCurrentSnapshot = async (request: FastifyRequest) =>
  withVersion(request, (context) => snapshotChangesService.currentSnapshot(context));
