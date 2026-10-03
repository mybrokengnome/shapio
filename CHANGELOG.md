# Changelog

All notable changes to Shapio are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Site starters**: Astro, Next.js (App Router) and SvelteKit sites that render the same blog (pages with
  sections, articles, authors and a `siteSettings` singleton) in English and French, pinned to one publication
  snapshot per build, with `SHAPIO_SITE` for multi-site instances.
  `npx create-shapio my-site --site astro|next|sveltekit` writes one as a standalone project with the model
  files, a seed and a smoke check.

### Changed

- The example site moved from `apps/example-site` to `examples/astro` (package `example-astro`); its model
  files and seed moved to `examples/shared`, where all three starters share them. The seed applies the models
  through the schema apply API and also seeds the `siteSettings` singleton.

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
