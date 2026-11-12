# Schema lenses

A site or app is built against one version of your schema, and the schema keeps moving after it ships. A client
that names the schema version it was built against gets today's content in that version's shape: that
version's routes, API IDs, field types, and components, whatever changed since. A client that names no version
gets today's shape, exactly as before.

Server 0.9.0 or later. Nothing is generated or stored per version: Shapio keeps every version of every content
type, and fields keep their stable IDs through renames, so it can present today's content in any earlier
version's shape on the fly.

## An example

At schema version 17, the `article` content type has `title` (short text), `teaser` (long text), and
`readingTime` (an integer, minutes). A site is built against it and deployed. Its client
names version 17 with every request:

```sh
curl -H "Authorization: Bearer $SHAPIO_DELIVERY_TOKEN" \
  "$SHAPIO_URL/api/content/articles?fields=title,teaser,readingTime&pageSize=1&schemaVersion=$SCHEMA_VERSION"
```

Then two changes ship: `teaser` is renamed `excerpt` (version 18), and `readingTime` becomes short text
(version 19; Shapio converts `4` to `"4"` as the change goes live). The deployed site sends the same request and
gets the same shape it was built for:

```json
{
  "data": [
    {
      "id": "6f2c0a1e-4b7d-4f3a-9c55-1e8d2b7a9f40",
      "__model": "article",
      "__kinds": ["article"],
      "locale": "en",
      "createdAt": "2026-10-01T09:12:44.512Z",
      "updatedAt": "2026-11-10T14:02:19.880Z",
      "publishedAt": "2026-11-10T14:02:19.880Z",
      "title": "Why builds pin a snapshot",
      "teaser": "One number per build, so a publish never lands halfway.",
      "readingTime": 4
    }
  ],
  "meta": {
    "locale": "en",
    "snapshot": 42,
    "pagination": { "page": 1, "pageSize": 1, "total": 12, "pageCount": 12 },
    "schemaVersion": {
      "requested": "0d5c8f2a-6b1e-4c3d-9f70-2e8a4b6c1d95:17",
      "current": "0d5c8f2a-6b1e-4c3d-9f70-2e8a4b6c1d95:19"
    }
  }
}
```

`teaser` is read from the field now called `excerpt`, and the stored text `"4"` is converted back to the
integer `4` (a value written since that is no whole number, such as `"about 5"`, reads `null`).
The response also carries the header
`Shapio-Schema-Version-Current: 0d5c8f2a-6b1e-4c3d-9f70-2e8a4b6c1d95:19`, so the site can tell that newer types
exist. Delivery, preview, snapshot, and GraphQL responses carry it, whether or not the request names a
version, when they answer a caller authorized for the route: every success, and the errors given only after
authorization (`409`, `422`, and the `SCHEMA_VERSION_*` and `LENS_*` errors answered once the caller is
authorized). A `401`, `403`, `404`, or any other `400` never carries it, so a caller with no grant learns nothing
about the schema. `meta.schemaVersion` is on every
read that names a version, today's included.

Without `schemaVersion`, the same request fails with `400 INVALID_QUERY` (`Unknown field "teaser"`), and a read
without `fields=` returns `excerpt` and the text `"4"`, which code written for version 17 does not expect. A
client built against version 19 names it, or names nothing, and reads `excerpt` and `"4"`.

## Turning it on

### With `@shapio/client`

`shapio types generate` writes `SCHEMA_VERSION` next to the types, the version they describe:

```ts
// shapio-types.ts (generated)
export const SCHEMA_VERSION = '0d5c8f2a-6b1e-4c3d-9f70-2e8a4b6c1d95:17' as const;
```

Pass it to the client, so the client asks for exactly the shape its types describe:

```ts
import { createClient } from '@shapio/client';
import { SCHEMA_VERSION } from './shapio-types';

export const shapio = createClient({
  baseUrl: process.env.SHAPIO_URL!,
  token: process.env.SHAPIO_DELIVERY_TOKEN,
  schemaVersion: SCHEMA_VERSION,
});
```

When the schema moves, the deployed client keeps working. When you are ready for the new shape, regenerate the
types, fix what the compiler points out, and deploy: the client moves forward with its types.

