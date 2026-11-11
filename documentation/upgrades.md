# Upgrades

## What needs a restart, and what never does

| Change                                                                                           | Restart? | Rebuild or deploy?                          |
| ------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------- |
| Models, components, fields, editors chosen per field                                             | **no**   | **no**                                      |
| Content, media, publishing, users, roles, permissions, locales, webhooks, deployment connections | **no**   | **no**                                      |
| Environment variables (`.env`)                                                                   | yes      | no                                          |
| Extensions: `shapio.config.ts`, hooks, routes, services, jobs, custom editor files               | yes      | no (never a rebuild of Shapio or its admin) |
| Upgrading Shapio itself                                                                          | yes      | install the new version                     |

Modeling is data, so it never needs any of this, in any environment, production included.

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

## Upgrading to 0.9.0

0.9.0 gives every component item a stable `id` and stops guessing which stored item a write continues. **The fix
for every write change below is the same: send back the `id` of each item you read**
([Writing components](delivery-api.md#writing-components)). What an existing client can see, most likely first:

1. Every component item in every read has one more key, `id`. Types regenerated with `shapio types generate`
   require it on component items, so object literals in your own tests (fixtures) need an `id` too. GraphQL
   caching clients store component items by `__typename` and `id` ([GraphQL](graphql.md#schema-shape)).
2. On a content type whose components hold a private or deprecated field, an app user's or anonymous caller's
   write that sends a list without `id`s can be refused with `422 CONTENT_INVALID` (`AMBIGUOUS_ITEMS`): editing an
   item, deleting one item and adding another, changing a list that holds look-alikes, or changing a nested list.
   A caller that cannot see the stored items (for example an app user while the entry has unpublished changes)
   is refused for any list with items that holds a field it cannot write.
3. A private field sent inside a component by a delivery caller, even as `null`, is refused with
   `403 FORBIDDEN_FIELD`; a deprecated one, with `422` and an `UNKNOWN_FIELD` issue. Before, the value was stored.
4. Private and deprecated values inside components, and hidden relation targets and media, are kept when a
   client writes back what it read. Before, such a write wiped them.
   So a re-save without `id`s that changes nothing a caller can see no longer fires `entry.updated`: nothing
   changes anymore.
5. On a list with nothing hidden, an item edited without its `id` gets a new `id`, and so do look-alikes in a
   changed list.
6. Refusals come in a fixed order, `404` first, then the body (`422`), `403`, `409`, the items (`422`), and the
   values (`422`), and list at most 100 issues ([Order of refusals](delivery-api.md#order-of-refusals)). Lists
   over their `max`, or over 50,000 items, are refused on the admin API too.
7. A request body nested deeper than 64 levels is refused with `422 BODY_TOO_DEEP`, on every route. Rich text
   nested deeper than about 29 node levels is therefore refused on every database (before, PostgreSQL and SQLite
   accepted up to 40 node levels and MySQL failed). Import bundles are streamed and not covered.

## Going back

Restarting an older version on a database migrated by a newer one is not supported. To go back, restore the
backup you took before upgrading.

Running the 0.9.0 migrations down and up again creates a new item ID key and a new schema ID. Item IDs not yet
stored (items saved before 0.9.0 and not written since) then change, and schema version values issued before
(the `SCHEMA_VERSION` in generated types, and what clients send) answer `400 SCHEMA_VERSION_FOREIGN`: regenerate
your clients' types.

## Compatibility promises

Shapio follows semantic versioning. Breaking changes to these come with a major version and upgrade notes in the
changelog:

- the REST and GraphQL delivery APIs, and the admin API used by `@shapio/client`;
- the extension contract (`@shapio/cms/config`, `EXTENSION_CONTRACT_VERSION`) and the custom editor contract
  (`@shapio/editor-sdk`, `EDITOR_CONTRACT_VERSION`);
- the schema file format and lock file (`shapio schema`), and the export bundle format (`shapio export`);
- configuration variable names.

Shapio's database tables are not part of the contract: read them through the APIs or services, not directly.
