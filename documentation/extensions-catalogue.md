# Extension points catalogue

Every way to extend Shapio or connect it to something else, in one place: what each one is, where it runs, its
contract and where that contract lives in the source, a minimal example, how it is versioned, and its limits.
The guides linked from each entry go into detail; this page is the map.

Two rules hold for all of them:

- **Content models are never extended with code.** Models, fields, the editor chosen for a field and
  permissions change live in the admin or with `shapio schema apply`, with no restart. Everything that runs your
  code (hooks, routes, services, jobs, custom editors) loads once at startup: changing it needs a restart of
  Shapio, never a rebuild of Shapio or its admin.
- **Nothing phones home.** Shapio sends nothing off your server unless you configure it to: webhooks, deployment
  connections, SMTP, S3 and OAuth only talk to the places you set up. There is no telemetry, and no
  error-reporting service is built in; error reporting is something you add as an extension
  ([below](#error-reporting)). See [Security: no telemetry](security.md#no-telemetry).

## At a glance

| Extension point                                         | Where it runs                     | Contract                                  | Change needs                |
| ------------------------------------------------------- | --------------------------------- | ----------------------------------------- | --------------------------- |
| [Project config](#project-config-shapioconfigts)        | Server extension (API and worker) | `shapio/config` (`defineConfig`)          | Restart                     |
| [Lifecycle hooks](#lifecycle-hooks)                     | Server extension                  | `ModelHooks`, `Before/AfterHookContext`   | Restart                     |
| [Custom routes](#custom-routes)                         | Server extension (API)            | `ExtensionRoute`, `ExtensionRouteOptions` | Restart                     |
| [Services](#services)                                   | Server extension                  | `ServiceFactory`, `ShapioServices`        | Restart                     |
| [Jobs](#jobs)                                           | Server extension (worker)         | `ExtensionJobHandler`                     | Restart                     |
| [Custom field editors](#custom-field-editors)           | Admin runtime (browser)           | `@shapio/editor-sdk` (`defineEditor`)     | File copy + restart         |
| [Webhooks](#webhooks)                                   | HTTP, Shapio → your receiver      | Signed `POST`, `verifyWebhookSignature`   | Live (admin)                |
| [Deployment connections](#deployment-connections)       | HTTP, Shapio → build provider     | Built-in adapters                         | Live (admin)                |
| [Preview](#preview)                                     | HTTP, your site → Shapio          | URL template + preview API                | Live (admin)                |
| [Delivery, GraphQL and snapshots](#http-apis)           | HTTP client                       | REST, GraphQL, OpenAPI at `/api/docs`     | Live (follows the schema)   |
| [`@shapio/client`](#shapioclient)                       | HTTP client (Node, edge, browser) | `createClient`                            | Package upgrade             |
| [Generated types](#generated-types)                     | CLI → your code                   | `shapio types generate`                   | Re-run after schema changes |
| [CLI](#cli)                                             | CLI (server or remote)            | `shapio <command>`                        | Package upgrade             |
| [Export/import bundles](#exportimport-bundles)          | CLI and HTTP                      | NDJSON bundle, format version 1           | n/a                         |
| [MCP server](#mcp-server)                               | MCP (stdio, next to the agent)    | `@shapio/mcp` tools, resources, prompts   | Package upgrade             |
| [Email, media storage, OAuth](#infrastructure-adapters) | Server, chosen by configuration   | Environment variables                     | Restart                     |
| [Site starters](#site-starters)                         | Your site                         | `create-shapio --site`                    | n/a                         |

## Server extensions

Server extensions are your own TypeScript or JavaScript running inside Shapio's process. The full guide is
[Extensions](extensions.md); a working project is [`examples/extension`](../examples/extension).

### Project config (`shapio.config.ts`)

- **What:** one file that declares every server extension and the custom editor modules.
- **Where it runs:** loaded at startup by the API server and the worker (inline, or a dedicated `shapio worker`
  with the same `SHAPIO_CONFIG_PATH` and files).
- **Contract:** `ShapioConfig` and `defineConfig` from `shapio/config`, which always resolves to the running
  Shapio's own copy. Source: [`apps/api/src/extensions/public.ts`](../apps/api/src/extensions/public.ts)
  (published as `shapio/config`). Loading: [`extensions/loader.ts`](../apps/api/src/extensions/loader.ts);
  validation: [`extensions/configSchema.ts`](../apps/api/src/extensions/configSchema.ts).

  ```ts
  type ShapioConfig = {
    hooks?: Record<string, ModelHooks>; // by model API ID, stable model ID, or '*'
    routes?: ExtensionRoute[];
    services?: Record<string, ServiceFactory>;
    editors?: string[]; // file names in extensions/editors/
    jobs?: Record<string, ExtensionJobHandler>;
  };
  ```

- **Example:**

  ```ts
  import { defineConfig } from 'shapio/config';

  export const config = defineConfig({ hooks: {}, routes: [], services: {}, jobs: {}, editors: [] });
  ```

- **Lifecycle:** found through `SHAPIO_CONFIG_PATH`, else `shapio.config.ts`, `.mts`, `.js` or `.mjs` in the
  working directory; `extensions/` sits next to it. Loaded with jiti, so TypeScript needs no build (erasable
  syntax only). No file means no extensions.
- **Versioning:** everything exported from `shapio/config` follows semver and carries
  `EXTENSION_CONTRACT_VERSION` (currently `1`). Shapio's database tables, reachable through `db` and `trx`, are
  internal and may change in any release.
- **Limits:** an unknown key, a misspelt hook name, a bad route prefix, a duplicate prefix or a service named
  like one of Shapio's own (`site`, `forSite`, `content`, `media`, `jobs`, `logger`) stops startup with every
  problem listed. `npx shapio extensions check` runs the same validation without a database, for CI.

### Lifecycle hooks

- **What:** your functions called before and after entries are created, updated, published or deleted.
- **Where it runs:** server. `before*` hooks run in the request (or the job) that makes the write; `after*` hooks
  run in the worker.
- **Contract:** `ModelHooks`, `BeforeHookContext`, `AfterHookContext`, `HookError` in
  [`public.ts`](../apps/api/src/extensions/public.ts); runner in
  [`extensions/hooks.ts`](../apps/api/src/extensions/hooks.ts).

  | Event                                                           | Runs                                            | Can reject               |
  | --------------------------------------------------------------- | ----------------------------------------------- | ------------------------ |
  | `beforeCreate`, `beforeUpdate`, `beforePublish`, `beforeDelete` | inside the write's transaction                  | yes: 422 `HOOK_REJECTED` |
  | `afterCreate`, `afterUpdate`, `afterPublish`, `afterDelete`     | after commit, as a job (`extensions.afterHook`) | no; retried on error     |

  Every context carries `event`, `site` (`{ id, key }`, the entry's site), `model`, `entry`, `locale`, `data`,
  `before`, `principal`, `trx`, `services` (bound to the entry's site), `logger` and `signal`. `before*` adds
  `reject(message, details)`; `after*` adds `eventId`, `idempotencyKey` (`<eventId>:<hook name>`) and `attempt`.

- **Example:**

  ```ts
  hooks: {
    article: {
      beforePublish: ({ data, reject }) => {
        if (!data?.cover) reject('An article needs a cover image', { field: 'cover' });
      },
    },
    '*': {
      afterPublish: async ({ site, model, entry, idempotencyKey }) => {
        await fetch('https://search.example.com/reindex', {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey },
          body: JSON.stringify({ site: site.key, model: model.apiKey, id: entry.id }),
        });
      },
    },
  },
  ```

- **Lifecycle:** hooks fire however the change is made: admin, REST, GraphQL mutations, scheduled publishing and
  change sets. Hooks keyed by API ID, model ID and `*` all run, in that order. An `after*` hook's database work
  through `trx` happens exactly once (it commits with a run record); anything else it does is at least once.
  Details: [Extensions: lifecycle hooks](extensions.md#lifecycle-hooks).
- **Limits:** `before*` hooks hold the write's locks, so keep them fast and never call slow services from them.
  One rejected item fails a whole change set. `data` is the full, unmasked document (hooks are trusted code).
  Changing a model's API ID stops hooks keyed by the old one from matching; key by the stable model ID if that
  matters. On a multi-site instance, hooks are configured once for every site: branch on `context.site` when a
  site needs different behaviour.

### Custom routes

- **What:** your own HTTP endpoints, mounted inside Shapio's server.
- **Where it runs:** the API server, at `{BASE_PATH}/api/ext/<prefix>/…`.
- **Contract:** `ExtensionRoute` (`{ prefix, plugin }`) and `ExtensionRouteOptions` (`services`, `permissions`,
  `logger`, `requireAdmin`) in [`public.ts`](../apps/api/src/extensions/public.ts); mounting in
  [`plugins/extensions.ts`](../apps/api/src/plugins/extensions.ts). The plugin is an ordinary Fastify plugin;
  `request.principal` and `request.site` are typed by `shapio/config`.
- **Example:**

  ```ts
  import type { ExtensionRoute } from 'shapio/config';

  export const acmeRoutes: ExtensionRoute['plugin'] = async (app, { services, requireAdmin }) => {
    // A site route: count the requesting site's articles, not the primary site's.
    app.get('/stats', { preHandler: requireAdmin }, async (request) => ({
      articles: await services.forSite(request.site!).content.count('article'),
    }));

    // An instance-wide route: no request.site.
    app.get('/health', { config: { site: 'network' } }, async () => ({ ok: true }));
  };
  ```

- **Lifecycle:** custom routes get what core routes get: session, API-token and app-user authentication
  (`request.principal`), CSRF on cookie-authenticated writes, the central error handler, the global rate limit,
  and the audit declaration check: every mutating route declares `config: { audit: { action } }` (recorded on
  success) or `{ audit: { exempt: '<why>' } }`, or Shapio refuses to start.
- **Sites:** custom routes are site routes. `request.site` is the credential's site, else the `Shapio-Site`
  header or `?site=`, else the primary site, and a request naming another site than its token's is refused
  (`403 SITE_MISMATCH`). The `services` passed to the plugin read the primary site; use
  `services.forSite(request.site)` for the request's. Declare `config: { site: 'network' }` on a route that is
  about the whole instance; it then has no `request.site`.
- **Limits:** authorization is yours (`requireAdmin`, or `permissions.evaluate(request.principal, …)`). Prefixes
  are lower-case letters, digits and dashes, and unique. Declare JSON schemas for params, querystring, body and
  response as core routes do.

### Services

- **What:** objects constructed once at startup and shared by hooks, routes and jobs, plus Shapio's own small
  service set.
- **Where it runs:** server (API and worker).
- **Contract:** `ServiceFactory`, `ServiceFactoryContext` (`db`, `config`, `logger`, `services`),
  `ShapioServices`, `CustomServices` in [`public.ts`](../apps/api/src/extensions/public.ts); construction in
  [`extensions/services.ts`](../apps/api/src/extensions/services.ts); site binding in
  [`extensions/siteServices.ts`](../apps/api/src/extensions/siteServices.ts). Shapio's services:

  | Service                                                          | What it does                                                 |
  | ---------------------------------------------------------------- | ------------------------------------------------------------ |
  | `site`                                                           | the site `content` and `media` read                          |
  | `forSite(site)`                                                  | the same services reading another site                       |
  | `content.get`, `content.list`, `content.count`, `content.models` | read drafts as the admin API shows them, from committed data |
  | `media.usages(assetId)`                                          | where an asset is referenced (up to 100, plus the total)     |
  | `jobs.enqueue(name, payload?, options?)`                         | queue one of your [jobs](#jobs)                              |
  | `logger`                                                         | pino logger                                                  |

- **Example:**

  ```ts
  services: {
    search: ({ logger }) => createSearchClient({ url: process.env.SEARCH_URL, logger }),
    stats: ({ services }) => createStats(services.search), // sees services declared before it
  },
  ```

  ```ts
  declare module 'shapio/config' {
    interface CustomServices {
      stats: StatsService;
    }
  }
  ```

- **Lifecycle:** factories run in declaration order, may be async, and a throwing factory stops startup.
- **Sites:** content and media are per site. Services handed to a hook read the hook's site; those given to
  routes, jobs and factories read the primary site until you call `forSite`. Your custom services are shared
  across sites as they are, so pass them the site they should work on.
- **Limits:** content reads run as Shapio itself unless you pass a `principal`. They read committed data: inside a
  `before*` hook, read your own uncommitted writes through `trx`. Read your own settings from environment
  variables; `config` only carries `nodeEnv`, `publicUrl`, `basePath` and `projectDir`.

### Jobs

- **What:** background job handlers that run on Shapio's queue.
- **Where it runs:** the worker (inline or dedicated).
- **Contract:** `ExtensionJobHandler` and `JobHandlerContext` (`jobId`, `payload`, `attempt`, `maxAttempts`,
  `idempotencyKey`, `services`, `logger`, `signal`) in [`public.ts`](../apps/api/src/extensions/public.ts);
  registration in [`extensions/jobs.ts`](../apps/api/src/extensions/jobs.ts).
- **Example:**

  ```ts
  jobs: {
    reindex: async ({ payload, services, logger }) => {
      logger.info({ payload }, 'reindexing');
      return { done: true }; // stored as the job's result
    },
  },
  // elsewhere: await services.jobs.enqueue('reindex', { model: 'article' }, { idempotencyKey: 'article' });
  ```

- **Lifecycle:** each handler is registered as job type `ext.<name>`. Jobs get Shapio's queue guarantees:
  leases, retries with backoff (throw to retry), dead-lettering, graceful shutdown through `signal`. They show
  in the admin's jobs view.
- **Limits:** delivery is at least once, so make side effects idempotent. Enqueueing a name that is not in
  `jobs` throws. Job services read the primary site; use `services.forSite` for another.

### Error reporting

- **What:** sending server errors to a service of your choice. Shapio ships no error-reporting integration
  (none is built in, and none is ever on by default).
- **Where it runs:** wherever you add it: a log shipper outside Shapio, or your own extension code.
- **Contract:** failed requests are logged as one JSON line at level `error` (`request failed`, error under
  `err`); jobs that run out of attempts log `job dead`. In code, use a route plugin's `onError` hook or catch in
  your hooks, jobs and services.
- **Example and limits:** [Extensions: error reporting](extensions.md#error-reporting). A route plugin's
  `onError` hook only sees errors from that plugin's routes.

## Admin runtime

### Custom field editors

- **What:** a React component that edits one or more data types, loaded by the prebuilt admin at runtime as an
  ES module.
- **Where it runs:** the admin, in the browser of whoever edits content.
- **Contract:** `@shapio/editor-sdk`: `defineEditor`, `EditorDefinition`, `FieldEditorProps`, `EditorContext`,
  `EDITOR_CONTRACT_VERSION` (currently `1`). Source:
  [`packages/editor-sdk/src/types.ts`](../packages/editor-sdk/src/types.ts) and
  [`defineEditor.ts`](../packages/editor-sdk/src/defineEditor.ts). The server side is the editor manifest:
  [`extensions/editorManifest.ts`](../apps/api/src/extensions/editorManifest.ts) builds it from
  `editors: [...]`, and [`plugins/editorManifest.ts`](../apps/api/src/plugins/editorManifest.ts) exposes it to
  `GET /api/admin/extensions/editors` (the list, admins only) and `GET /api/admin/extensions/editors/:file`
  (one module, served only if it is in the manifest, with a content-hash `?v=` so a changed file gets a new
  URL). The admin's loader is [`apps/admin/src/fields/runtime/loader.ts`](../apps/admin/src/fields/runtime/loader.ts).
- **Example:**

  ```tsx
  import { defineEditor, type FieldEditorProps } from '@shapio/editor-sdk';

  const StarRating = ({ inputId, value, onChange, onBlur, readOnly }: FieldEditorProps<'integer'>) => (
    <input
      id={inputId}
      type="range"
      min={0}
      max={5}
      value={value ?? 0}
      disabled={readOnly}
      onChange={(event) => onChange(Number(event.target.value))}
      onBlur={onBlur}
    />
  );

  export const editor = defineEditor({
    id: 'acme.starRating',
    dataTypes: ['integer'],
    component: StarRating,
  });
  ```

  Build it to one ES module with `react`, `react/jsx-runtime`, `react-dom` and `@shapio/editor-sdk` external,
  copy it to `extensions/editors/`, list it in `editors: ['star-rating.js']`, restart. A complete editor with its
  Vite config is [`examples/custom-editor`](../examples/custom-editor).

- **Lifecycle:** installing is build, copy, list, restart; the admin is never rebuilt. The admin's import map
  resolves `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client` and `@shapio/editor-sdk` to its own
  copies, so an editor shares the admin's React. Choosing the editor for a field (and its options) is a live
  modelling change.
- **Versioning:** `defineEditor` stamps `EDITOR_CONTRACT_VERSION`. The admin skips an editor built for another
  version, a module with no editor export, a duplicate editor ID or a module that fails to load, logs why, and
  shows the field's built-in editor instead; it does the same for an editor that throws while rendering.
- **Limits:** editor IDs are namespaced (`vendor.name`); built-in IDs never contain a dot. An editor gets the
  value, `onChange`/`onBlur`, validation messages, field and model metadata (including its options), DOM ids for
  labelling, and a limited context (`locale`, `entryId`, `uiLanguage`, `pickMedia()`, `translate()`). It gets no
  network client, session, token or secret. The server validates the value exactly as for the built-in editor.
  Style with the admin's CSS variables so it follows light and dark mode. Guide:
  [Extensions: custom field editors](extensions.md#custom-field-editors).

## Outbound integrations

Configured under **Publishing** in the admin, live, with no restart. Every outbound request goes through the job
queue (retries, logs) and refuses private, loopback and link-local addresses unless they are listed in
`OUTBOUND_PRIVATE_NETWORK_ALLOWLIST` and the webhook or connection allows private networks.

### Webhooks

- **What:** signed HTTP `POST`s to your URL when something happens in Shapio.
- **Where it runs:** Shapio's worker sends; your receiver runs anywhere.
- **Contract:** body `{ id, type, createdAt, data }`; headers `X-Shapio-Event`, `X-Shapio-Delivery` (same on
  every retry), `X-Shapio-Timestamp`, `X-Shapio-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`.
  Events (exact names or `group.*`), from [`apps/api/src/webhooks/catalogue.ts`](../apps/api/src/webhooks/catalogue.ts):

  | Group        | Events                                                                  |
  | ------------ | ----------------------------------------------------------------------- |
  | `entry`      | `created`, `updated`, `deleted`, `published`, `unpublished`, `restored` |
  | `media`      | `created`, `updated`, `deleted`                                         |
  | `schema`     | `activated`, `deleted`                                                  |
  | `locale`     | `added`, `metadata`, `defaultChanged`, `removed`                        |
  | `change_set` | `scheduled`, `shipping`, `shipped`, `failed`, `discarded`               |
  | `deployment` | `triggered`, `building`, `deployed`, `failed`                           |

  "Send test" sends `webhook.test`. Management: [`apps/api/src/services/webhooks.ts`](../apps/api/src/services/webhooks.ts).
  Receiving side: `verifyWebhookSignature` in
  [`packages/client/src/webhooks.ts`](../packages/client/src/webhooks.ts) (Web Crypto, so Node, edge runtimes
  and browsers).

- **Example:**

  ```ts
  import { verifyWebhookSignature } from '@shapio/client';

  const check = await verifyWebhookSignature({
    secret: process.env.SHAPIO_WEBHOOK_SECRET!,
    signature: request.headers.get('x-shapio-signature'),
    timestamp: request.headers.get('x-shapio-timestamp'),
    body: await request.text(), // the raw body, never re-serialised JSON
  });
  if (!check.ok) return new Response(check.reason, { status: 401 });
  ```

- **Lifecycle:** at least once, with exponential backoff up to the webhook's maximum attempts; every attempt is
  in the delivery log, where you can redeliver. The secret is shown once and can be rotated; during rotation
  the signature header may carry several comma-separated `v1=` values, and any match is accepted.
- **Sites:** a webhook belongs to one site (that site's events) or to the network (every site's events).
- **Limits:** signatures older or newer than 300 seconds are refused by `verifyWebhookSignature` by default.
  Deduplicate on `X-Shapio-Delivery`. Guide: [Webhooks, deployments and preview](publishing.md#webhooks).

### Deployment connections

- **What:** starting a site build when content is published, a change set ships, the schema changes or someone
  clicks deploy, and tracking each run as `queued → triggered → building → deployed` or `failed`.
- **Where it runs:** Shapio's worker calls the provider; the provider builds your site.
- **Contract:** the providers are built into Shapio and chosen per connection in the admin; they are not a
  plugin interface. Each implements the internal `DeploymentProviderAdapter`
  ([`apps/api/src/deployments/types.ts`](../apps/api/src/deployments/types.ts)): declared settings and secrets,
  `trigger`, optional `poll`, `test`, and whether it reports completion. Registry:
  [`deployments/providers/index.ts`](../apps/api/src/deployments/providers/index.ts). To reach a build system
  that has no adapter, use the generic signed build webhook.

  | Provider                 | ID                 | Settings                                                                                        | Secrets                                   | Reports completion                   |
  | ------------------------ | ------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------ |
  | Generic signed webhook   | `generic_webhook`  | `url`                                                                                           | `signingSecret` (generated if omitted)    | Only through your callbacks          |
  | Cloudflare Pages         | `cloudflare_pages` | `accountId`, `projectName`                                                                      | `deployHookUrl`, `apiToken` (Pages: Read) | Yes (Cloudflare API)                 |
  | GitHub schema write-back | `github`           | `owner`, `repo`, `branch` (`main`), `mode` (`commit` or `pull_request`), `directory` (`schema`) | `token`                                   | Yes                                  |
  | Vercel                   | `vercel`           | `projectId`, `teamId` (optional)                                                                | `deployHookUrl`, `apiToken`               | Yes (Vercel API, `VERCEL_API_URL`)   |
  | Netlify                  | `netlify`          | `siteId`                                                                                        | `apiToken`                                | Yes (Netlify API, `NETLIFY_API_URL`) |

  Sources: [`genericWebhook.ts`](../apps/api/src/deployments/providers/genericWebhook.ts),
  [`cloudflarePages.ts`](../apps/api/src/deployments/providers/cloudflarePages.ts),
  [`githubWriteBack.ts`](../apps/api/src/deployments/providers/githubWriteBack.ts),
  [`vercel.ts`](../apps/api/src/deployments/providers/vercel.ts),
  [`netlify.ts`](../apps/api/src/deployments/providers/netlify.ts), and the deployment matching shared by the
  hook-based providers in [`matching.ts`](../apps/api/src/deployments/providers/matching.ts).

  Cloudflare Pages and Vercel start the build through the project's deploy hook, then poll the deployment
  through the provider's API. Vercel's hook never returns the deployment, and Cloudflare's does not always, so
  Shapio matches the newest deployment of the project (on Vercel, of the project and team, preferring one that
  carries this hook's ID) created after the trigger, allowing 30 seconds of clock skew. Netlify starts the
  build through its builds API and polls the deploy that build produces.

- **Example (generic webhook receiver):** verify the `deployment.trigger` request with
  `verifyWebhookSignature`, build with `SHAPIO_SNAPSHOT=<snapshot>` from the body, then `POST`
  `{ runId, status: 'building' | 'deployed' | 'failed', siteUrl?, logUrl?, message? }` to the body's
  `callbackUrl`, signed with the connection's secret in the same headers. Full payloads:
  [Generic signed build webhook](publishing.md#generic-signed-build-webhook).
- **Lifecycle:** triggers are `publish`, `change_set`, `manual` and (GitHub write-back) `schema`; bursts are
  debounced into one run. Status only moves forward; Shapio never invents a status. Secrets can be
  `${ENV:SHAPIO_SECRET_…}` references (or names allowed by `SECRET_ENV_ALLOWLIST`).
- **Limits:** a Cloudflare deploy hook cannot take parameters, so a Pages build pins the snapshot current when it
  starts. GitHub write-back mirrors production's schema files into git; it is never a lock
  ([Schema sync: git as a mirror](schema-sync.md#git-as-a-mirror-github-write-back)). Cloudflare Pages, Vercel
  and Netlify builds all pin the snapshot that is current when the build starts; only the generic webhook can
  pin the run's exact snapshot. Netlify tokens cannot be limited to one site, and a Netlify build that is
  skipped or canceled fails its run. Provider API tokens are only sent to `CLOUDFLARE_API_URL`,
  `VERCEL_API_URL`, `NETLIFY_API_URL` or `GITHUB_API_URL`. Setup for each provider:
  [Deployment connections](publishing.md#deployment-connections).

### Preview

- **What:** editors open a draft on your real site through a URL template on the deployment connection.
- **Where it runs:** your site's preview page, reading Shapio's preview API.
- **Contract:** the template takes `{token}`, `{modelKey}`, `{entryId}`, `{locale}` and `{path}`; your page calls
  `GET /api/preview/content/<route key>/<entry id>` with the preview token as a bearer token. Source:
  [`apps/api/src/publishing/previewUrl.ts`](../apps/api/src/publishing/previewUrl.ts).
- **Example:** `https://www.example.com/preview/?model={modelKey}&id={entryId}&locale={locale}#token={token}`.
- **Limits:** preview tokens are scoped to one entry and one locale, expire, and are never admin
  credentials. Browser calls need the site's origin in `CORS_ORIGINS`. Guide: [Preview](publishing.md#preview).

## HTTP clients

### HTTP APIs

Shapio's APIs are generic: one route per model resolved at request time, so a model created a minute ago is
served at once, with no generated code.

| API                   | Path                                 | For                                                    | Guide                                   |
| --------------------- | ------------------------------------ | ------------------------------------------------------ | --------------------------------------- |
| Delivery (REST)       | `/api/content/<route key>`           | published content, filters, populate, `?snapshot=`     | [Delivery API](delivery-api.md)         |
| GraphQL               | `/api/graphql`                       | the same content, schema built from the live models    | [GraphQL](graphql.md)                   |
| Snapshots and changes | `/api/snapshots/current`, `/changes` | pinned builds, incremental builds, `revalidatePath`    | [Snapshots](snapshots.md)               |
| Preview               | `/api/preview/content/…`             | drafts on your site                                    | [Preview](publishing.md#preview)        |
| App users             | `/api/app-auth/…`                    | sign-up, sign-in, Google and GitHub, owner-only writes | [End users](end-users.md)               |
| Admin                 | `/api/admin/…`                       | everything the admin does, with an admin API token     | [REST reference](reference/rest-api.md) |
| Custom routes         | `/api/ext/<prefix>/…`                | your own endpoints                                     | [Custom routes](#custom-routes)         |

Each running instance serves its OpenAPI document for the current schema at `/api/docs` (admins). On a
multi-site instance every request reads one site: the token's, else `?site=` or `Shapio-Site`, else the primary
site ([Sites: which site a request reads](sites.md#which-site-a-request-reads)).

### `@shapio/client`

- **What:** the typed HTTP client Shapio's own admin, CLI and MCP server use.
- **Where it runs:** Node, edge runtimes and browsers; `@shapio/client/node` adds Node-only helpers.
- **Contract:** `createClient(options)` in [`packages/client/src/client.ts`](../packages/client/src/client.ts),
  exports in [`index.ts`](../packages/client/src/index.ts):

  | Option        | Meaning                                                                                   |
  | ------------- | ----------------------------------------------------------------------------------------- |
  | `baseUrl`     | Shapio's URL including any `BASE_PATH`                                                    |
  | `token`       | an API token, sent as a bearer token                                                      |
  | `site`        | a site key: `?site=` on delivery and snapshot reads, the `Shapio-Site` header on the rest |
  | `fetch`       | a custom fetch (tests, agents)                                                            |
  | `credentials` | fetch credentials mode (`same-origin` for cookie sessions)                                |
  | `headers`     | extra headers computed per request                                                        |

  The client has `request` (any route), `system` (`health`, `ready`, `version`), `delivery` (`list`, `get`,
  `singleton`), `snapshots` (`current`, `changes`, `allChanges`), `appAuth` (with `createPkcePair` for OAuth)
  and `admin` (setup, auth, users, roles, tokens, audit, schema, content, media, publishing, change sets, app
  users, usage, sites). It also exports `verifyWebhookSignature`. `@shapio/client/node` exports `uploadFile`
  (grant, upload, confirm) and `mimeTypeOf` ([`node.ts`](../packages/client/src/node.ts)).

- **Example:**

  ```ts
  import { createClient } from '@shapio/client';

  const shapio = createClient({
    baseUrl: process.env.SHAPIO_URL!,
    token: process.env.SHAPIO_TOKEN,
    site: 'marketing',
  });
  const { snapshot } = await shapio.snapshots.current();
  const articles = await shapio.delivery.list<Article>('articles', { locale: 'fr', snapshot });
  ```

- **Versioning:** semver with the `@shapio/client` package; errors are `ShapioApiError` with the server's
  `{ error: { code, message } }` body.
- **Limits:** content is typed by the caller (`list<Article>`); use [generated types](#generated-types) for the
  shapes. A site token naming another site is refused (`403 SITE_MISMATCH`).

### Generated types

- **What:** TypeScript types for your models and components, generated from the live schema.
- **Where it runs:** CLI, against a running instance; the output goes into your code.
- **Contract:** `shapio types generate [--url] [--token] [--out shapio-types.ts]`
  ([CLI reference](reference/cli.md#shapio-types)).
- **Limits:** the file is a snapshot of the schema when you ran it; regenerate after model changes. Nothing on
  the server depends on it.

## CLI

- **What:** one `shapio` command, shipped with the `shapio` package and the Docker image.
- **Where it runs:** **server commands** (`start`, `worker`, `migrate`, `healthcheck`, `version`, `admin`,
  `media migrate`, `sites`, `extensions check`, `mcp`) on the machine that runs Shapio, with its environment;
  **remote commands** (`status`, `schema pull|diff|apply`, `types generate`, `export`, `import`) over HTTP with
  `--url`/`SHAPIO_URL` and an admin token (`--token`/`SHAPIO_TOKEN`), from a laptop or CI.
- **Contract:** command definitions in [`packages/cli/src/commands`](../packages/cli/src/commands); the
  generated [CLI reference](reference/cli.md) lists every option.
- **Example (CI):**

  ```sh
  npx shapio extensions check
  npx shapio schema diff --dir schema
  npx shapio schema apply --dir schema   # refuses if the instance moved since your pull
  ```

- **Limits:** `schema apply` goes through the same change planner as the admin and refuses on conflicts, like a
  rejected non-fast-forward push ([Schema sync](schema-sync.md)). `@shapio/cli` is not published on its own;
  use it through `shapio`.

## Export/import bundles

- **What:** a portable file holding one site's schema, locales, roles, content and media metadata (and media
  files with `--with-media`), for moving content between instances.
- **Where it runs:** CLI (`shapio export`, `shapio import`) over HTTP: `/api/admin/transfer/export`,
  `/import`, `/imports/:id`, `/media/:assetId`.
- **Contract:** newline-delimited JSON, `format: "shapio-export"`, `formatVersion: 1`, content type
  `application/x-ndjson`, records in order: header, locales, schema lock, definitions, app roles, delivery roles,
  app users (opt-in), webhooks, deployment connections, media folders, media assets, entries, end. Schema:
  [`apps/api/src/content/transfer/format.ts`](../apps/api/src/content/transfer/format.ts).
- **Example:**

  ```sh
  npx shapio export --url https://cms.example.com --token shp_… --with-media content.tar
  npx shapio import --url https://new.example.com --token shp_… --dry-run content.tar
  ```

- **Lifecycle:** an import is planned first and refused, writing nothing, on any conflict; it then runs as a
  resumable, idempotent job. IDs and stable field IDs are preserved.
- **Limits:** secrets never travel (webhooks and connections import disabled; app-user passwords only as hashes
  and only with `--include-users`; tokens never). An import never changes an existing model. A bundle is at most
  20 GiB. Guide: [Backup and restore: content export and import](backup-restore.md#content-export-and-import).

## MCP server

- **What:** `@shapio/mcp`, a Model Context Protocol server that lets coding agents read and model content types,
  write draft entries, upload media and open change sets. Agents propose; people ship.
- **Where it runs:** on the developer's machine next to the agent (stdio, `npx -y @shapio/mcp`), talking to
  Shapio's admin API with an API token through `@shapio/client`. It sends nothing anywhere else.
- **Contract:** `createShapioMcpServer(options)` in [`packages/mcp/src/server.ts`](../packages/mcp/src/server.ts).
  Tools in [`packages/mcp/src/tools`](../packages/mcp/src/tools): `schema_list`, `schema_get`, `schema_draft`,
  `change_sets_add_schema_draft`, `content_query`, `content_get`, `content_create`, `content_update`,
  `media_list`, `media_upload`, `preflight_run`, `health_list`, `usage_fields`, `change_sets_list`,
  `change_sets_create`, `change_sets_add_entry`, `change_sets_review`, `change_sets_ship` (only with
  `--allow-ship`), `snapshots_list`, `snapshots_changes`, `snapshots_restore`. Resources
  ([`resources.ts`](../packages/mcp/src/resources.ts)): `shapio://schema/{apiKey}`, `shapio://docs/delivery-api`.
  Prompts ([`prompts.ts`](../packages/mcp/src/prompts.ts)): `model_content_type`, `review_change_set`.
- **Example:** `npx shapio mcp --client cursor` prints a ready configuration for your instance.
- **Versioning:** tool names are stable; the package follows semver.
- **Limits:** the server enforces everything as for the admin (role, field permissions, validation, version
  guards, change set review). Give the agent's role no `changes.ship`, so it cannot ship even if told to.
  `media_upload` reads only from `--media-root`. Guide: [MCP server for coding agents](mcp.md).

## Infrastructure adapters

These are built into Shapio and chosen with environment variables at startup. They are not plugin interfaces:
there is no way to register a new email transport, storage driver or OAuth provider from `shapio.config`.

| Adapter       | Options                                                   | Source                                                                                                                                      | Notes                                                                                                           |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Email         | `EMAIL_TRANSPORT=console` (logs) or `smtp` (`SMTP_*`)     | [`apps/api/src/email`](../apps/api/src/email) (`EmailTransport` in [`types.ts`](../apps/api/src/email/types.ts))                            | Any provider with an SMTP endpoint works. Sending is a job, retried with backoff.                               |
| Media storage | `STORAGE_DRIVER=local` (default) or `s3` (`STORAGE_S3_*`) | [`plugins/mediaStorage.ts`](../apps/api/src/plugins/mediaStorage.ts), [`media/types.ts`](../apps/api/src/media/types.ts) (`StorageAdapter`) | Any S3-compatible service (R2, B2, Spaces, Wasabi…). `shapio media migrate` moves files live. [Media](media.md) |
| App sign-in   | Email and password; Google and GitHub (`APP_AUTH_*`)      | [`apps/api/src/config/schema.ts`](../apps/api/src/config/schema.ts)                                                                         | [End users](end-users.md)                                                                                       |

The full list of variables is in the [environment reference](reference/environment.md).

## Site starters

- **What:** ready sites on Shapio: Astro, Next.js and SvelteKit, made with `npx create-shapio --site`.
- **Where it runs:** your site's own hosting; they read the delivery API with a delivery token.
- **Contract and limits:** [Site starters](starters.md); the Astro walkthrough is [Example site](example-site.md).
  The starters turn off their frameworks' anonymous telemetry.

## Versioning summary

| Surface                                   | Stability                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `shapio/config` (server extensions)       | semver with `shapio`; `EXTENSION_CONTRACT_VERSION` = 1                       |
| `@shapio/editor-sdk` (custom editors)     | `EDITOR_CONTRACT_VERSION` = 1; mismatched editors fall back to built-in ones |
| Webhook signature (`v1=`) and event names | versioned by the `v1` prefix                                                 |
| HTTP APIs and `@shapio/client`            | semver with the packages; OpenAPI at `/api/docs`                             |
| Export bundle                             | `formatVersion` 1                                                            |
| MCP tool names                            | stable                                                                       |
| Shapio's database tables (`db`, `trx`)    | internal; may change in any release                                          |
| Deployment, email and storage adapters    | internal; chosen by configuration, not extended by code                      |
