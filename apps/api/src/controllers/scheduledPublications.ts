import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CreateScheduleBody, ListSchedulesQuery } from '../routes/admin/publishing/schedules/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import * as scheduledPublicationsService from '../services/scheduledPublications.js';
import { contentContextFor } from './contentContext.js';

export const listSchedules = async (request: FastifyRequest<{ Querystring: ListSchedulesQuery }>) =>
  scheduledPublicationsService.listSchedules(await contentContextFor(request), request.query, {
    canSeeAll: await request.server.permissions.canPerform(request.principal, 'publishing.manage'),
  });

export const createSchedule = async (
  request: FastifyRequest<{ Body: CreateScheduleBody }>,
  reply: FastifyReply,
) => {
  const { runAt, ...target } = request.body;
  const created = await scheduledPublicationsService.createSchedule(await contentContextFor(request), {
    ...target,
    runAt: new Date(runAt),
  });
  return reply.code(201).send(created);
};

export const cancelSchedule = async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
  await scheduledPublicationsService.cancelSchedule(await contentContextFor(request), request.params.id);
  return reply.code(204).send();
};
