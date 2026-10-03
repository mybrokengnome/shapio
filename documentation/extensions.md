# Extensions

Extensions are your own code running inside Shapio: lifecycle hooks, custom routes, shared services, background
jobs and custom field editors. They are configured in the project's `shapio.config.ts` and its `extensions/`
folder.

Shapio has two kinds of change, and they behave differently:

| You change                                                              | How                                  | Restart? | Rebuild? |
| ----------------------------------------------------------------------- | ------------------------------------ | -------- | -------- |
| Content models, fields, editors chosen per field, permissions           | Admin UI or `shapio schema apply`    | **No**   | **No**   |
| Extensions: hooks, custom routes, services, jobs, custom editor modules | `shapio.config.ts` and `extensions/` | **Yes**  | **No**   |

Extensions are code you run inside Shapio, so they load once at startup. Changing them means restarting Shapio (`pm2 restart`, `docker compose restart`, `systemctl restart`). You never rebuild Shapio or its admin. Modelling never needs a restart.

## The config file

A project made with `npx create-shapio` has a `shapio.config.ts` at its root and an `extensions/` folder next to it:

```ts
import { defineConfig } from 'shapio/config';

export const config = defineConfig({
  hooks: {}, // lifecycle hooks, by model
  routes: [], // custom HTTP routes under /api/ext/<prefix>
  services: {}, // shared objects, constructed once
  jobs: {}, // background job handlers
  editors: [], // custom field editor modules in extensions/editors/
});
```

