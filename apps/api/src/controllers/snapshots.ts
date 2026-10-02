import type { FastifyRequest } from 'fastify';
import type { SnapshotChangesQuery } from '../routes/snapshots/schemas.js';
import * as snapshotChangesService from '../services/snapshotChanges.js';
import { contentContextFor } from './contentContext.js';

export const listSnapshotChanges = async (request: FastifyRequest<{ Querystring: SnapshotChangesQuery }>) =>
  snapshotChangesService.listSnapshotChanges(await contentContextFor(request), request.query);

export const getCurrentSnapshot = async (request: FastifyRequest) =>
  snapshotChangesService.currentSnapshot(await contentContextFor(request));
