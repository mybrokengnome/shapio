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
`readingTime` (short text holding minutes, such as `"4"`). A site is built against it and deployed. Its client
names version 17 with every request:

```sh
curl -H "Authorization: Bearer $SHAPIO_DELIVERY_TOKEN" \
  "$SHAPIO_URL/api/content/articles?fields=title,teaser,readingTime&pageSize=1&schemaVersion=$SCHEMA_VERSION"
```

Then two changes ship: `teaser` is renamed `excerpt` (version 18), and `readingTime` becomes an integer
(version 19; Shapio converts `"4"` to `4` as the change goes live). The deployed site sends the same request and
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
      "readingTime": "4"
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

`teaser` is read from the field now called `excerpt`, and the stored `4` is converted back to the text `"4"`.
The response also carries the header
`Shapio-Schema-Version-Current: 0d5c8f2a-6b1e-4c3d-9f70-2e8a4b6c1d95:19`, so the site can tell that newer types
exist.

Without `schemaVersion`, the same request fails with `400 INVALID_QUERY` (`Unknown field "teaser"`), and a read
without `fields=` returns `excerpt` and the number `4`, which code written for version 17 does not expect. A
client built against version 19 names it, or names nothing, and reads `excerpt` and `4`.

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

### In the starters

The [starters](starters.md#schema-version) pass `SCHEMA_VERSION` to their client. A built site keeps reading in
the shape it was built for when the schema moves, and moves to the current shape when you regenerate its types.

## What a client on an older version sees

Each change between the client's version and today has one of these effects. When several changes touch the
same field, the client sees the combined result: a field renamed twice still reads under the name the client
knows.

| Effect                     | Changes since the client's version                                                                                                                                                                                                                              | What the client gets                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Keeps working**          | a field's API ID renamed; a content type's API ID or plural API ID renamed (its route); a component's API ID renamed; field order; labels, descriptions, and help text; the editor; fields, content types, or components added; a field made required or unique | no difference: its own routes and API IDs, and no fields it does not know                                    |
| **Converted**              | a type change whose values all read back in the old type (a text field made an integer); a multiple field made single                                                                                                                                           | the value converted to the old type (`4` reads as `"4"`); a single value as a one-item list                  |
| **Some values read empty** | a type change where not every value fits the old type (an integer field made text: `"about 5"` is no integer); enum values or dynamic zone components added since; a single field made multiple; a relation's target widened                                    | the values that fit; `null` (`[]` for lists) for the others; a field that became a list reads its first item |
| **Reads empty**            | a field removed; values a type change dropped; a field made private (`public` off); a component field switched to another component                                                                                                                             | `null` (`[]` for lists), always                                                                              |
| **Gone**                   | the content type deleted                                                                                                                                                                                                                                        | `404`, like any unknown content type                                                                         |
| **Not covered**            | a collection made a single type, or the reverse                                                                                                                                                                                                                 | `409 LENS_UNCOVERED`                                                                                         |
|                            | `filterable` or `sortable` turned off                                                                                                                                                                                                                           | old filters or sorts on that field are refused, as for any client                                            |
|                            | localization turned on or off (on a content type or a field), drafts turned on or off, locales added or removed                                                                                                                                                 | not hidden: the client sees today's locales and today's values                                               |

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
- `fields=` may name a field that was removed since: it is accepted and reads `null`.
- A filter or sort the field no longer allows (`filterable` or `sortable` turned off) is refused, as for every
  client.

## Visibility and permissions are today's

A schema version changes the shape of a response, never who may read what. A field that is private now, or
that the token's role may not read now, is `null` through every version, even one in which it was public. Row
conditions (owner-only reads) are today's too. A field marked `deprecated` is still returned: `deprecated` hides
a field from new clients, and a client naming an old version is an old client.

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

Any other field in the body (one whose type or settings changed, or that was removed) is refused with
`422 LENS_WRITE_UNSUPPORTED`, naming the field by the client's API ID. The exception is a value equal to what a
read through the same version returns for that field: a client that sends back the entry it just read, with
one field edited, is not refused for the fields it did not touch, and those keep their stored values.

Shapio does not convert written values back to today's type: a write through a lossy conversion would replace
data the old client could not see. To write such a field, move the client to the current version.

## GraphQL

A GraphQL request that sends `Shapio-Schema-Version` is answered by that version's schema: its type names,
fields, and arguments, with the same effects as REST. Introspection with the header gives that version's
schema, so a client generated from it keeps validating. Mutations that name a schema version are refused with
`400`; send them without the header, in today's shape.

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
| `400`                            | a GraphQL mutation names a schema version                                                                    |
| `400 LENS_QUERY_UNSUPPORTED`     | a filter or sort on a field that changed its stored form or was removed since the version (`details.apiKey`) |
| `404`                            | the content type was deleted since the version                                                               |
| `409 LENS_UNCOVERED`             | the content type switched between a collection and a single type since the version                           |
| `409 SCHEMA_VERSION_UNAVAILABLE` | no record of the content type at that version; `details.oldestVersion` is the oldest that works              |
| `422 LENS_WRITE_UNSUPPORTED`     | a write sends a field that changed since the version (`details.apiKey`)                                      |

A server older than 0.9.0 answers `400` to the `schemaVersion` query parameter.
