# Changelog

All notable changes to Shapio are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **GraphQL serves one schema per site.** `/api/graphql` answers with the request site's schema: its own
  content types and the shared ones, so two sites can each have a `post` with different fields, and a site's
  content types are absent from another site's schema and introspection. The endpoint now runs on graphql-js
  directly (mercurius removed); status codes and the error shape are unchanged (400 for parse and validation
  errors, 200 when there is data, 405 for a mutation over GET). POST bodies must be JSON:
  `Content-Type: application/graphql` is no longer accepted. The API docs page links the GraphQL endpoint,
  the playground and the OpenAPI document with `?site=`.

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
