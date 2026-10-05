# Changelog

All notable changes to Shapio are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Show any field in the document.** A field's settings have **Show in document**: on, the entry document
  shows the field under its name among the blocks (an excerpt, a date, the SEO fields) and the strip and
  Settings panel no longer list it; off on a rich text, zone or list, it moves to the Settings panel. It edits
  the model's `display.canvasFieldIds`, which now accepts any field but the title (it took block fields only),
  so it is pulled and applied like any display setting; files without it behave as before. A new block field
  joins a configured list. A document without block fields keeps its property grid under the fields placed in
  it.

### Changed

- **The entry's Settings panel is open by default on wide screens** (80rem and up, where it sits beside the
  document). Closing it is remembered in that browser; opening the preview closes it without changing that.
- **Summarize from body** accepts any string or text field but the title, wherever it is placed; the server no
  longer answers "it is not a property of this model" for a field in the document.

## [0.4.0] - 2026-10-05

### Added

- **The GraphQL playground is in the admin.** **Develop → GraphQL** opens GraphiQL on the current site's
  schema, in the admin's light or dark look; it was only reachable at `/api/graphql/playground` before. The API
  explorer's GraphQL tab now shows the request built on its REST tab as the same query (filters, sort, search,
  page, locale, snapshot and fields), to copy or **Open in playground**. GraphiQL's Docs panel describes every
  content type, component and field with its label and help text. The playground page takes `?query=` and
  `?theme=light|dark`. See [GraphQL: playground](documentation/graphql.md#playground).
- **SEO fields with per-site defaults (API).** A built-in, shared `seo` component (title, description, social
  image, canonical URL, noindex) with fixed stable IDs, created on first use through the change planner by
  `POST /api/admin/components/builtin/seo/ensure` (a network admin; it is refused with
  `SEO_COMPONENT_CONFLICT` while another definition holds the API ID `seo`, such as a Strapi import's). Each
  site has SEO defaults, `sites.seo_defaults` (site name, title template and description per locale; a public
  default image and the Twitter handle per site), edited with `GET`/`PUT /api/admin/site/seo` under the new site
  action `site.settings` (granted to every role that holds `publishing.manage`). A change writes a
  `site.updated` webhook event. Delivery and preview reads take `seo=raw|resolved`: `resolved` returns each SEO
  field with the defaults filled in, the title through the template (the entry's own title when the SEO title is
  empty); a pinned `snapshot` uses today's defaults. `GET /api/site` returns the site's key, name and defaults.
  `@shapio/client` adds `client.site.get()`, the `seo` read option, `SeoFields`, `SeoResolved` and
  `resolveSeo()` (also in the light `@shapio/schema/seo` entry). GraphQL has a `_site` root field with the same
  data (the name `_site` and the types `SiteInfo`, `SiteSeoDefaults` and `SiteSeoLocale` are now reserved).
  See [SEO fields](documentation/seo.md).
- **The site starters render SEO tags.** Article and Page have an `seo` field (the built-in component, which the
  seed applies shared with all sites); the seed fills it and sets each site's SEO defaults in English and French.
  Every page of the Astro, Next.js and SvelteKit starters has its title through the site's title template, the
  description, Open Graph and Twitter tags, `robots` for hidden entries, and a canonical URL when the new optional
  `SITE_URL` is set. The Next.js starter no longer applies its own title template, and its revalidation route
  refreshes every page on `site.updated` (which the seed's webhook now subscribes to). See
  [Site starters](documentation/starters.md).

### Changed

- **Admin themes are looks: pick one, nothing follows the OS.** Settings → Appearance and the account menu
  list six looks: **Shapio**, **Cobalt**, **Murdered out** and **Forest** (dark), **Snowed** and **Butter**
  (light). The colour-mode setting (System, Light, Dark) and the light ⇄ dark button beside the account menu
  are gone. Classic is renamed **Cobalt** and keeps its original dark colours; Shapio is the plum dark look.
  Forest (deep green and lime) and Butter (butter yellow and ink) are new. Murdered out is all dark: grey
  actions, no white buttons. An extension theme with both variants is listed twice, as "Name Light" and "Name
  Dark". **Upgrading:** a saved Classic or pre-theme setting becomes Cobalt; Shapio light becomes Shapio; with
  nothing saved the admin opens in Shapio. The keys `forest` and `butter` are now built in, so an extension
  theme can no longer use them. See [First admin: appearance](documentation/first-admin.md#appearance).
- **One log line per request.** Fastify's "incoming request" and "request completed" lines, and the extra
  "request rejected" line on every 4xx, are replaced by one `info` line per response: `reqId`, `method`,
  `route` (the pattern), `path` (no query string), `status`, `ms`, and `site`, `principal` (its kind, never an
  id) and the error `code` when known. The request-start line (redacted URL, host, remote address) and the
  rejection line move to `debug`, and so do health and readiness probes. See `LOG_LEVEL` in the
  [environment reference](documentation/reference/environment.md).
- **Breaking: rich text is delivered as JSON only unless you ask for HTML.** Delivery and preview reads
  (`/api/content`, `/api/preview/content`) take `richText=json|html|both`. The default, `json`, returns the
  stored document `{ format, version, doc }` without `html`; `html` returns `{ format, version, html }`; `both`
  returns the document and `html`, as every delivery read did before. **What breaks:** a site that renders
  `body.html` without passing `richText` now gets no HTML. Sites generated by an earlier `create-shapio` do
  exactly that: add `richText=html` to their delivery and preview requests (`richText: 'html'` with
  `@shapio/client`, which now accepts it on `delivery.list`, `get` and `singleton`). The starters and examples
  ask for `html`. A page of 20 articles with an author shrinks from 78 KB to 52 KB. GraphQL is unchanged except that `RichText.html`
  is rendered only when selected. Generated TypeScript and OpenAPI types describe `doc` and `html` as optional.
- **One version check per request.** A request reads the schema version, the permissions version and its
  site once, in one statement, before any transaction (it used to read the versions again on every permission
  check and schema pin, and the primary site on every request). REST content requests evaluate each model's
  policy once, as GraphQL already did. Every instance still sees a schema or permission change from the next
  request: a permission revoked while a request runs applies from the next one.
- **Fewer statements per delivery read.** A delivery or preview read fetches its rows, the page total and the
  publication sequence (`meta.snapshot`) in one statement. A read that needs nothing more (no relation,
  populate or media follow-up) runs without a transaction; the rest still read one consistent moment inside a
  REPEATABLE READ transaction. Populate reuses the target entries the relation check already read, and field
  usage is recorded after the response is sent.

## [0.3.1] - 2026-10-04

### Added

- **Named admin themes.** Each person picks a theme and a colour mode (System, Light or Dark) from the account
  menu, Settings → Appearance or the sign-in screen; the choice is saved in that browser and applied before
  first paint. Four are built in: **Shapio** (the new brand: plum, cream and acid yellow; light and dark, the
  default), **Classic** (the previous cobalt look, colours unchanged; light and dark), **Murdered out** (dark
  only) and **Snowed** (light only). A theme with one variant ignores the colour mode. Every built-in theme is
  checked for WCAG 2.1 AA contrast. See [First admin: appearance](documentation/first-admin.md#appearance).
- **Extension themes.** `shapio.config` takes `themes: ThemeDefinition[]`: token values for a light and/or dark
  variant. Startup validates the keys, tokens and colour values; `shapio extensions check` lists themes and warns
  about contrast below AA. The admin reads them from two public routes, `GET /api/admin/extensions/themes` and
  `GET /api/admin/extensions/themes.css`. The token list is exported from `@shapio/schema` (`THEME_TOKENS`).
  `examples/extension` adds a Sepia theme. See [Extensions: admin themes](documentation/extensions.md#admin-themes).

### Changed

- **New brand: acid yellow and plum.** The logo is an acid-yellow tile with a plum S; the letters are plum on
  light grounds and cream on dark. It is used in every theme, Classic included, and in the favicon and touch
  icon. The previous blue logo files stay in `brand/` as `classic-*`.
- **Upgrading:** anyone who had chosen System, Light or Dark keeps that colour mode and moves to the **Classic**
  theme, so the admin looks as before (apart from the logo) until they pick another theme. People who never chose
  one, and new installs, get **Shapio** following the operating system. Settings → Theme is now Settings →
  Appearance.

### Fixed

- **Delivery reads no longer deadlock the connection pool under load.** A delivery read runs in one
  transaction; checking a relation target's read permission then read the permissions and schema versions
  through a second pooled connection. With as many concurrent reads as pool connections (10 by default) every
  connection waited for another and the server stopped answering until restarted (seen with
  `?populate=`; relation IDs alone could hit it too). The same nesting happened in GraphQL relation reads,
  admin reads with media, scheduled and change-set publishing, change-set shipping and scheduling, API token
  creation and role edits. Every check inside a transaction now reads through that transaction.
- **An exhausted pool fails fast instead of hanging.** A request that waits longer than
  `DATABASE_POOL_ACQUIRE_TIMEOUT_MS` (default 10000) for a database connection gets `503 DATABASE_BUSY` and
  the error is logged (PostgreSQL and MySQL; SQLite never waits for a pooled connection). On PostgreSQL, a new
  connection that cannot be opened within that time gives `503 DATABASE_UNAVAILABLE`. See
  [Environment variables](documentation/reference/environment.md).

## [0.3.0] - 2026-10-04

### Added

- **Content types per site.** Each site now owns its content types and components; any of them can be shared
  with every site instead. A definition created on a site belongs to that site unless created with
  `scope: "network"` (shared); upgrading makes every existing definition shared, so existing sites see no
  change. A site's view of the schema (its own definitions and the shared ones) is what its admin, REST,
  GraphQL, API docs, extensions, schema files, bundles and agents see: two sites can each have a `post` with
  different fields, and another site's content type is `404` there. A shared definition may only refer to
  shared ones, and its API ID cannot be one any site uses. `PUT /api/admin/models/:id/scope` (and
  `/components/:id/scope`) shares a definition with all sites or keeps a shared one on one site, refused with
  `SCOPE_IN_USE` while another site still has entries of it; a scope change is audited (`schema.scope`) and
  takes no snapshot. A role held on one site grants `schema.create` and `schemaManage` for that site's own
  definitions; shared ones, scope changes, locales and the read-only lock still need a role on every site.
  `me` reports `siteCount` and lists site-granted `schema.create` in `sitePermissions`. A change to a site's own
  content type notifies only that site's webhooks and deployment connections and numbers only its snapshots.
  A site that still owns content types cannot be deleted (`SITE_NOT_EMPTY` counts `definitions`). See
  [Sites](documentation/sites.md#content-types-per-site).

### Changed

- **GraphQL serves one schema per site.** `/api/graphql` answers with the request site's schema: its own
  content types and the shared ones, so two sites can each have a `post` with different fields, and a site's
  content types are absent from another site's schema and introspection. The endpoint now runs on graphql-js
  directly (mercurius removed); status codes and the error shape are unchanged (400 for parse and validation
  errors, 200 when there is data, 405 for a mutation over GET). POST bodies must be JSON:
  `Content-Type: application/graphql` is no longer accepted. The API docs page links the GraphQL endpoint,
  the playground and the OpenAPI document with `?site=`.
- **Schema files per site.** `shapio schema pull|diff|apply --site <key>` (or `SHAPIO_SITE`) works on one
  site's view: shared definitions stay in `models/` and `components/`, the site's own go to
  `sites/<key>/models/` and `sites/<key>/components/`. The lock file moves to format 2 (each entry's site, and
  the sites the tree covers); a format 1 lock still reads as all shared and is rewritten on the next pull. One
  tree can hold several sites: a site's pull and apply never send, rewrite, prune or delete another site's
  definitions. Apply refuses a file moved to another scope (`SCOPE_MISMATCH`), shared changes without
  permission on every site (`FORBIDDEN_SCOPE`, per item) and a tree pulled for other sites only
  (`LOCK_SITE_MISMATCH`); files without site folders (and older CLIs) still create shared definitions. New
  `shapio schema scope <apiKey> --shared | --site <key>` shares a content type with all sites or keeps a shared
  one on one site. The `GET /api/admin/schema/export` response names its `site` and each definition's site.
  GitHub write-back writes its connection's site view. See
  [Schema sync](documentation/schema-sync.md#several-sites).
- **Export and import carry scope.** A bundle holds its site's view of the schema with each definition's
  scope; importing creates the site's own content types on the target site and shared ones shared.
- **Importers, MCP and starters are site-aware.** `shapio import wordpress|strapi --plan --site <key>` plans the
  models as that site's own (without `--site` they are shared). The MCP server's schema tools list the site's
  view with each definition's scope, and `schema_draft` / `change_sets_add_schema_draft` take `shared: true`
  to create a definition shared with all sites. The starters' seed creates the models as the site's own
  (`SHAPIO_SITE`, else the token's site) and writes `SHAPIO_SITE` to `.env`; seeding one starter onto a second
  site is refused until its models are shared ([Site starters](documentation/starters.md#site-key)).
- **Admin: content types per site.** Creating a content type or component asks where it is available: this
  site (the default) or all sites (needs a role on every site); the choice shows only with more than one
  site. Shared types carry a small globe in the sidebar and the Components list, the builder's settings share
  a type with all sites or keep it on one, and the new Network → Content types page lists and creates shared
  ones. A schema role held on one site shows shared types' structure read-only, change set review marks shared
  schema items and names each breaking-field reader's site, and Locales now need a role on every site in the
  sidebar too ([Sites](documentation/sites.md#content-types-in-the-admin)).

### Fixed

- `shapio import --prune` no longer lists other sites' entries and media as candidates for deletion.

## [0.2.1] - 2026-10-04

0.2.0 was only partially published to npm (the server package was refused); 0.2.1 is the first complete
release of these changes.

### Added

- **MySQL 8.4 as a third database** (`DATABASE_URL=mysql://user:password@host:3306/shapio`), with several
  instances and a dedicated worker on one database, like PostgreSQL. Filterable and sortable fields are capped
  at 56 per instance (InnoDB's 64-index limit); with binary logging on, the first migration needs
  `log_bin_trust_function_creators = 1` or a user with SUPER. MariaDB is not supported. The integration suite
  and the admin e2e run on MySQL in CI; `docker-compose.mysql.yml` starts Shapio with MySQL. See
  [MySQL](documentation/mysql.md).
- **SQLite as a second database** (`DATABASE_URL=sqlite:./shapio.db`) for single-process installs, on Node's
  built-in `node:sqlite` with no native dependency; the same admin, APIs, live modelling and change sets.
  `shapio backup <file>` copies a running SQLite database (`VACUUM INTO`). `WORKER_MODE=dedicated` is refused
  on SQLite. The integration suite and the admin e2e run on SQLite in CI. See [SQLite](documentation/sqlite.md).
- **MCP server** (`@shapio/mcp`, `npx -y @shapio/mcp`): an agent in any MCP client can read and draft the
  schema, create and query entries, upload media, open change sets and read their review; `change_sets_ship`
  exists only with `--allow-ship` and still needs the `changes.ship` permission. `shapio mcp` prints the client
  configuration. See [MCP](documentation/mcp.md).
- **Site starters**: Astro, Next.js (App Router) and SvelteKit sites that render the same blog (pages with
  sections, articles, authors and a `siteSettings` singleton) in English and French, pinned to one publication
  snapshot per build, with `SHAPIO_SITE` for multi-site instances.
  `npx create-shapio my-site --site astro|next|sveltekit` writes one as a standalone project with the model
  files, a seed and a smoke check.
- **Next.js starter: on-demand revalidation.** A signed Shapio webhook calls `/api/revalidate/`, which
  refreshes only the pages changed since the site's snapshot; new articles and pages render without a rebuild.
  See [Site starters](documentation/starters.md#incremental-rebuilds).
- **Sites**: one instance runs many sites with a shared schema, admin users and roles, and per-site content,
  media, snapshots, change sets, app users, tokens, webhooks, deployments and field usage. Role assignments are
  per site or on all sites; network permissions (`schema.create`, `users.manage`, `roles.manage`, `audit.read`,
  `sites.manage`, `schemaManage`) need a role on all sites. Requests name their site with `?site=` or the
  `Shapio-Site` header (else the token's site, else the primary site). `shapio sites list|create`,
  `/api/admin/sites` and `/api/admin/sites/:id/app-roles` (per-site `public`/`authenticated` bindings, none on a
  new site); a `site` option in `@shapio/client`; `--site` for `shapio export|import` and `@shapio/mcp`;
  `services.site`, `services.forSite()` and `site` on hook contexts for extensions. See
  [Sites](documentation/sites.md).
- **Vercel and Netlify deployment connections**, next to Cloudflare Pages: Vercel builds start through a
  deploy hook and Netlify builds through its API, and both report real build status from the provider's API
  (with a link to the deployment or deploy log). `VERCEL_API_URL` and `NETLIFY_API_URL` set the API bases
  (defaults: the official APIs). See [Webhooks, deployments and preview](documentation/publishing.md).
- **Importers**: `shapio import wordpress` and `shapio import strapi` (Strapi 5) in two steps. `--plan` reads
  the export and writes schema files and an `import-map.json`, sending nothing; after `shapio schema apply`,
  `--map` uploads the media, creates drafts and opens change sets with the entries that were published at the
  source. Re-running `--map` resumes. See [Moving from WordPress or Strapi](documentation/importers.md).
- `@shapio/schema` now holds the rich-text spec, validator and renderer, and adds `@shapio/schema/html`
  (HTML → rich text).
- Docs: an [extension points catalogue](documentation/extensions-catalogue.md) covering server extensions,
  custom editors, webhooks, deployment providers, the client, CLI, export/import bundles and the MCP server.
- **Assist**: editor assists with your own model provider (`AI_PROVIDER` = `anthropic`, `openai`, or
  `openai-compatible` for Ollama, LM Studio and vLLM): alt text, summaries, translation, rewrites, content-type
  drafts from a description, and content-ops proposals for missing alt text and missing locales. Off by
  default; nothing is sent anywhere while it's off. Assist only proposes or writes drafts into a change set; it
  never publishes. `assist_runs` records who used which model and how many tokens (no prompt or answer text),
  pruned after `USAGE_RETENTION_DAYS`; audit events `assist.*`; settings `AI_MODEL`, `AI_API_KEY`,
  `AI_BASE_URL`, `AI_MAX_TOKENS`, `AI_TIMEOUT_MS`, `AI_RATE_LIMIT_MAX`. See [Assist](documentation/assist.md).
- **Preview and visual editing**: the entry document shows the site beside the document; clicking a field on the
  page focuses it, and saves re-render the page. New package `@shapio/visual` (`shapioAttr`,
  `initVisualEditing`). The admin's CSP frames exactly the preview sites' origins (never Shapio's own); preview
  URLs on Shapio's origin are refused. The Astro, Next.js and SvelteKit starters have `/preview/` with visual
  editing, and the seed creates a Preview connection. See [Visual editing](documentation/visual-editing.md).

### Changed

- The server package is published as `@shapio/cms`; the `shapio` command is unchanged. npm refuses the
  unscoped name. Project extensions import from `@shapio/cms/config`.
- Change sets can have `source: 'assist'`.
- Audit events have a write-order sequence (`audit_events.seq`), so events recorded in the same instant
  (common on SQLite and MySQL, which store milliseconds) list in the order they happened: the audit log, change
  set timelines, and other lists sorted by time now break ties by a stable key. The audit log is rewritten once
  on upgrade. Audit log page cursors issued before the upgrade are rejected (`400 INVALID_CURSOR`); start
  again from the first page.
- The example site moved from `apps/example-site` to `examples/astro` (package `example-astro`); its model
  files and seed moved to `examples/shared`, where all three starters share them. The seed applies the models
  through the schema apply API and also seeds the `siteSettings` singleton.
- **Upgrading to sites** moves everything to the primary site (key `default`); single-site instances behave as
  before, except:
  - app users' access tokens issued before the upgrade are rejected (`401 INVALID_TOKEN`) until the app
    refreshes; refresh tokens keep working;
  - model-wide preview tokens are deleted (preview tokens now always name an entry);
  - field indexes are rebuilt in the background by the `schema.fieldIndexLayout` job;
  - admin role assignments become "all sites", existing admin API tokens become network tokens and delivery
    tokens belong to the primary site;
  - new API tokens belong to the current site; a network admin token needs `"network": true` and
    `users.manage`;
  - webhook bodies gain `site`, and a network webhook (`"network": true`) receives every site's events;
  - the users and invitations APIs take `assignments` (`roleIds` is deprecated and means "on all sites");
  - rolling the migration back is refused while more than one site exists.

## [0.1.0] - 2026-10-03

The first release.

### Added

- **Live content modelling**: collections, single types, reusable components and dynamic zones, 21 field
  types with interchangeable editors, versioned in the database and changed while the server runs, through a
  change planner that validates, backfills, builds indexes and activates atomically, with no restart.
- **Schema sync**: `shapio schema pull | diff | apply` with canonical JSON files, a lock file and per-model
  three-way guards; optional read-only lock; optional GitHub write-back.
- **Content**: drafts with autosave, immutable revisions with restore, per-locale publishing, scheduling and
  atomic change sets; localization with shared and localized fields and fallback chains.
- **Media**: local and S3-compatible storage (R2, S3, B2, …) with direct browser uploads, private files with
  signed URLs, WebP variants, usage tracking and `shapio media migrate`.
- **Delivery**: a REST API with filters, sorting, pagination, populate, field selection, locales, publication
  snapshots and ETags; GraphQL with the same rules and a self-hosted playground; OpenAPI and TypeScript types
  generated from the active schema.
- **Accounts and permissions**: admin users with invitations, sessions and custom roles with field-level
  permissions; API tokens for admins and delivery; end-user accounts with email, Google and GitHub sign-in and
  own-entries permissions; an audit log.
- **Publishing**: signed webhooks with retries and delivery logs; deployment connections (generic signed build
  webhook, Cloudflare Pages, GitHub write-back) with honest run status; preview with scoped, expiring tokens.
- **Extensions**: lifecycle hooks, custom routes, services and jobs, and custom React field editors loaded at
  runtime, configured in `shapio.config.ts`.
- **Content export and import**: `shapio export` and `shapio import` with a dry-run plan, conflict refusal,
  ID-preserving and idempotent imports as resumable jobs, and media with checksums.
- **Distribution**: the `shapio` npm package and `create-shapio`, a Docker image and compose file, built-in
  HTTPS from your own certificate files (reloaded on renewal without a restart), sub-path hosting, a PM2 example and a systemd unit in the docs.
  `@shapio/client`, `@shapio/schema` and `@shapio/editor-sdk` are published for your own code.
- **Operations**: health and readiness endpoints, structured JSON logs with secrets redacted, graceful shutdown
  that drains requests and jobs, a one-line startup summary, and tested coordination of two instances on one
  database.
- **Example site**: an Astro site built from Shapio content, with pinned snapshots, preview and signed build
  callbacks.
- Documentation in `documentation/`.
- **Change sets**: schema drafts and entry publications reviewed together (diffs, planner checks, consumers) and shipped as one snapshot, now, scheduled or followed by a deploy.
- **Snapshot ledger and restore**: every snapshot records why, who and the schema version; restoring snapshot N creates a reviewable change set that ships as a new snapshot (schema is not rolled back).
- **Snapshot diff API**: `GET /api/snapshots/current`, `GET /api/snapshots/changes` and GraphQL `_snapshot`/`_changes` for incremental builds; the example site's `build:incremental` uses them.
- **Field usage**: per-token, per-field read counters from delivery traffic (counts only, kept on your server; `USAGE_TRACKING=false` turns them off), shown on Develop → Live and in change set reviews.
- **Editor experience**: entries open as documents (cover, title, properties strip, block canvas) with an Inbox, a command palette, presence, content-health findings and a publish pre-flight checklist.

### Known limits

- A schema change that converts or backfills stored values rewrites them inside the activation transaction,
  so writes to the affected models wait while it runs (reads continue): up to about 1.5 seconds for 6,000–7,000
  entries in our measurements. A staging table swapped in with one bulk update would shorten this for very large models;
  it is not built yet.

### Changed

- Collections have a plural API ID: delivery lists are `/api/content/articles` and GraphQL `articles`, single entries stay on the singular (`article`).
- Admin redesign: a new design system on the brand palette in light and dark, denser screens, Develop pages (Changes, Snapshots, Schema as code, API explorer, Live).
- No modals: creation, editing and picking happen in side sheets, inline panels and inline confirmations; dialogs remain only for irreversible acknowledgements.
- Releases are now change sets: `releases.manage` → `changes.manage`, `release.*` webhook events → `change_set.*`, the `release` deployment trigger → `change_set`, `/api/admin/releases` → `/api/admin/change-sets` (migrated automatically).
- A change set takes one snapshot number instead of one per entry, and schema conversions record `conversion` revisions so `?snapshot=N` serves converted values.
- First-run setup no longer needs a token by default: while no admin exists, the first person to open
  `/admin/` creates the owner account. Set `SETUP_REQUIRE_TOKEN=true` to require the one-time token logged at
  boot (for installs exposed before setup), or create the owner with `shapio admin create`.

### Removed

- Removed: automatic Let's Encrypt; bring your own certificate.
- Removed: Sentry integration (`SENTRY_DSN`); use an extension for error reporting.
