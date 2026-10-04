# Change sets, snapshots and restore

Shapio keeps content the way git keeps code. Every time something goes live, the delivery API moves to a new
numbered **snapshot**, and every snapshot stays readable (`?snapshot=N`). A **change set** is the pull request:
schema edits and entry drafts grouped, reviewed together, and shipped as **one** snapshot, so your sites never
see the new field without the entries that use it, or half of a launch. Shipped something wrong? **Restore** an
older snapshot, which is itself a reviewed change set.

These live under **Develop → Changes** and **Develop → Snapshots** in the admin, for roles with the
`changes.manage` permission (owners, admins and editors by default). Shipping and scheduling a ship also need
`changes.ship` (the same roles by default). A role with `changes.manage` but not `changes.ship` prepares change
sets for someone else to ship: give it to API tokens used by coding agents ([MCP server](mcp.md)).
Adding an entry to a set needs `update` on its model; whoever ships the set needs `publish` on it.

On an instance with several [sites](sites.md), change sets and snapshot numbers are per site: a set holds its
site's entries only and ships as one snapshot there. Its schema items are drafts of definitions in the site's
view. A draft of the site's own content type needs schema permission on that site, and converts content on that
site only. A draft of a shared one (or of a new definition created shared) needs schema permission held on all
sites and is marked "Shared, affects every site": its review lists affected entries per site, and a conversion
takes a snapshot on every site whose published content it changes, recorded there as a conversion naming the
set.

## A change set

A change set has a title, an optional description and items:

- **Entry items**: publish or unpublish one entry in one locale. The item ships the entry's draft as it is when
  the set ships.
- **Schema items**: a proposed definition of a model or component (a new one, a change, or a deletion). These
  are drafts: nothing about the live schema changes until the set ships.

Ways to add work to a set:

- **Changes → Unassigned** lists entry drafts that no open set holds yet, with **Add to…**.
- In a model's builder (the **Structure** tab), **Review** shows the plan and offers two actions. **Review in a
  change set** puts the edit into the newest open set (or a new one, "Schema: <label>") and opens its review.
  **Ship now** puts the edit alone into a new set and ships it at once, with the acknowledgements the plan asked
  for; an edit whose checks run in the background shows as the model's pending change until it is live. Either
  way the builder never activates schema outside a change set.
- **Schema as code** (Develop → Schema) saves the files you changed as schema drafts of the open set, after the
  same three-way check `shapio schema apply` makes.

Two open sets may change the same model. The review says "also changed in" the other set, and whichever ships
second is refused until its draft is rebased on the new live version.

Entries in a set can only use fields that are live now. A field the set's own schema drafts add becomes
available to entries after the set ships (the review says so).

## Review

Open a set to review it, shaped like a pull request:

- **Changes**: each entry as a field-by-field _Live now_ / _After shipping_ diff; each schema item as added,
  changed and removed lines with its classification (additive, metadata, validation, conversion, breaking).
- **Checks**: the change planner's dry run for each schema item (entries affected, values converted, unique
  checks, index builds), validation of every entry against the schema it ships with, open content-health
  findings, and the acknowledgement checkboxes for breaking or destructive changes. **Blocking** issues stop
  the ship; **warnings** do not.
