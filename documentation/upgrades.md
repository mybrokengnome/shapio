# Upgrades

## What needs a restart, and what never does

| Change                                                                                           | Restart? | Rebuild or deploy?                          |
| ------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------- |
| Models, components, fields, editors chosen per field                                             | **no**   | **no**                                      |
| Content, media, publishing, users, roles, permissions, locales, webhooks, deployment connections | **no**   | **no**                                      |
| Environment variables (`.env`)                                                                   | yes      | no                                          |
| Extensions: `shapio.config.ts`, hooks, routes, services, jobs, custom editor files               | yes      | no (never a rebuild of Shapio or its admin) |
| Upgrading Shapio itself                                                                          | yes      | install the new version                     |

Modelling is data, so it never needs any of this, in any environment, production included.

## Upgrading Shapio

1. Read the [changelog](../CHANGELOG.md) for the versions between yours and the new one.
2. [Back up](backup-restore.md) the database and media.
3. Install the new version and restart:

   - npm: `npm install @shapio/cms@latest` in the project, then `pm2 restart my-cms` (or
     `sudo systemctl restart shapio`).
   - Docker: `docker compose pull && docker compose up -d`.

4. Check `npx shapio status` and the log.

Shapio applies its own database migrations on start (`MIGRATE_ON_START=true`), under a PostgreSQL advisory
lock, so instances starting together migrate once. To migrate as a separate step instead (for example before
switching traffic), set `MIGRATE_ON_START=false` and run `npx shapio migrate` with the new version first. A
dedicated worker (`shapio worker`) refuses to start while migrations are pending, and so does the server when
`MIGRATE_ON_START=false`: it names the number of pending migrations and tells you to run `shapio migrate`. Migrations only ever touch
Shapio's own tables; your content models have none.

On shutdown (SIGTERM) Shapio stops taking requests and jobs, lets running ones finish
(`SHUTDOWN_TIMEOUT_MS`), and releases unfinished jobs back to the queue. Jobs interrupted by a crash are picked up
again once their lease expires; scheduled publishes still run exactly once.

## Going back

Restarting an older version on a database migrated by a newer one is not supported. To go back, restore the
backup you took before upgrading.

## Compatibility promises

Shapio follows semantic versioning. Breaking changes to these come with a major version and upgrade notes in the
changelog:

- the REST and GraphQL delivery APIs, and the admin API used by `@shapio/client`;
- the extension contract (`@shapio/cms/config`, `EXTENSION_CONTRACT_VERSION`) and the custom editor contract
  (`@shapio/editor-sdk`, `EDITOR_CONTRACT_VERSION`);
- the schema file format and lock file (`shapio schema`), and the export bundle format (`shapio export`);
- configuration variable names.

Shapio's database tables are not part of the contract: read them through the APIs or services, not directly.