The value is `<schemaId>:<version>`. The schema ID is a random ID of the instance, because version numbers are
counted per instance: version 17 on your laptop and version 17 in production are different schemas. A version
from another instance is refused with `400 SCHEMA_VERSION_FOREIGN`. **Generate the types against the instance
the client reads from** (or leave `schemaVersion` out for a client that reads more than one instance).

The option needs server 0.9.0 or later. An older server refuses the `schemaVersion` query parameter with a
`400`, on purpose: a loud error is better than a response in a shape the client does not expect.

### Over HTTP

Send the schema version as the `?schemaVersion=` query parameter or as the `Shapio-Schema-Version` header. Both work on
the delivery routes (reads and writes), previews, the snapshot routes, the API docs (`/api/docs`), and GraphQL;
other routes ignore them.

```sh
curl -H "Shapio-Schema-Version: $SCHEMA_VERSION" "$SHAPIO_URL/api/content/articles"
```

- Behind a CDN that keys its cache on the URL alone, use the query parameter: such a CDN ignores `Vary`, and
  two schema versions must never share a cached response. Responses vary on `Shapio-Schema-Version`.
- A request whose query parameter and header name different versions is refused with
  `400 SCHEMA_VERSION_MISMATCH`; a repeated `?schemaVersion=` with `400 INVALID_QUERY`.
