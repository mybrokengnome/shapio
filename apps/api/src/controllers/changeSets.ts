import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  AddEntryItemBody,
  CreateChangeSetBody,
  DraftParams,
  ItemParams,
  ListChangeSetsQuery,
  ListUnassignedQuery,
  PutSchemaDraftBody,
  ScheduleBody,
  ShipBody,
  UpdateChangeSetBody,
} from '../routes/admin/changeSets/schemas.js';
import type { ListSnapshotsQuery, SeqParams } from '../routes/admin/snapshots/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import { getTimeline, listUnassigned } from '../services/changeSetActivity.js';
import { deleteSchemaDraft, getSchemaDraft, putSchemaDraft } from '../services/changeSetDrafts.js';
import { getChangeSetReview } from '../services/changeSetReview.js';
import * as changeSetsService from '../services/changeSets.js';
import type { ChangeSetServiceContext } from '../services/changeSets.js';
import { scheduleChangeSet, shipChangeSet, unscheduleChangeSet } from '../services/changeSetShipping.js';
import { restoreSnapshot } from '../services/snapshotRestore.js';
import { getSnapshot, listSnapshots } from '../services/snapshots.js';
import { contentContextFor } from './contentContext.js';

/** The content service context plus the schema content ports (review impact, ship prerequisites). */
const contextFor = async (request: FastifyRequest): Promise<ChangeSetServiceContext> => ({
  ...(await contentContextFor(request)),
  ports: request.server.schemaContent,
});

type ById = FastifyRequest<{ Params: IdParams }>;

export const listChangeSets = async (request: FastifyRequest<{ Querystring: ListChangeSetsQuery }>) =>
  changeSetsService.listChangeSets(await contextFor(request), request.query);

export const getChangeSet = async (request: ById) =>
  changeSetsService.getChangeSet(await contextFor(request), request.params.id);

export const createChangeSet = async (
  request: FastifyRequest<{ Body: CreateChangeSetBody }>,
  reply: FastifyReply,
) => reply.code(201).send(await changeSetsService.createChangeSet(await contextFor(request), request.body));

export const updateChangeSet = async (
  request: FastifyRequest<{ Params: IdParams; Body: UpdateChangeSetBody }>,
) => changeSetsService.updateChangeSet(await contextFor(request), request.params.id, request.body);

export const discardChangeSet = async (request: ById) =>
  changeSetsService.discardChangeSet(await contextFor(request), request.params.id);

export const addEntryItem = async (request: FastifyRequest<{ Params: IdParams; Body: AddEntryItemBody }>) =>
  changeSetsService.addEntryItem(await contextFor(request), request.params.id, request.body);

export const removeItem = async (request: FastifyRequest<{ Params: ItemParams }>) =>
  changeSetsService.removeItem(await contextFor(request), request.params.id, request.params.itemId);

export const getDraft = async (request: FastifyRequest<{ Params: DraftParams }>) =>
  getSchemaDraft(await contextFor(request), request.params.id, request.params.definitionId);

export const putDraft = async (request: FastifyRequest<{ Params: DraftParams; Body: PutSchemaDraftBody }>) =>
  putSchemaDraft(await contextFor(request), request.params.id, request.params.definitionId, request.body);

export const deleteDraft = async (request: FastifyRequest<{ Params: DraftParams }>) =>
  deleteSchemaDraft(await contextFor(request), request.params.id, request.params.definitionId);

export const getReview = async (request: ById) =>
  getChangeSetReview(await contextFor(request), request.params.id);

/** 200 when the ship finished in the request (shipped or failed), 202 when a job finishes it. */
export const ship = async (
  request: FastifyRequest<{ Params: IdParams; Body: ShipBody }>,
  reply: FastifyReply,
) => {
  const outcome = await shipChangeSet(await contextFor(request), request.params.id, request.body);
  return reply.code(outcome.inline ? 200 : 202).send(outcome.view);
};

export const schedule = async (request: FastifyRequest<{ Params: IdParams; Body: ScheduleBody }>) =>
  scheduleChangeSet(await contextFor(request), request.params.id, {
    ...request.body,
    at: new Date(request.body.at),
  });

export const unschedule = async (request: ById) =>
  unscheduleChangeSet(await contextFor(request), request.params.id);

export const getChangeSetTimeline = async (request: ById) => ({
  items: await getTimeline(await contextFor(request), request.params.id),
});

export const getUnassigned = async (request: FastifyRequest<{ Querystring: ListUnassignedQuery }>) =>
  listUnassigned(await contextFor(request), request.query);

export const getSnapshots = async (request: FastifyRequest<{ Querystring: ListSnapshotsQuery }>) =>
  listSnapshots(await contextFor(request), request.query);

export const getSnapshotBySeq = async (request: FastifyRequest<{ Params: SeqParams }>) =>
  getSnapshot(await contextFor(request), request.params.seq);

export const restore = async (request: FastifyRequest<{ Params: SeqParams }>, reply: FastifyReply) =>
  reply.code(201).send(await restoreSnapshot(await contextFor(request), request.params.seq));
