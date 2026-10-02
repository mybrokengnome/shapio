import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import * as handlers from '../../../../controllers/jobsAdmin.js';
import { getJobSchema, jobsSummarySchema, listJobsSchema, retryJobSchema } from './schemas.js';

/** /api/admin/jobs: the queue as admins see it (payloads redacted), and retrying dead jobs. */
export const adminJobsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const manage = { preHandler: app.requireGlobalPermission('publishing.manage') };
  // GET /?status=&type=&cursor=
  app.get('/', { schema: listJobsSchema, ...manage }, handlers.listJobs);
  // GET /summary: counts per status and the job types seen
  app.get('/summary', { schema: jobsSummarySchema, ...manage }, handlers.summarizeJobs);
  // GET /:id
  app.get('/:id', { schema: getJobSchema, ...manage }, handlers.getJob);
  // POST /:id/retry: dead jobs only
  app.post(
    '/:id/retry',
    { schema: retryJobSchema, config: { audit: { action: 'job.retry' } }, ...manage },
    handlers.retryJob,
  );
};