- `@shapio/client` sends the query parameter on delivery and snapshot reads and the header on everything else.
  `@shapio/local` takes the same option: `createLocalClient({ …, schemaVersion: SCHEMA_VERSION })`
  ([In-process delivery](in-process.md#options)).

### In the API explorer

Develop → API explorer has a **Schema version** box on the REST request: type a version number (empty is
today's shape) and the request, and its curl and fetch snippets, send `?schemaVersion=<schemaId>:<number>` for
this instance, so you can see what a client on that version reads.

### In the starters

The [starters](starters.md#schema-version) pass `SCHEMA_VERSION` to their client. A built site keeps reading in
the shape it was built for when the schema moves, and moves to the current shape when you regenerate its types.

### Pinning a token

When you can't change the client (an app already in the store, a kiosk, a partner's integration), pin its API
token instead: Settings → API tokens → **Edit**, then type a schema version or click **Pin to the current
version**. Over the admin API, send `pinnedSchemaVersion` (a version from 1 to the current one, or `null` to
clear it) on `POST /api/admin/tokens` or `PATCH /api/admin/tokens/:id`.

- A request made with a pinned token that names no schema version is served as if it had named the pin, on
  every route above: reads, writes, previews, snapshots, the API docs, and GraphQL. Writes follow the
  [Writes](#writes) rules, GraphQL mutations included.
- A version the request names wins over the pin.
- The token list says "Pinned to schema version 42" (or "Sends schema version 42" when the client names its
  own), and flags a pin the [history](#limits) does not reach: reads of those content types answer
  `409 SCHEMA_VERSION_UNAVAILABLE`.
- A pinned token is listed in the change set review as a reader on its version even before it reads anything.
- Clear the pin once the client is updated to the current schema. Each change is in the audit log
  (`api_token.update`).

## What a client on an older version sees

Each change between the client's version and today has one of these effects. When several changes touch the
same field, the client sees the combined result: a field renamed twice still reads under the name the client
knows.

| Effect                     | Changes since the client's version                                                                                                                                                                                                                              | What the client gets                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keeps working**          | a field's API ID renamed; a content type's API ID or plural API ID renamed (its route); a component's API ID renamed; field order; labels, descriptions, and help text; the editor; fields, content types, or components added; a field made required or unique | no difference: its own routes and API IDs, and no fields it does not know                                                                       |
| **Converted**              | a type change whose values all read back in the old type (a number field made an integer, long text made short text); a multiple field made single                                                                                                              | the value in the old type (the integer `4` as the number `4`); a single value as a one-item list                                                |
| **Some values read empty** | a type change where not every value fits the old type (an integer field made text: `"about 5"` is no integer); enum values or dynamic zone components added since; a single field made multiple; a relation's target widened                                    | the values that fit, item by item in a list; `null` (`[]` for lists) when none does; a field that became a list reads its first value that fits |
| **Reads empty**            | a field removed; values a type change dropped (text made a number: Shapio does not convert text to numbers); a field made private (`public` off) or deprecated; a component field switched to another component                                                 | `null` (`[]` for lists), always                                                                                                                 |
| **Gone**                   | the content type deleted                                                                                                                                                                                                                                        | `404`, like any unknown content type                                                                                                            |
| **Not covered**            | a collection made a single type, or the reverse                                                                                                                                                                                                                 | `409 LENS_UNCOVERED`                                                                                                                            |
|                            | `filterable` or `sortable` turned off                                                                                                                                                                                                                           | old filters or sorts on that field are refused, as for any client                                                                               |
|                            | localization turned on or off (on a content type or a field), drafts turned on or off, locales added or removed                                                                                                                                                 | not hidden: the client sees today's locales and today's values                                                                                  |

A value is shown in the old type whenever some conversion reaches it, directly or through text, so a client
several versions back never reads less than it would after each change in turn: a number field made text
and then a multi-value enum still reads `4` for an entry holding `["4"]`. A number read as a decimal or a big
integer keeps its exact digits (`"0.0000001"`, never `1e-7`). A number or integer field reads text exactly as
a type change converts it (`"1e3"` reads 1000, `"0x10"` reads 16, `" 12 "` reads 12). Every other field reads
text as written when it fits, else trimmed, else as the exact number it spells (`" 7 "` reads as the ID `7`,
`"007"` as the big integer `7`); that last reading is skipped for text of more than 64 characters or with an
exponent beyond 400, so such text reads only as written or trimmed. An empty multi-value enum reads `null`, as
it does for a client that names no version.

A component or dynamic zone takes the effect of what is inside it, with one difference: a field inside it that
reads empty leaves the component and its items in place, so the component is **Some values read empty**, not
**Reads empty**. It reads empty only when none of its items can be read (its component deleted, or no component
both versions allow).

Every component item reads with its `id` through every version, the same `id` it has without one. Like an
entry's `id` it is not a field, so no schema change affects it, and a client can send it back on writes through
its version ([Writes](#writes)).

Two more things drop out of an old client's view rather than appear in a shape it never saw:

- entries of [kinds](modeling.md#types-that-extend-a-type) created after its version, in a parent's list;
- relation targets of content types it does not know (created after its version, or added to a relation's
  target since), left out of the relation as an unreadable target is.

## Queries

`filters`, `sort`, `fields`, and `populate` take the API IDs of the client's version:
`filters[teaser][$null]=false` works for the client in the example. The query runs on today's storage, so:

- A filter or sort on a field whose stored form changed since the version (a text field that is now an
  integer), or that no longer exists, is refused, never answered on today's values in a way the old client did
  not mean. For a caller whose grant on the content type names no fields, and a field that was public at the
  version, the refusal is `400 LENS_QUERY_UNSUPPORTED` naming the field; for anyone else it is the answer for a
  field that does not exist (`400 INVALID_QUERY`, unknown field), so a query never tells a caller about fields it
  was not shown.
- `fields=` may name a field that was removed since, or that the caller reads as `null` (see below), under the
  same condition: it is accepted and reads `null`. For anyone else a removed field in `fields=` is an unknown
  field (`400 INVALID_QUERY`).
- A filter or sort the field no longer allows (`filterable` or `sortable` turned off) is refused, as for every
  client.

## Visibility and permissions are today's

A schema version changes the shape of a response, never who may read what: through every version a caller
sees exactly what it sees without one, deprecation included. A field it cannot read today (made private,
deprecated, outside its role's grant now, or removed) never carries a value:

- for a caller whose grant on the content type names no fields (it reads every public field), a field that was
  public in the client's version reads `null` (`[]` for lists), at the top level and inside components, and
  `fields=` may name it;
- for a caller whose grant names fields, it is left out; `fields=` naming it answers as without a version (`403`
  for a field that exists today and it may not read, `400 INVALID_QUERY` for one removed since).

Filters and sorts on such a field are refused exactly as without a version. Row conditions (owner-only reads)
are today's too. Over GraphQL such a field follows the same rule ([GraphQL](#graphql)).

A request the caller is not authorized for gets exactly the answer it gets without a version, whatever version
it names: the same `401`, `403`, or `404`, never a lens-specific error, and never an error about the version
itself (malformed, from another instance, or newer than this instance). Those answer only a caller that may
read (or write) what it asked for.

## With snapshots

`?snapshot=N` and a schema version work together: **the snapshot picks the content, the schema version picks
the shape**. A build pinned to snapshot 42 and schema version 17 reads what was live at snapshot 42, presented
as version 17 presents it:

```sh
curl -H "Authorization: Bearer $SHAPIO_DELIVERY_TOKEN" \
  "$SHAPIO_URL/api/content/articles?snapshot=42&schemaVersion=$SCHEMA_VERSION"
```

It is not a replay of the response the instance served at that moment: permissions and visibility are today's,
and a value a conversion dropped stays empty. A snapshot read that names no schema version is unchanged
([Snapshots](snapshots.md#pinning-a-build)).

The [snapshot diff](snapshots.md#what-changed-between-two-snapshots) honors the version too: it names entries by
the route keys and API IDs of the client's version, and leaves out content types the version does not know.

## Writes

Writes through the delivery routes (app users creating or editing entries, [End users](end-users.md)) that name
a schema version are accepted for the fields that are unchanged since that version, or only renamed: the body
uses the old API IDs and Shapio stores the values under today's fields.

Any other field in the body (one whose type or settings changed, or that was removed) is refused. One
`422 LENS_WRITE_UNSUPPORTED` lists every such field in `details.issues`, each with a JSON pointer in the
client's API IDs (`/count`) and how the field changed (`changed type (integer → string)`, `was removed`,
`became per locale`), and nothing is written. A field removed since is named `was removed` only where a read
shows it (as `null`): for a caller whose write grant names no fields, and a field that was public in that
version. For anyone else it is `UNKNOWN_FIELD`, as for a name the version never had. A removed field is known
by its stable ID only: its value never lands in a field added since under the same API ID. A field the caller
may not write today gets today's answer (`403 FORBIDDEN_FIELD`), never a reason the version gives. The exception
is a value equal to what a read through the same version returns for that field: a client that sends back the
entry it just read, with one field edited, is not refused for the fields it did not touch, and those keep their
stored values (not the value sent back). The same holds for a field inside a component that is private to the
caller's audience, or deprecated, today: when the client's version showed the field, sending back the `null` a
read gives is accepted and keeps the stored value. Any other value for it, or any value for such a field the
client's version never showed, answers `403 FORBIDDEN_FIELD`.

Only the delivery routes (`/api/content`) and [GraphQL](#graphql) take a schema version on writes. The admin
content API (`/api/admin/content`) always reads and writes today's shape: it ignores the header, and a route that
accepts only known query parameters refuses `?schemaVersion=` with `400 VALIDATION_ERROR`, as any unknown one;
others ignore it.

A write through a version starts from what the write itself starts from today, a locale's first draft included
(its shared values come from the entry's other locales), whether or not the caller may read the entry. Fields a
caller cannot read are never cleared by a write, with or without a version: sent back empty they keep their
stored value, and inside a component instance (written whole) they are carried over from the stored instance.
A value the client sends back is compared with what a read of the same version returns for the entry's draft or
its published version, media and populated relations by ID.

Shapio does not convert written values back to today's type: a write through a lossy conversion would replace
data the old client could not see. To write such a field, move the client to the current version.

A component instance is written whole. Fields inside it that the client cannot read, does not know (added
since its version), or cannot write (changed since) keep their stored values, carried over from the stored item
it continues. Shapio finds that item the same way for every client, with or without a version
([Delivery API](delivery-api.md#writing-components)):

- An item sent back with its `id` continues that stored item, in any order. This is the way to write lists
  through an older version: read the entry, change what you need, and send each item back with its `id`.
- Items sent without `id` are matched by what the client sees of each item through its version, in one of three
  ways ([Writes without item IDs](delivery-api.md#writes-without-item-ids)). A client that cannot see the stored
  items, but can write every field in a list, changes nothing by sending it exactly as stored and writes all-new
  items otherwise; it is refused when the list holds anything it cannot write. A list that can hold something
  hidden from the client (a field added since its version, or one it cannot read or write) accepts only the list
  sent back unchanged, or a write that only reorders, deletes, or adds items that differ from each other; any
  edit of an item, including any change inside its nested lists, needs its `id`, and anything else is refused
  with `422 CONTENT_INVALID` (`AMBIGUOUS_ITEMS`). Any other list is never refused: an item that cannot be
  matched with certainty is new, with a new `id`.
- A new item (sent without `id`, or with `"id": null`) that sends a value for a field the client cannot write is
  refused with `NOT_ALLOWED`: a new item has no stored value to send back.
- The write response's `itemIds` gives the `id` of each item in the component fields the body sent, by the
  client's API IDs.

Inside an item, a value the client sends back for a field it cannot write is compared with the stored item it
continues, and that stored item is the one whose values are kept. A field that changed since the client's version
(a dynamic zone that gained a component, for example) can be sent back exactly as read, with or without the
`id`s read, and nothing changes.

The stored items are those of the draft the write lands on. A caller that may not read drafts sees them only
when the draft is the published version. While the entry has unpublished changes, such a caller sends back the
`id`s it read from the published version (an unchanged item has the same `id` in both) or got in `itemIds` from
its last write; without them, a list with items is refused with `AMBIGUOUS_ITEMS` when it holds anything the
caller cannot write; otherwise it changes nothing when sent exactly as stored, and is written as all-new items
when it differs. An `id` read from the published version is never unknown, even after the draft changed; if the
draft no longer holds that item and the field's items can hold values the caller cannot see, the write is
refused (`AMBIGUOUS_ITEMS`), which tells the caller the field has unpublished changes, not what they are. A field inside a component that the caller
cannot write cannot be sent back: it is refused (`NOT_ALLOWED`, "while the entry has unpublished changes"),
whatever it holds, and left out it keeps its stored value.

## GraphQL

A GraphQL request that sends `Shapio-Schema-Version` is answered by that version's schema: its type names,
fields, and arguments, with the same effects as REST. Introspection with the header gives that version's
schema, so a client generated from it keeps validating. That schema names only what the caller may read
today: a field private now, or outside the token's grant now, is not in it, so a query naming one fails
validation exactly as it would against today's schema. A field removed since stays in it and reads `null` when
it was public in that version and the token's grant today covers every public field of the content type; a
token granted named fields only does not see removed ones. A content type deleted since is not in it for
delivery tokens, app users, and anonymous callers (a query naming one fails validation, as REST answers
`404`); admin callers see it, reading as empty. The response carries
`extensions.schemaVersion: { requested, current }`. Mutations that name a schema version are that version's
(its names and input types) and follow the [Writes](#writes) rules above: a field that cannot be written comes
back as a GraphQL error with `extensions.code: LENS_WRITE_UNSUPPORTED` and every refused field in
`extensions.issues`. A content type deleted since has no mutations. A version not used recently costs the
caller a schema build; past a small budget per minute the request is answered `429 LENS_BUDGET_EXCEEDED`
([GraphQL](graphql.md#older-schema-versions)).

## Generated types for an older version

`shapio types generate --schema-version <schemaId>:<version>` writes the types of an older version (with that version's
`SCHEMA_VERSION`), for a client you have to patch without moving it forward.

## Seeing who is still on an older version

The [change set review](change-sets.md#review) shows, for each breaking change, what clients on older schema
versions will see, and which API tokens still send an older version (and which one). `shapio schema diff`
prints the same effect on each breaking line ([Schema sync](schema-sync.md#breaking-destructive-and-deletions)).
[Field usage](change-sets.md#field-usage) counts reads through an older version under today's fields, and never
counts a field that reads `null` because it is gone.

## Limits

- **A schema version never brings back data.** A removed field, a value a conversion dropped, and a field made
  private read `null`.
- **Some changes are not hidden**: localization, drafts, locales, and switching between a collection and a
  single type (see the table).
- **Filters and sorts on changed fields are refused**, not emulated.
- **One value can read with another spelling, or empty, after a chain of type changes.** A client reads today's
  value converted straight to its version's type, not stepped through each version in between:
  - text too small to be a number (such as `1e-400`) reads as empty, not `0`, for a client on a version where
    the field was a big integer or decimal and has since become a number and then text;
  - number text such as `9E-7` reads as empty for a client on a version where the field was a slug and has since
    become a number and then text;
  - a number such as `5e-324` reads as `"5e-324"` for a client on a version where the field was text and has
    since become a decimal and then a number, not as the full decimal digits (`"0.000…5"`); the value is the same;
  - a time stored as the text `10:30` reads as `10:30` for a client on a version where the field was code and
    has since become a time and then text, not as `10:30:00.000`; the time is the same.
- **Item IDs and localization.** An item saved before 0.9.0 and not written since has an `id` derived on read,
  and for a localized field that `id` includes the locale. So making a shared field localized, or making a
  content type localized, changes the `id`s of exactly those items; a client that sends back the old ones has
  those items saved as new (or refused, as above, where the field's items can hold values it cannot see). IDs that are stored never change, and making a field shared or a content
  type not localized keeps them.
- **History from before 0.9.0.** Shapio 0.9.0 starts recording which version of each content type was live at
  each schema version, and rebuilds the earlier record from the audit log when it upgrades. Where the audit log
  has no record (it was pruned, say), a read of that content type through an older version answers
  `409 SCHEMA_VERSION_UNAVAILABLE`, naming the oldest version that works. A content type whose record would put
  it apart from its parent type or from a component it embeds is unavailable at that version too (`409`, never
  `404`); through that version its entries drop out of relations and interface lists, and GraphQL leaves its type
  out. A component that cannot be served makes the content types embedding it unavailable, not gone. Content
  types without such a gap are unaffected, and from 0.9.0 on the record is complete.

## Errors

| Status and code                  | When                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `400 SCHEMA_VERSION_INVALID`     | the value is not `<schemaId>:<version>`                                                                                               |
| `400 SCHEMA_VERSION_FOREIGN`     | the version comes from another instance; generate your types against this one                                                         |
| `400 SCHEMA_VERSION_AHEAD`       | the version is newer than this instance's current one                                                                                 |
| `400 SCHEMA_VERSION_MISMATCH`    | the query parameter and the header name different versions                                                                            |
| `400 LENS_QUERY_UNSUPPORTED`     | a filter or sort on a field that changed its stored form or was removed since the version (`details.apiKey`)                          |
| `404`                            | the content type was deleted since the version                                                                                        |
| `409 LENS_UNCOVERED`             | the content type switched between a collection and a single type since the version                                                    |
| `409 SCHEMA_VERSION_UNAVAILABLE` | no record of the content type at that version; `details.oldestVersion` is the oldest that works                                       |
| `422 LENS_WRITE_UNSUPPORTED`     | a write sends fields that changed since the version (`details.issues`, one per field)                                                 |
| `429 LENS_BUDGET_EXCEEDED`       | the caller made the instance build too many older-version schemas in the last minute (REST, preview, snapshots, GraphQL); retry later |

On the delivery, preview, snapshot, and write routes, every one of these answers only a caller that is
authorized for what it asked: a request the caller may not make gets exactly the answer it gets without a
version (the same `401`, `403`, or `404`), whatever version it names, and builds nothing (it is never charged to
a build budget). A route key today's schema does not know (a content type renamed since) can only be resolved
through the version: a caller holding some grant on the workspace may cause a build for it, charged to its own
budget, and learns about the content type it names only if it may act on it today (anyone else gets the `404`).
An empty `schemaVersion` is `400 SCHEMA_VERSION_INVALID`, answered after authorization like the others.
GraphQL checks versions and budgets in its own pipeline ([GraphQL](#graphql)). Anonymous callers each have their
own build budget, by client address; previews build on the preview token's.

A server older than 0.9.0 answers `400` to the `schemaVersion` query parameter.

Behind a reverse proxy, set `TRUST_PROXY` so Shapio sees each client's own address. Without it, every anonymous request appears to come from the proxy, and all anonymous clients share one budget for reads of older schema versions. Set it to the number of proxies in front of Shapio (for example `1`), not `true`: with `true`, Shapio takes the left-most `X-Forwarded-For` entry, which any client can write, as the client's address.
