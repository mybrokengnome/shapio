import type { ExtensionRoute } from '@shapio/cms/config';

/**
 * GET  /api/ext/example/stats    entry counts per model (admins and admin API tokens)
 * POST /api/ext/example/reports  queues the statsReport job; audited as `example.report.request`
 *
 * Custom routes get Shapio's session/token authentication (`request.principal`), CSRF checks for cookie
 * sessions, rate limiting and error handling. Mutating routes must declare `config.audit`.
 */
export const statsRoutes: ExtensionRoute['plugin'] = async (app, { services, requireAdmin }) => {
  app.addHook('preHandler', requireAdmin);

  app.get('/stats', async () => ({ items: await services.stats.counts() }));

  app.post(
    '/reports',
    { config: { audit: { action: 'example.report.request' } } },
    async (_request, reply) => {
      const job = await services.jobs.enqueue('statsReport', {});
      return reply.code(202).send({ jobId: job.id });
    },
  );
};
