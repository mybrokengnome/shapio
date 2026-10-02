import type { FastifyRequest } from 'fastify';
import { toActorContext } from '../helpers/requestContext.js';
import type { ListJobsQuery } from '../routes/admin/publishing/jobs/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import * as jobsAdminService from '../services/jobsAdmin.js';

export const listJobs = async (request: FastifyRequest<{ Querystring: ListJobsQuery }>) =>
  jobsAdminService.listJobs(request.query);

export const summarizeJobs = async () => jobsAdminService.summarizeJobs();

export const getJob = async (request: FastifyRequest<{ Params: IdParams }>) =>
  jobsAdminService.getJob(request.params.id);

export const retryJob = async (request: FastifyRequest<{ Params: IdParams }>) =>
  jobsAdminService.retryJob(toActorContext(request), request.params.id);