- **Where Shapio looks:** set `SHAPIO_CONFIG_PATH` to the file, or Shapio searches its working directory for `shapio.config.ts`, `.mts`, `.js` or `.mjs`, in that order. With no file there are no extensions. `extensions/` is resolved next to the config file.
- **TypeScript without a build:** the file and everything it imports are loaded with [jiti](https://github.com/unjs/jiti). Stick to erasable syntax: types and annotations, but no `enum`, `namespace` or parameter properties. Import your own files with their extension (`./extensions/hooks.ts`).
- **`shapio/config`** always resolves to the running Shapio's own copy, so `defineConfig` and `HookError` work wherever the config lives. Use the named export `config`; a default export is accepted too.
- **Validation:** an unknown key, a hook name with a typo, a bad route prefix or a service named like one of Shapio's own (`site`, `forSite`, `content`, `media`, `jobs`, `logger`) stops startup with the file and every problem:

  ```
  shapio: ExtensionConfigError: Invalid Shapio config /srv/cms/shapio.config.ts:
    - /hooks/article/beforePublsh: unknown hook "beforePublsh"; allowed: beforeCreate, beforeUpdate, ...
    - /routes/0/prefix: must be lower-case letters, digits and dashes (it becomes /api/ext/<prefix>)
  ```

  A file that fails to load reports `file:line:column` where possible.

- **Check in CI:** `npx shapio extensions check` loads and validates the config without a database. It lists every hook, route, service, job and editor, and exits 1 on any problem, including an editor file that is missing from `extensions/editors/`.

The API server and the worker (`WORKER_MODE=inline`, or a separate `shapio worker`) load the same config. Give a dedicated worker the same `SHAPIO_CONFIG_PATH` and files as the API.

## Lifecycle hooks

```ts
hooks: {
  article: {                       // the model's API ID (or its stable model ID)
    beforePublish: ({ data, reject }) => {
      if (!data?.cover) reject('An article needs a cover image', { field: 'cover' });
    },
  },
  '*': {                           // every model
    afterPublish: async ({ model, entry, idempotencyKey }) => {
      await fetch('https://search.example.com/reindex', {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ model: model.apiKey, id: entry.id, locale: entry.locale }),
      });
    },
  },
},
```

The events are `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforePublish`, `afterPublish`, `beforeDelete` and `afterDelete`. Hooks keyed by API ID, by model ID and by `*` all run, in that order. Changing a model's API ID is a flagged contract change, and hooks keyed by the old ID stop matching it.

Hooks fire however the change is made: the admin UI, the REST API, GraphQL mutations (the same content services), scheduled publications and change sets, in the API process and in a dedicated worker alike.

### Transactional: `before*`

`before*` hooks run **inside the write's database transaction**, after Shapio validated the data and before anything commits.

- To reject the write, call `reject(message, details)` or `throw new HookError(message, details)`. The API answers `422` with `{ "error": { "code": "HOOK_REJECTED", "message": ..., "details": { "hook": "article.beforePublish", ...details } } }`. Nothing of the write is kept: no entry, no revision, no outbox event, and nothing your hook wrote through `trx`.
- Any other error also aborts the write, as a `500`. It is logged, and its text never reaches the client.
- Database work through `context.trx` commits or rolls back with the write.
- These hooks hold the write's locks while they run, so keep them fast and never call slow external services from them.
- A change set publishes all its items in one transaction, so one rejected item fails the whole set.

### Post-commit: `after*`

`after*` hooks run **after the write committed**, as background jobs.

- In the write's transaction Shapio records an outbox event (only when some after-hook matches). The worker turns it into one job per hook (`extensions.afterHook`).
- A crash never loses an after-hook, and an after-hook can never undo the write.
- A throwing hook is retried with backoff, up to 10 attempts. Its job then shows as dead in Admin, Publishing, Jobs.
- **Exactly once for the database:** the job runs your hook in a transaction that also records `(event ID, hook name)` in `extension_hook_runs`. Work you do through `context.trx` commits together with that record. A retry or a re-run after a worker crash finds the record and skips the hook.
- **At least once for everything else:** an HTTP call can repeat if the worker dies at the wrong moment. Pass `context.idempotencyKey` (`<eventId>:<hook name>`, stable across retries) to the remote system.
- `afterUpdate` fires for saves, not for autosaves; `beforeUpdate` runs for both (an autosave can be rejected too).
- Run records are pruned with other finished bookkeeping after `RETENTION_DAYS` (default 30).
- After-hooks run concurrently, so two hooks for the same entry can finish in any order.

### Context

| Field                                                                                                         | `before*` | `after*`                |
| ------------------------------------------------------------------------------------------------------------- | --------- | ----------------------- |
| `event`, `model` (`id`, `apiKey`, `label`, `kind`, `localized`, `draftAndPublish`)                            | ✓         | ✓                       |
| `site` (`id`, `key`): the entry's [site](sites.md); `services` read this site                                 | ✓         | ✓                       |
| `entry` (`id`, `locale`, `state`: `draft`, `published` or `deleted`), `locale`                                | ✓         | ✓                       |
| `data`: the document after the change, keyed by field API ID (media and relations as IDs; absent for deletes) | ✓         | ✓ (as it was at commit) |
| `before`: the previous draft (update) or the live version being replaced (publish)                            | ✓         | ✓                       |
| `principal`: who made the change (`admin`, `token`, `appUser`, `anonymous`, or `system`)                      | ✓         | ✓                       |
| `trx`: a Kysely transaction (the write's, or the hook run's)                                                  | ✓         | ✓                       |
| `services`, `logger`, `signal` (aborted on shutdown)                                                          | ✓         | ✓                       |
| `reject(message, details)`                                                                                    | ✓         |                         |
| `eventId`, `idempotencyKey`, `attempt`                                                                        |           | ✓                       |

Hooks are trusted server code: `data` is the full document, not masked by the principal's permissions.

## Custom routes

```ts
routes: [{ prefix: 'acme', plugin: acmeRoutes }],
```

```ts
import type { ExtensionRoute } from 'shapio/config';

export const acmeRoutes: ExtensionRoute['plugin'] = async (app, { services, permissions, requireAdmin }) => {
  app.get('/stats', { preHandler: requireAdmin }, async () => ({
    articles: await services.content.count('article'),
  }));

  app.post(
    '/reindex',
    { preHandler: requireAdmin, config: { audit: { action: 'acme.reindex' } } },
    async (request, reply) => {
      await services.jobs.enqueue('reindex', { by: request.principal.kind });
      return reply.code(202).send({ queued: true });
    },
  );
};
```

- Each plugin is mounted at `/api/ext/<prefix>`, under `BASE_PATH`, so the routes above are `GET /api/ext/acme/stats` and `POST /api/ext/acme/reindex`.
- They are ordinary routes of Shapio's server, so they get the same things as core routes:
  - **Authentication:** `request.principal` comes from the admin session cookie, an API token or an app-user token, and is `anonymous` otherwise. Authorization is up to you: use `requireAdmin`, or `permissions.evaluate(request.principal, { action, modelId })`.
  - **CSRF:** a cookie-authenticated `POST`, `PUT`, `PATCH` or `DELETE` must send the `X-CSRF-Token` header, as the admin does.
  - **Audit:** every mutating route must declare `config: { audit: { action } }`, or `{ audit: { exempt: '<why>' } }`, or Shapio refuses to start. On a successful response Shapio records the declared action in the audit log, with the principal, request ID and IP.
  - **Errors:** thrown errors go through the central handler as `{ error: { code, message } }`, and a 500 never shows its text.
  - **Rate limiting:** the global per-IP limit (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`) applies.
  - **Sites:** custom routes are site routes. `request.site` (`{ id, key }`) is the request's [site](sites.md): the credential's, else `?site=` or the `Shapio-Site` header, else the primary site. A route about the whole instance declares `config: { site: 'network' }`, and then has no `request.site`.
- Declare a JSON schema for `params`, `querystring`, `body` and `response`, as Shapio's own routes do.

## Services

```ts
services: {
  search: ({ db, config, logger, services }) => createSearchClient({ url: process.env.SEARCH_URL, logger }),
  stats: ({ services }) => createStats(services.search), // sees the services declared before it
},
```

- Factories run once at startup, in declaration order, and may be async. A factory that throws stops startup.
- The instances are shared by hooks, routes (`app.ext.services`, or the plugin options) and jobs.
- A factory receives:
  - `db`: Kysely on Shapio's database.
  - `config`: `nodeEnv`, `publicUrl`, `basePath` and `projectDir`. Read your own settings from environment variables.
  - `logger`.
  - `services`: Shapio's services and the custom services declared so far.
- Shapio's own services:
  - `content.get(modelKey, id, { locale?, principal? })`, `content.list(modelKey, querystring?, { principal? })`, `content.count(modelKey)` and `content.models()`. These read drafts as the admin API shows them, as Shapio itself unless you pass a `principal`, from committed data. Inside a `before*` hook, read your own uncommitted changes through `trx`.
  - `media.usages(assetId)`: where an asset is referenced.
  - `jobs.enqueue(name, payload?, { runAt?, idempotencyKey?, maxAttempts? })`: queues one of your jobs.
  - `logger`.
  - `site` and `forSite(site)`: content and media are per [site](sites.md). The services a hook receives read the hook's site; those given to routes, jobs and factories read the primary site. `services.forSite(request.site)` returns the same services on the request's site.

For typed access everywhere, augment `CustomServices`:

```ts
declare module 'shapio/config' {
  interface CustomServices {
    stats: StatsService;
  }
}
```

## Jobs

```ts
jobs: {
  reindex: async ({ payload, attempt, services, logger, signal }) => {
    // Throw to retry with backoff; the return value (JSON) is stored as the job's result.
    return { done: true };
  },
},
```

- Each handler is registered as job type `ext.<name>`, so it never collides with Shapio's own job types.
- Jobs run in the worker with the same guarantees as Shapio's: leases, retries with backoff, dead-lettering and graceful shutdown (`signal`).
- Delivery is at least once, so make side effects idempotent (use `jobId` or the `idempotencyKey` you enqueued with).
- Enqueue a job with `services.jobs.enqueue('reindex', payload)`.

## Sites

On an instance with several [sites](sites.md), sites share the content types but each has its own
content and media. Extensions are configured once for the whole instance, and each one knows which site it is
working on:

- **Hooks:** `context.site` (`{ id, key }`) is the site of the entry that changed, and `context.services` read
  that site. Branch on `context.site.key` when a site needs different behaviour.
- **Custom routes** are site routes. `request.site` is the request's site: the token's site, else the one the
  request names (`Shapio-Site` header or `?site=`), else the primary site. A request naming a different site
  than its token's is refused with `403 SITE_MISMATCH`. Declare `config: { site: 'network' }` on a route that is
  about the whole instance rather than one site; it then has no `request.site`.
- **Services:** `services.site` is the site that `content` and `media` read, and `services.forSite(site)`
  returns the same services reading another site. The services given to routes, jobs and service factories
  read the **primary site**, so in a route use `services.forSite(request.site)` for the request's site:

  ```ts
  app.get('/stats', { preHandler: requireAdmin }, async (request) => ({
    articles: await services.forSite(request.site!).content.count('article'),
  }));
  ```

- **Jobs** read the primary site too. Pass the site's key or ID in the payload and use `forSite` when a job is
  about one site.
- **Your own services** are constructed once and shared by every site. Pass them the site they should work on.

## Custom field editors

A custom editor is a React component for one or more data types, built as its own ES module and loaded by the
admin at runtime. Installing one is **build, copy, list, restart**; Shapio's admin is never rebuilt.

1. Write the component against `@shapio/editor-sdk` and export it with `defineEditor`:

   ```tsx
   import { defineEditor, type FieldEditorProps } from '@shapio/editor-sdk';

   const StarRating = ({
     inputId,
     labelId,
     value,
     onChange,
     onBlur,
     validation,
     field,
     context,
   }: FieldEditorProps<'integer'>) => {
     // render a control for `value`, call onChange(next) when it changes
   };

   export const editor = defineEditor({
     id: 'acme.starRating',
     dataTypes: ['integer'],
     component: StarRating,
   });
   ```

2. Build it into one ES module with `react`, `react/jsx-runtime`, `react-dom` and `@shapio/editor-sdk` left
   external: the admin's import map resolves them to its own copies, so your editor shares the admin's React.
   [`examples/custom-editor`](../examples/custom-editor) is a complete star-rating editor with its Vite config.
3. Copy the file to the project's `extensions/editors/` and list it in `shapio.config.ts`:

   ```ts
   export const config = defineConfig({ editors: ['star-rating.js'] });
   ```

4. Restart Shapio. In the model builder, choose the editor (`acme.starRating`) for a compatible field and set
   its options; that choice is a live modelling change.

What an editor receives (`EDITOR_CONTRACT_VERSION`): the value (`null` when empty), `onChange` and `onBlur`,
the validation messages, `readOnly`/`disabled`, the field's and its model's metadata (including the editor
options), the DOM ids to label and describe the control, and a limited context: the content locale, the entry
ID, `pickMedia()` and `translate()`. It gets no network client, session or secret. The server validates the
value exactly as for the built-in editor, so an editor can never let an invalid value through. Style it with
the admin's CSS variables (`var(--primary)`, `var(--border)`, `var(--muted-foreground)`…) and it follows light
and dark mode.

An editor built for another contract version, a module without an editor, a duplicate ID or a module that
fails to load is skipped (logged), and the field falls back to its built-in editor; so does a field whose
editor throws while rendering. `npx shapio extensions check` reports missing editor files.

## Error reporting

Shapio ships no error-reporting integration; add one yourself if you want it. Every request that fails with a
500 is logged as one JSON line at level `error` (message `request failed`, the error under `err`), and a job that
runs out of attempts is logged at `error` as `job dead`, so the simplest route is a log shipper that forwards
`error` lines to your service. To report from your own code, catch and report inside your hooks, jobs and
services, or add an `onError` hook in a route plugin:

```ts
export const acmeRoutes: ExtensionRoute['plugin'] = async (app, { logger }) => {
  const reporter = createReporter({ dsn: process.env.ERROR_REPORTER_DSN, logger }); // your client
  app.addHook('onError', async (request, _reply, error) => {
    reporter.capture(error, { requestId: request.id, url: request.url });
  });
  // ...routes
};
```

The hook only sees errors from that plugin's routes (each plugin is mounted in its own scope), and the central
error handler still writes the response.

## Versioning and stability

- The contract is everything exported from `shapio/config`: the config shape, the hook contexts, `ShapioServices`, `HookError` and `defineConfig`. It follows semver and carries `EXTENSION_CONTRACT_VERSION` (currently 1). Breaking changes bump the major version of `shapio` and are listed in the upgrade notes.
- Shapio's database tables (reachable through `db` and `trx`) are **not** part of the contract and may change in any release. Prefer Shapio's services. If you keep data of your own in the database, use your own tables, created by your own tooling. Shapio's migrations never touch them.
- The editor contract is versioned separately (`EDITOR_CONTRACT_VERSION` in `@shapio/editor-sdk`).

## Example

[`examples/extension`](../examples/extension) has a `beforePublish` hook that rejects an Article without a cover image, a `*` `afterPublish` hook, a `stats` service, the routes `GET /api/ext/example/stats` and `POST /api/ext/example/reports`, and an `ext.statsReport` job. To try it:

```sh
cp -r examples/extension/shapio.config.ts examples/extension/extensions my-cms/
cd my-cms && npx shapio extensions check && npm run start
```
