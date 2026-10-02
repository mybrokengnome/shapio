import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import * as handlers from '../../../../controllers/scheduledPublications.js';
import { cancelScheduleSchema, createScheduleSchema, listSchedulesSchema } from './schemas.js';

/**
 * /api/admin/publishing/schedules: publish-at / unpublish-at per entry and locale. Creating and cancelling
 * need publish permission on the model (checked by the service through the evaluator); listing everything
 * needs `publishing.manage`, listing one entry's schedules needs read permission on its model.
 */
export const adminSchedulesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const admin = { preHandler: app.requireAdmin };
  // GET /?status=&entryId=&cursor=
  app.get('/', { schema: listSchedulesSchema, ...admin }, handlers.listSchedules);
  // POST / { modelKey, entryId, locale?, action, runAt }
  app.post(
    '/',
    { schema: createScheduleSchema, config: { audit: { action: 'publishing.schedule' } }, ...admin },
    handlers.createSchedule,
  );
  // DELETE /:id: cancel
  app.delete(
    '/:id',
    { schema: cancelScheduleSchema, config: { audit: { action: 'publishing.schedule.cancel' } }, ...admin },
    handlers.cancelSchedule,
  );
};
