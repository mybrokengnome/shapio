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

1. Every component item in every read has one more key, `id`. A client that reads an entry and sends it back,
   with the `id`s the read now includes, keeps working, also after someone else changed the entry and it retries
   after a `409`. The one exception is a field whose components have a private or deprecated field: there a stale
   `id` answers `UNKNOWN_ITEM_ID`, and reading the entry again fixes it. A write retried after a 409 with `id`s no
   version shows is saved with those items as new, except that it is refused with `UNKNOWN_ITEM_ID` on a list
   whose items can hold values hidden from the caller, and with `AMBIGUOUS_ITEMS` when the caller cannot see the
   draft. Types regenerated with `shapio types generate`
   require it on component items, so object literals in your own tests (fixtures) need an `id` too. GraphQL
   caching clients store component items by `__typename` and `id` ([GraphQL](graphql.md#schema-shape)).
2. On a content type whose components hold a private or deprecated field, an app user's or anonymous caller's
   write that sends a list without `id`s can be refused with `422 CONTENT_INVALID` (`AMBIGUOUS_ITEMS`): editing an
   item, deleting one item and adding another, changing a list that holds look-alikes, or changing a nested list.
   A caller that cannot see the stored items (for example an app user while the entry has unpublished changes)
   is refused for any list with items that holds a field it cannot write. The first write to a new locale treats
   its localized lists as all new, for any caller, with or without `id`s.
3. A private field sent inside a component by a delivery caller, even as `null`, is refused with
   `403 FORBIDDEN_FIELD`; a deprecated one, with `422` and an `UNKNOWN_FIELD` issue. Before, the value was stored.
   Through a schema version that showed the field, sending back the `null` a read gives is accepted and keeps the
   stored value; any other value, or a field that version never showed, is `403`.
4. Private and deprecated values inside components, and hidden relation targets and media, are kept when a
   client writes back what it read. Before, such a write wiped them, so re-saving what a caller read changed the
   entry. A re-save without `id`s now goes one of three ways:
   - It changes nothing (no new revision, no `entry.updated`, `id`s kept) when the caller sends back exactly what
     it read and can see the stored items, or when it cannot see them but can write the whole list and sends it
     exactly as stored, as before 0.9.0.
   - It is refused with `AMBIGUOUS_ITEMS` when the caller cannot see the draft it writes (an app user whose draft
     is ahead of the published version) and the list holds a field it cannot write. Send the `itemIds` from the
     last write response.
   - Anything else that differs from what is stored is written.
5. On a list with nothing hidden, and in every admin API save, an item edited without its `id` gets a new `id`,
   and so do look-alikes in a changed list. A delivery client that later sends back an old `id` gets what
   [Item IDs](delivery-api.md#item-ids) gives for an `id` the draft does not hold (item 1).
6. Refusals come in a fixed order: after the rate limit, authentication, the workspace, the CSRF check, the
   body depth check, and the body schema, `403` for the content type and `404`, then the body (`422`), a forbidden field (`403`), `409`, the items (`422`), and the values (`422`).
   They list at most 100 issues ([Order of refusals](delivery-api.md#order-of-refusals)). Lists
   over their `max`, or over 50,000 items, are refused on the admin API too.
7. Item IDs add about 20 bytes to every component item, so an entry that was just under the 1 MiB request limit
   can now answer `413`. If you have such entries, raise `REQUEST_BODY_MAX_BYTES` (default 1,048,576; 1 KiB to
   1 GiB).
8. A GraphQL document longer than `GRAPHQL_MAX_TOKENS` (default 5,000 tokens) answers `400 QUERY_TOO_LARGE`. Full
   introspection is 184 tokens and the API explorer's largest generated queries about 2,500, so ordinary clients
   are far under it.

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
