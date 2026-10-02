import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { adminChangeSetsRoutes } from '../changeSets/index.js';
import { adminDeploymentsRoutes } from '../deployments/index.js';
import { adminPreviewRoutes } from '../preview/index.js';
import { adminSnapshotsRoutes } from '../snapshots/index.js';
import { adminWebhooksRoutes } from '../webhooks/index.js';
import { adminJobsRoutes } from './jobs/index.js';
import { adminSchedulesRoutes } from './schedules/index.js';

/** Publishing admin routes (package H), registered under `${BASE_PATH}/api/admin`. */
export const adminPublishingRoutes: FastifyPluginAsyncTypebox = async (app) => {
  await app.register(adminJobsRoutes, { prefix: '/jobs' });
  await app.register(adminSchedulesRoutes, { prefix: '/publishing/schedules' });
  await app.register(adminChangeSetsRoutes, { prefix: '/change-sets' });
  await app.register(adminSnapshotsRoutes, { prefix: '/snapshots' });
  await app.register(adminWebhooksRoutes, { prefix: '/webhooks' });
  await app.register(adminDeploymentsRoutes, { prefix: '/deployments' });
  await app.register(adminPreviewRoutes, { prefix: '/preview' });
};
