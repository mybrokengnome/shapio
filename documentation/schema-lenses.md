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
exist. Every delivery, preview, snapshot, and GraphQL response carries it, whether or not the request names a
version, except one refused before Shapio reads its schema (an invalid credential, a request a route's
schema refuses, an invalid, foreign, or newer version). `meta.schemaVersion` is on every read that names a
version, today's included.

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

Send the token as the `?schemaVersion=` query parameter or as the `Shapio-Schema-Version` header. Both work on
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
integer keeps its exact digits (`"0.0000001"`, never `1e-7`). An empty multi-value enum reads `null`, as it does
for a client that names no version.

A component or dynamic zone takes the effect of what is inside it, with one difference: a field inside it that
reads empty leaves the component and its items in place, so the component is **Some values read empty**, not
**Reads empty**. It reads empty only when none of its items can be read (its component deleted, or no component
both versions allow).

Two more things drop out of an old client's view rather than appear in a shape it never saw:

- entries of [kinds](modeling.md#types-that-extend-a-type) created after its version, in a parent's list;
- relation targets of content types it does not know (created after its version, or added to a relation's
  target since), left out of the relation as an unreadable target is.

## Queries

`filters`, `sort`, `fields`, and `populate` take the API IDs of the client's version:
`filters[teaser][$null]=false` works for the client in the example. The query runs on today's storage, so:

- A filter or sort on a field whose stored form changed since the version (a text field that is now an
  integer), or that no longer exists, is refused with `400 LENS_QUERY_UNSUPPORTED` naming the field. It is never
  answered on today's values in a way the old client did not mean.
- `fields=` may name a field that was removed since, or that the caller reads as `null` (see below): it is
  accepted and reads `null`.
- A filter or sort the field no longer allows (`filterable` or `sortable` turned off) is refused, as for every
  client.

## Visibility and permissions are today's

A schema version changes the shape of a response, never who may read what: through every version a caller
sees exactly what it sees without one, deprecation included. A field it cannot read today (made private,
deprecated, outside its role's grant now, or removed) never carries a value:

- for a caller whose grant on the content type names no fields (it reads every public field), a field that was
  public in the client's version reads `null` (`[]` for lists), at the top level and inside components, and
  `fields=` may name it;
- for a caller whose grant names fields, it is left out, and `fields=` naming it is `403`, as without a version.

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
`became per locale`), and nothing is written. The exception is a value equal to what a read through the same
version returns for that field: a client that sends back the entry it just read, with one field edited, is not
refused for the fields it did not touch, and those keep their stored values (not the value sent back).

Only the delivery routes (`/api/content`) and [GraphQL](#graphql) take a schema version on writes. The admin content API
(`/api/admin/content`) ignores the header and refuses the parameter (`400 INVALID_QUERY`, as any unknown query
parameter): it always reads and writes today's shape.

A write through a version starts from what the write itself starts from today, a locale's first draft included
(its shared values come from the entry's other locales), whether or not the caller may read the entry. Fields a
caller cannot read are never cleared by a write, with or without a version: sent back empty they keep their
stored value, and inside a component instance (written whole) they are carried over from the stored instance.
A value the client sends back is compared with what a read of the same version returns for the entry's draft or
its published version, media and populated relations by ID.

Shapio does not convert written values back to today's type: a write through a lossy conversion would replace
data the old client could not see. To write such a field, move the client to the current version.

Items in repeatable components and dynamic zones have no IDs, so they are matched by position: a client on an
older version that reorders, inserts, or removes items can attach values it does not know about (fields added
since its version) to the wrong item.

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

`shapio types generate --schema-version <token>` writes the types of an older version (with that version's
`SCHEMA_VERSION`), for a client you have to patch without moving it forward.

## Seeing who is still on an older version

The [change set review](change-sets.md#review) shows, for each breaking change, what clients on older schema
versions will see, and which API tokens still send an older version (and which one). `shapio schema diff`
prints the same effect on each breaking line ([Schema sync](schema-sync.md#breaking-destructive-and-deletions)).
[Field usage](change-sets.md#field-usage) counts reads through an older version under today's fields, and never
counts a field that reads `null` because it is gone.

## Limits

- **A lens never brings back data.** A removed field, a value a conversion dropped, and a field made private
  read `null`.
- **Some changes are not hidden**: localization, drafts, locales, and switching between a collection and a
  single type (see the table).
- **Filters and sorts on changed fields are refused**, not emulated.
- **History from before 0.9.0.** Shapio 0.9.0 starts recording which version of each content type was live at
  each schema version, and rebuilds the earlier record from the audit log when it upgrades. Where the audit log
  has no record (it was pruned, say), a read of that content type through an older version answers
  `409 SCHEMA_VERSION_UNAVAILABLE`, naming the oldest version that works. Content types without that gap are
  unaffected, and from 0.9.0 on the record is complete.

## Errors

| Status and code                  | When                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `400 SCHEMA_VERSION_INVALID`     | the value is not `<schemaId>:<version>`                                                                      |
| `400 SCHEMA_VERSION_FOREIGN`     | the version comes from another instance; generate your types against this one                                |
| `400 SCHEMA_VERSION_AHEAD`       | the version is newer than this instance's current one                                                        |
| `400 SCHEMA_VERSION_MISMATCH`    | the query parameter and the header name different versions                                                   |
| `400 LENS_QUERY_UNSUPPORTED`     | a filter or sort on a field that changed its stored form or was removed since the version (`details.apiKey`) |
| `404`                            | the content type was deleted since the version                                                               |
| `409 LENS_UNCOVERED`             | the content type switched between a collection and a single type since the version                           |
| `409 SCHEMA_VERSION_UNAVAILABLE` | no record of the content type at that version; `details.oldestVersion` is the oldest that works              |
| `422 LENS_WRITE_UNSUPPORTED`     | a write sends fields that changed since the version (`details.issues`, one per field)                        |

A server older than 0.9.0 answers `400` to the `schemaVersion` query parameter.
