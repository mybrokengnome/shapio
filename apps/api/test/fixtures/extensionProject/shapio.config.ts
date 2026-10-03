// Test project for the extension-point tests (package K). Every hook records itself in `ext_hook_log`
// through its transaction (the test creates the table), so tests can see what ran, when, and whether it was
// rolled back. Titles drive behaviour: `reject…` makes before* hooks reject after writing their row,
// `unpublishable…` only beforePublish.
import { sql } from 'kysely';
import { defineConfig, HookError, type AfterHookContext, type BeforeHookContext } from 'shapio/config';

const record = (name: string) => async (context: BeforeHookContext | AfterHookContext) => {
  const eventId = 'eventId' in context ? context.eventId : null;
  await sql`
    insert into ext_hook_log (hook, entry_id, locale, principal, data, ${sql.id('before')}, event_id)
    values (${name}, ${context.entry.id}, ${context.locale}, ${context.principal.kind},
            ${JSON.stringify(context.data ?? null)}, ${JSON.stringify(context.before ?? null)}, ${eventId})
  `.execute(context.trx);
  const title = typeof context.data?.title === 'string' ? context.data.title : '';
  const refused =
    title.startsWith('reject') || (context.event === 'beforePublish' && title.startsWith('unpublishable'));
  if (context.event.startsWith('before') && refused) {
    throw new HookError(`${name} refused "${title}"`, { title });
  }
};

export const config = defineConfig({
  hooks: {
    article: {
      beforeCreate: record('article.beforeCreate'),
      beforeUpdate: record('article.beforeUpdate'),
      beforePublish: record('article.beforePublish'),
      beforeDelete: record('article.beforeDelete'),
      afterCreate: record('article.afterCreate'),
      afterPublish: record('article.afterPublish'),
      afterDelete: record('article.afterDelete'),
    },
    '*': { afterUpdate: record('*.afterUpdate') },
  },
  routes: [
    {
      prefix: 'probe',
      plugin: async (app, { services, requireAdmin }) => {
        app.get('/ping', async () => ({ ok: true, articles: await services.content.count('article') }));
        app.post(
          '/things',
          { preHandler: requireAdmin, config: { audit: { action: 'probe.thing.create' } } },
          async (_request, reply) => reply.code(201).send({ created: true }),
        );
        app.get('/fail', async () => {
          throw new Error('custom route failure');
        });
      },
    },
  ],
  jobs: {
    echo: async ({ payload }) => ({ echoed: payload }),
  },
});