- **Consumers**: for breaking changes, the API tokens (and app users and anonymous callers, as groups) that read
  the affected fields in the last 7 days, with counts and last read. See [Field usage](#field-usage).
- **Timeline**: created, items added and removed, drafts saved, scheduled, entries changed after review (on a
  scheduled ship), shipped (with a link to the snapshot) and the deployment run.

## Ship

**Ship** (needs `changes.ship`) puts the whole set live in one step:

1. Schema items that need checking first (existing entries against a new required field or unique constraint,
   value conversions, new indexes) run their checks in the background while the set shows _Shipping_. Content
   keeps being served and edited meanwhile.
2. Then one database transaction activates the schema items, publishes and unpublishes the entry items against
   the schema that just became active, and takes **one** snapshot number for all of it.

If anything fails (an entry that no longer validates, a check that fails, a [hook](extensions.md) that rejects a
publish) the transaction rolls back: the set shows _Failed_ with the item and the reason, and the live schema and
content are exactly as they were. Fix the cause and ship again.

A ship is strict: if an entry draft, a schema draft or the set itself changed after your review loaded, Shapio
refuses (`409 CHANGE_SET_STALE`) and asks you to refresh and look again. Breaking and destructive changes need
their acknowledgement.

**Schedule…** ships the set at a time you choose. It is checked when you schedule it, and at that time it
ships the entries' latest drafts (not the versions you reviewed); each entry whose draft changed since it was
added or the set was scheduled gets an `item.changedAfterReview` event on the set's timeline. A set with schema checks starts them at the
scheduled time, so it can go live a little after it. **Unschedule** takes it back to open. Single-entry
schedules made from the entry form stay separate and are listed read-only on the Changes page.

**Discard** keeps the set as history and deletes its schema drafts; entry drafts stay as they are.

States: _open_ → _scheduled_ (optional) → _shipping_ → _shipped_, or _failed_ (editable and shippable again),
or _discarded_.

### Ship with deploy

Pick a [deployment connection](publishing.md#deployment-connections) on the set (**Ship with deploy**). After the
set is live, Shapio starts a run of that connection; the build pins the snapshot that is current when it starts
(the one just shipped, unless something else went live in between), and the run appears on the set's timeline.
Connections whose triggers include **Shipping a change set** build after every shipped set anyway.

Content is live before the build finishes. If the build fails, [restore](#restore) the previous snapshot.
Holding a set back until a preview build of it succeeds is not supported yet.

## Snapshots

**Develop → Snapshots** lists every snapshot number: when, why (publish, unpublish, delete, scheduled,
change set, schema conversion, import), who, the schema version live with it, how many entries changed, and the
deployment runs that built it. Snapshots taken before Shapio recorded this show as _Before the ledger_.

A schema change that only renames labels or similar metadata does not take a snapshot: every API response stays
the same. A change that converts stored values does: converted published content is recorded at that number,
so `?snapshot=N` returns converted values for every snapshot from then on. Older snapshots are read through the
current schema; a value stored under an earlier field type comes back as `null`.

Open a snapshot to see what changed since the one before, and scrub through snapshots to see the entries and
schema version at each. **Compare** diffs any snapshot with the live one. Readers pin a snapshot themselves with
`snapshot=N` ([Snapshots and the changes API](snapshots.md)).

## Restore

**Restore** on a snapshot creates a new open change set, "Restore snapshot N", that brings live content back to
what N served:

- entries changed or taken offline since N publish the version N served (their current drafts are left alone);
- entries published since N are unpublished.

Nothing goes live until you review and ship it, as a **new** snapshot; N and everything after it stay readable,
and nothing is deleted. **The schema is not rolled back**: reverting a contract is itself a breaking change, so
the review shows schema differences as information only.

Entries that cannot be restored are listed in the review with the reason, never skipped silently: the entry was
deleted, its model is gone or no longer has drafts, its localization or locale changed, the old version no longer
fits the current schema, or a unique value is now used by another entry. A restore holds at most 5,000 items;
restore a newer snapshot if you hit that (`422 CHANGE_SET_TOO_LARGE`).

## Field usage

Shapio counts which fields your sites and apps actually read, so a breaking change shows who it breaks before
you ship it. Every delivery read (REST and GraphQL) adds to a counter per day, per model, per field, per reader:
each API token by name, app users as one group, anonymous callers as one group. Admin users, admin API tokens and
previews are not counted. Counters are kept per [site](sites.md). **Develop → Live** shows who reads what; the change set review shows the readers of
the fields a breaking change touches: for a site's own content type that site's readers, for a shared one the
readers on every site (each labelled with its site, or the other sites as totals for admins of one site).

Ask for the fields you use (`fields=` in REST, a selection in GraphQL). A REST read without `fields=` counts
every field as used, shown as "reads the whole model", which hides what a site really depends on.

It stays on your server: counts only, never values, queries or IP addresses, in your own database. Counters are
kept per instance in memory and written every 30 seconds. Settings:

| Variable                  | Default | Meaning                                               |
| ------------------------- | ------- | ----------------------------------------------------- |
| `USAGE_TRACKING`          | `true`  | `false` stops counting                                |
| `USAGE_RETENTION_DAYS`    | `90`    | days of counters kept (pruned by the daily retention) |
| `USAGE_FLUSH_INTERVAL_MS` | `30000` | how often each instance writes its counters           |

## API

Everything above is available to admin API tokens and admin sessions (sessions also send `X-CSRF-Token`). The
admin API names models by their singular API ID.

```sh
# Create a set and add an entry publication
curl -X POST "$SHAPIO_URL/api/admin/change-sets" -H "Authorization: Bearer $SHAPIO_TOKEN" \
  -H 'Content-Type: application/json' -d '{"title":"Autumn launch"}'
curl -X POST "$SHAPIO_URL/api/admin/change-sets/<set id>/items" -H "Authorization: Bearer $SHAPIO_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"modelKey":"article","entryId":"<entry id>","locale":"en","action":"publish"}'

# Review, then ship with the set version the review showed
curl "$SHAPIO_URL/api/admin/change-sets/<set id>/review" -H "Authorization: Bearer $SHAPIO_TOKEN"
curl -X POST "$SHAPIO_URL/api/admin/change-sets/<set id>/ship" -H "Authorization: Bearer $SHAPIO_TOKEN" \
  -H 'Content-Type: application/json' -d '{"expectedVersion":3,"acknowledgeBreaking":true}'
```

| Endpoint                                           | What                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /api/admin/change-sets?status=open,scheduled` | sets, newest first (`cursor`, `limit`); discarded sets only when asked for             |
| `POST /api/admin/change-sets`                      | `{ title, description? }`                                                              |
| `GET`, `PATCH /api/admin/change-sets/:id`          | read; change `title`, `description`, `deploymentConnectionId` (with `expectedVersion`) |
| `GET /api/admin/change-sets/unassigned`            | entry drafts no active set holds                                                       |
| `POST …/:id/items`, `DELETE …/:id/items/:itemId`   | add `{ modelKey, entryId, locale?, action: publish \| unpublish }`; remove an item     |
| `GET`, `PUT`, `DELETE …/:id/schema/:definitionId`  | a schema draft: `{ category, definition \| null, baseVersion, expectedDraftVersion? }` |
| `GET …/:id/review`, `GET …/:id/timeline`           | the review (diffs, checks, consumers, notices) and the timeline                        |
| `POST …/:id/ship`                                  | `{ expectedVersion, acknowledgeBreaking?, acknowledgeDestructive?, itemVersions? }`    |
| `POST …/:id/schedule`, `POST …/:id/unschedule`     | `{ at, expectedVersion, acknowledge… }`                                                |
| `POST …/:id/discard`                               |                                                                                        |
| `GET /api/admin/snapshots`, `GET …/snapshots/:seq` | the snapshot ledger (`cursor`, `limit`) with the current number                        |
| `POST /api/admin/snapshots/:seq/restore`           | creates the restore set                                                                |
| `GET /api/admin/usage/fields?modelId&days=7`       | reads per field and reader for one model (needs `tokens.manage`)                       |

`ship` answers `200` when the set shipped (or failed: see `status` and `error`) and `202` while it is shipping
in the background; poll the set until it is `shipped` or `failed`. `itemVersions` (`[{ itemId, draftVersion }]`,
as the review lists them) makes the ship refuse with `409 CHANGE_SET_STALE` when one of those drafts moved. A
shipped set reports `shippedSnapshot` and, when it had schema items, `schemaVersionAfter`.

Other refusals: `409 VERSION_CONFLICT` (the set changed since you read it), `409 CHANGE_SET_LOCKED` (a set that
is shipping, shipped or discarded cannot change), `409 CHANGE_SET_NOT_SHIPPABLE`, `409 CHANGE_SET_ITEM_EXISTS`,
`409 SNAPSHOT_IS_CURRENT` (restoring the live snapshot).

## Webhooks

Subscribe to `change_set.*` or single events ([Webhooks](publishing.md#webhooks)):

| Event                  | When                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| `change_set.scheduled` | a set was scheduled (`at`)                                                |
| `change_set.shipping`  | a ship started its background checks                                      |
| `change_set.shipped`   | the set is live: `snapshot`, `schemaVersion`, `schemaItems` and the items |
| `change_set.failed`    | the ship failed and nothing went live: `failedItemId`, `error`            |
| `change_set.discarded` | the set was discarded                                                     |

Each entry item also sends its own `entry.published` or `entry.unpublished`.

## Schema sync and the CLI

`shapio schema apply` does not go through change sets: it activates each definition directly through the same
change planner, guarded per model as before ([Schema sync](schema-sync.md)). Use the Schema-as-code page (or the
schema draft endpoints) when you want a git-style apply to wait for review and ship together with content.

## Coming from releases

Releases became change sets with only entry items. Upgrading moves them over: open releases become open sets,
published ones shipped sets, cancelled ones discarded sets, and scheduled ones keep their time. The
`releases.manage` permission is now `changes.manage`, webhook subscriptions to `release.*` become `change_set.*`
(`release.published` is `change_set.shipped`), and the deployment trigger **on release** is now **Shipping a change set** (`change_set`).
`/api/admin/releases` is gone; use `/api/admin/change-sets`.
