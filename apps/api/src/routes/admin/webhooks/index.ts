import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import * as handlers from '../../../controllers/webhooks.js';
import * as schemas from './schemas.js';

/** /api/admin/webhooks: signed event deliveries with a delivery log. Needs `webhooks.manage`. */
export const adminWebhooksRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const manage = { preHandler: app.requireGlobalPermission('webhooks.manage') };
  const audited = (action: string) => ({ config: { audit: { action } }, ...manage });

  app.get('/', { schema: schemas.listWebhooksSchema, ...manage }, handlers.listWebhooks);
  // GET /events: the event catalogue
  app.get('/events', { schema: schemas.listEventTypesSchema, ...manage }, handlers.listEventTypes);
  app.post(
    '/',
    { schema: schemas.createWebhookSchema, ...audited('webhook.create') },
    handlers.createWebhook,
  );
  app.get('/:id', { schema: schemas.getWebhookSchema, ...manage }, handlers.getWebhook);
  app.patch(
    '/:id',
    { schema: schemas.updateWebhookSchema, ...audited('webhook.update') },
    handlers.updateWebhook,
  );
  app.delete(
    '/:id',
    { schema: schemas.deleteWebhookSchema, ...audited('webhook.delete') },
    handlers.deleteWebhook,
  );
  app.post(
    '/:id/rotate-secret',
    { schema: schemas.rotateSecretSchema, ...audited('webhook.rotate_secret') },
    handlers.rotateSecret,
  );
  // POST /:id/test: queue a `webhook.test` delivery
  app.post(
    '/:id/test',
    { schema: schemas.testWebhookSchema, ...audited('webhook.test') },
    handlers.testWebhook,
  );
  app.get('/:id/deliveries', { schema: schemas.listDeliveriesSchema, ...manage }, handlers.listDeliveries);
  app.post(
    '/:id/deliveries/:deliveryId/redeliver',
    { schema: schemas.redeliverSchema, ...audited('webhook.redeliver') },
    handlers.redeliver,
  );
};
