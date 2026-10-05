# Shapio documentation

Shapio is a self-hosted headless CMS and API platform. You model content in the admin while it runs in
production, editors write and publish it, and your sites and apps read it over REST and GraphQL. Changing a
model never needs a rebuild, a restart or a deploy.

## Get it running

- [Install with npm](install-npm.md): `npx create-shapio`, run under PM2 or systemd.
- [Install with Docker](install-docker.md): the image and `docker compose`.
- [First admin](first-admin.md)
- [Networking without a reverse proxy](networking.md): `PUBLIC_URL`, `BASE_PATH`, HTTPS from your own
  certificate files, Cloudflare in front.
- [SQLite](sqlite.md): one file instead of a PostgreSQL server, for a single process; limits, backups, moving
  to PostgreSQL.
- [MySQL](mysql.md): MySQL 8.4 instead of PostgreSQL; setup, how it differs, backups.
- [Local development](local-development.md): working on Shapio itself.

## Build with it

- [Modelling](modelling.md): models, components, dynamic zones, field types, editors, what changes live.
- [Localization](localization.md): locales, localized and shared fields, fallbacks, per-locale publishing.
- [Schema sync](schema-sync.md): `shapio schema pull | diff | apply`, the lock file, git write-back.
- [Content](content.md): drafts, autosave, revisions, publishing and scheduling.
- [Assist](assist.md): editor assists with your own model provider; opt-in, proposals only.
- [Change sets, snapshots and restore](change-sets.md): schema and content reviewed and shipped as one
  snapshot, restoring an older snapshot, field usage from real traffic.
- [Media](media.md): local disk and S3/R2, uploads, private media, variants, `shapio media migrate`.
- [Delivery API (REST)](delivery-api.md): filters, sort, populate, fields, locale, snapshots, tokens, caching.
- [SEO fields](seo.md): the built-in SEO group, per-site defaults (Settings → SEO), `seo=resolved`.
- [GraphQL](graphql.md)
- [Snapshots and the changes API](snapshots.md): pinning builds, what changed between two snapshots,
  incremental builds and `revalidatePath`.
- [End users](end-users.md): sign-up, sign-in, Google and GitHub, roles, owner-only writes.
- [Webhooks, deployments and preview](publishing.md): the generic signed hook, Cloudflare Pages, Vercel, Netlify,
  preview links.
- [Sites](sites.md): several sites on one instance (one team; content types per site or shared with all sites;
  separate content, tokens, snapshots and app users); which site a request reads, permissions, upgrade notes.
- [Visual editing](visual-editing.md): preview drafts beside the document and click a part of the page to edit
  its field.
- [Extensions](extensions.md): hooks, custom routes and services, jobs, custom field editors.
- [Extension points catalogue](extensions-catalogue.md): every way to extend or integrate Shapio, with its
  contract, where it runs, versioning and limits.
- [MCP server for coding agents](mcp.md): Claude Code, Cursor and Claude Desktop model content, write drafts
  and open change sets; people ship them.
- [Site starters](starters.md): Astro, Next.js and SvelteKit sites on Shapio (`create-shapio --site`).
- [Example site walkthrough](example-site.md): model a page, publish it, see an Astro site update.

## Run it

- [Backup and restore](backup-restore.md): PostgreSQL and media, and content export/import.
- [Moving from WordPress or Strapi](importers.md): importing a WordPress or Strapi 5 export into reviewable
  change sets.
- [Upgrades](upgrades.md): what needs a restart and what never does.
- [Security](security.md): sessions, CSRF, tokens, outbound requests, limits, reporting a vulnerability.

## Reference

- [Environment variables](reference/environment.md) (generated from the server's configuration schema)
- [CLI](reference/cli.md) (generated from the command definitions)
- [REST API](reference/rest-api.md) (generated from Shapio's OpenAPI generator)

Your running instance also documents itself: admins find the OpenAPI document for the current schema at
`/api/docs`, and the GraphQL playground under **Develop → GraphQL** (`/api/graphql/playground`).
