# Delivery API (REST)

Your sites and apps read published content from one generic route per model:

```text
GET {PUBLIC_URL}{BASE_PATH}/api/content/<plural API ID>              # a collection: a page of entries
GET {PUBLIC_URL}{BASE_PATH}/api/content/<plural API ID>/<entry id>   # a collection: one entry
GET {PUBLIC_URL}{BASE_PATH}/api/content/<API ID>                     # a single type: its entry
```

A type that extends another is read under its parent's route, by its own plural API ID:
`/api/content/posts/guides` and `/api/content/posts/guides/<entry id>` ([below](#types-that-extend-a-type)).

A collection is addressed by its **plural API ID** (`/api/content/articles`), a single type by its **API ID**
(`/api/content/homepage`). The singular API ID of a collection is not a delivery route: `/api/content/article`
is a 404. Both IDs are set on the model ([Modeling](modeling.md#kinds-of-definitions)). The admin content API
(`/api/admin/content/<API ID>`) always uses the singular.

There is no generated code per model: a model created a minute ago is served by the same routes at once.
Delivery returns **published** content only; drafts, unpublished entries, private media and fields your token
may not read never appear. The one exception is [drafts mode](#drafts-in-development), for a site's
development server, with a token granted Read drafts. The [REST reference](reference/rest-api.md) lists every read parameter (app-user
writes are described in [End users](end-users.md)); your instance's own OpenAPI document, for its current
schema, is at `/api/docs` (admins).

The examples below use the [example site](example-site.md)'s models.

## Tokens

Create a **delivery role** (Network → Roles → New role, kind _Delivery_) with `read` on the models your site
needs, then an API token bound to it (Settings → API tokens). Send it as a bearer token:

```sh
curl -H "Authorization: Bearer $SHAPIO_DELIVERY_TOKEN" "$SHAPIO_URL/api/content/articles?locale=fr"
```

- Delivery tokens can only ever read, whatever their role says.
- A role's grant covers every field marked `public` (the default); `public: false` fields are hidden unless the
  grant names them. In [GraphQL](graphql.md#what-each-caller-sees) hidden fields are not even in the token's
  schema.
- Without a token, a request is _anonymous_: it gets what the built-in **public** app role grants, which is
  nothing until you allow it (Network → Roles → App roles). Use that for content anyone may read from the
  browser. App users' own tokens are covered in [End users](end-users.md).

## Workspaces

One Shapio instance can hold several [workspaces](workspaces.md), each with its own content types (plus those
shared with all workspaces), content, tokens, and snapshots. A content type of another workspace is unknown in this
one (`404`). Every delivery request reads exactly one workspace:

1. **The token's workspace.** Delivery tokens belong to the workspace they were created in, and only ever read
   it.
2. **The workspace the request names**, with `?workspace=<key>` or the `Shapio-Workspace: <key>` header.
   Anonymous callers and network admin tokens use this to pick a workspace.
3. **The primary workspace**, when neither names one. An instance with a single workspace never needs to name it.

Server 0.8.2 or later; `Shapio-Site` and `?site=` work on every version.

Naming a different workspace than the token's is refused with `403 SITE_MISMATCH`, never redirected, and so is a
request whose header and query parameter disagree (or that sends both spellings with different keys). An unknown
key is `404 SITE_NOT_FOUND`. Entries of another workspace read as not found, and relations never cross
workspaces.

```sh
curl "$SHAPIO_URL/api/content/articles?workspace=marketing"
```

Anonymous reads get what the app roles bound to the request workspace's `public` audience grant. The primary
workspace binds the built-in **public** role; a new workspace binds none, so it serves nothing anonymously until
you bind one ([Workspaces](workspaces.md#app-users-and-anonymous-access)).

`GET /api/workspace` returns the request's workspace as delivery sees it: its key and name, and the website's
SEO defaults (`GET /api/site` answers the same).

With `@shapio/client`, pass the workspace once:

```ts
const shapio = createClient({ baseUrl: process.env.SHAPIO_URL, token, workspace: 'marketing' });
```

The client sends it in the query string on delivery and snapshot reads, which keeps a cross-origin `GET` free of
a CORS preflight and keeps URL-keyed caches apart. Every other request (writes, GraphQL, the admin API) carries
it in a header. Leave `workspace` out to read the token's workspace, or the primary workspace. The client still
sends `Shapio-Site` and `?site=` on the wire, so a newer `@shapio/client` works against a 0.8.1 server.

## Responses

```json
{
  "data": [
    {
      "id": "6f2c…",
      "__model": "article",
      "locale": "fr",
      "createdAt": "2026-10-01T09:12:44.512Z",
      "updatedAt": "2026-10-01T09:30:02.104Z",
      "publishedAt": "2026-10-01T09:30:02.104Z",
      "title": "Modéliser du contenu sans déploiement",
      "slug": "modeling-without-a-deploy",
      "excerpt": "…",
      "body": {
        "format": "shapio-richtext",
        "version": 1,
        "doc": { "type": "doc", "content": [] }
      },
      "cover": { "id": "…", "url": "…", "width": 1600, "height": 900, "alt": "…", "variants": [] },
      "author": "0b7e…",
      "publishedOn": "2026-09-01"
    }
  ],
  "meta": {
    "locale": "fr",
    "snapshot": 10,
    "pagination": { "page": 1, "pageSize": 25, "total": 2, "pageCount": 1 }
  }
}
```

- Entries are flat: system attributes, then every readable field by API ID, `null` (or `[]`) when empty.
- Every entry carries `__model` and `__kinds`. `__model` is the singular API ID of its own type: in a list of a
  type with kinds, it tells you which kind each row is. `__kinds` is that type's lineage, root first and its
  own type last (`["product", "physical", "apparel"]`; a plain product has `["product"]`), so you can match a
  row at any level without knowing the schema. Neither is a field: `fields=` and `sort` can't name them, and a
  write that sends one is refused.
- **Rich text** is the stored JSON document by default. Ask for `richText=html` to get
  `{ format, version, html }` instead, or `richText=both` for the document and `html` together. The HTML is
  rendered on the server from the JSON with an allow-list sanitizer (safe link protocols only, images resolved
  through the media library), on the request that asks for it; it is never stored. Text marks are `bold`,
  `italic`, `underline`, `subscript`, `superscript`, `code`, and `link`, rendered as `<strong>`, `<em>`, `<u>`,
  `<sub>`, `<sup>`, `<code>`, and `<a>`. A list item holds one or more blocks, so an item with two paragraphs
  renders as `<li><p>…</p><p>…</p></li>`.
- **Media** fields are asset objects with URLs and ready [variants](media.md#image-variants); private assets
  carry an expiring signed URL.
- **Relations** are target IDs unless you `populate` them. A target that is not published, or that your token
  may not read, is left out (never its ID).
- **Components** are objects; **dynamic zones** are arrays of objects with `__component` (the component's
  API ID). Every component item, single or in a list or a dynamic zone, carries `id`, its stable ID (server
  0.9.0 or later): send it back when you write the item ([Writing components](#writing-components)).
- **Code** fields are strings, exactly as saved. Their language (`html`, `css`, `json`, …) is in the OpenAPI
  document as `x-shapio-language` (with `contentMediaType`), in the GraphQL field description (`Code: html`)
  and in the comment of the field in generated types (`shapio types generate`).
- A single type answers `/api/content/<API ID>` with `{ data: {…}, meta }`.

Errors always look like `{ "error": { "code": "…", "message": "…", "details": … } }`: 400 for an invalid query,
401 without credentials for content that needs them, 403 when your role may not read the model, 404 for an
unknown model or entry.

## Types that extend a type

A collection can extend another ([Modeling](modeling.md#types-that-extend-a-type)): Post, with Guide and
Opinion as its kinds. A kind is read under its parent, by its **route key**, the plural API IDs of its
ancestors and its own joined by `/`:

```text
GET /api/content/posts                  # every post: plain posts, guides, and opinions
GET /api/content/posts/<entry id>       # one post, of any kind
GET /api/content/posts/guides           # guides only
GET /api/content/posts/guides/<entry id>
```

A kind's plural API ID on its own (`/api/content/guides`) is not a route. Reading an entry under the wrong
kind is a 404: `/api/content/posts/guides/<id>` of an opinion is not found, while `/api/content/posts/<id>`
finds it.

A parent's list holds every kind, in one page, sorted and counted together:

- Each row comes in its own shape, with `__model` naming its kind: a guide has the post's fields and its own.
- Filters, `sort`, `q`, and `fields=` take the fields of the type you read, which every kind under it has
  (and only those your token may read on every kind in the list). To filter on a kind's own field, read that
  kind's route.
- Without `fields=`, each row carries every field its own kind has that you may read. With `fields=`, every
  row carries only the shared fields you named.
- To read only some kinds, filter on `__model` with the singular API IDs you want:
  `?filters[__model][$eq]=post` lists plain posts alone, `?filters[__model][$in]=guide,opinion` two kinds. Only
  `$eq` and `$in` work, and only with kinds of the type you read; the total counts just those kinds.
- Kinds your token may not read are left out of the list, never refused with a 403. Reading the route itself
  needs `read` on its type, and a grant on a parent covers its kinds ([End users](end-users.md)).
- With no `sort`, the list follows the parent's default sort.
- `meta.kinds` lists the type and its kinds as a flat tree (each kind after its parent), with each kind's
  label, parent and route key, so a site can build a kind filter or a menu without reading the schema. Only
  kinds your token may read are in it, and a type without kinds has no `meta.kinds` at all.

A relation to a type with kinds can point at an entry of any kind. Populated, each target comes in its own
shape with its own `__model`, under the same rules.

```sh
curl -H "Authorization: Bearer $SHAPIO_DELIVERY_TOKEN" "$SHAPIO_URL/api/content/posts?sort=publishedOn:desc&pageSize=10"
```

```json
{
  "data": [
    {
      "id": "1a…",
      "__model": "guide",
      "__kinds": ["post", "guide"],
      "title": "Pin your builds",
      "timeToComplete": 12
    },
    { "id": "2b…", "__model": "post", "__kinds": ["post"], "title": "Release notes" },
    {
      "id": "3c…",
      "__model": "opinion",
      "__kinds": ["post", "opinion"],
      "title": "Why models are data",
      "stance": "for"
    }
  ],
  "meta": {
    "locale": "en",
    "snapshot": 41,
    "pagination": { "page": 1, "pageSize": 10, "total": 3, "pageCount": 1 },
    "kinds": [
      { "apiKey": "post", "label": "Post", "parent": null, "routeKey": "posts" },
      { "apiKey": "guide", "label": "Guide", "parent": "post", "routeKey": "posts/guides" },
      { "apiKey": "opinion", "label": "Opinion", "parent": "post", "routeKey": "posts/opinions" }
    ]
  }
}
```

With `@shapio/client`, pass the nested route key as it is: `delivery.list('posts/guides')`. The client sends
it as nested path segments.

## Interfaces

An interface ([Modeling](modeling.md#interfaces)) is read by its plural API ID. With Featurable implemented by
Post, BlogPost, RoadmapItem, and the About page:

```text
GET /api/content/featurables              # every Featurable entry, of every member type
GET /api/content/featurables/<entry id>   # one, of any member type
```

The list holds every member's entries in one page, sorted and counted together:

- Each row comes in its own shape, with `__model` naming its type (and `__kinds`, as on every entry). Kinds of a
  member are members too, so a Guide that extends Post is in the list.
- Filters, `sort`, and `fields=` take the interface's contract fields and the system fields (`id`, `createdAt`,
  `updatedAt`). Each is applied to each member's own field of that API ID, so `sort=title` sorts BlogPosts and
  RoadmapItems together by their titles. A contract field marked filterable or sortable is filterable or
  sortable on every member, which the contract guarantees.
- `q` searches the interface's title field (Display → Title field) on every member.
- Without `fields=`, each row carries every field its own type has that you may read. With `fields=`, every row
  carries only the contract fields you named.
- To read only some types, filter on `__model` with their singular API IDs:
  `?filters[__model][$in]=blogPost,roadmapItem`.
- With no `sort`, the list follows the interface's default sort when every member you may read can sort on that
  field, else `createdAt` newest first.
- `populate` works per row: `populate=*` expands each row's own relations, whatever its type. `?seo=resolved`
  resolves the SEO fields of each row whose type has them ([SEO fields](seo.md)).
- `meta.members` lists the member types you may read, with each one's API ID, label, and route key, so a site
  can build a type filter without reading the schema.

**Permissions.** An interface has no grants. Members your token may not read are left out of the list. Reading
the route needs `read` on at least one member: with none, it is a `403`, as reading a type without `read` is. An
interface no type implements yet returns an empty list (`meta.members: []`) to any token that may read some type.
A contract field your token may not read on some member can't be used in `filters`, `sort`, `q`, or `fields=`
(a `403`, as for any hidden field). Reading one entry by ID finds it among the members you may read and returns
it as its own type would; the member's own route keeps serving it too.

**Writes.** An interface route is read-only: `POST`, `PUT`, and `DELETE` on `/api/content/featurables` are
refused with `405 METHOD_NOT_ALLOWED`, and the message names the member routes to write to.

```sh
curl -H "Authorization: Bearer $SHAPIO_DELIVERY_TOKEN" "$SHAPIO_URL/api/content/featurables?sort=title:asc&pageSize=10"
```

```json
{
  "data": [
    { "id": "1a…", "__model": "blogPost", "__kinds": ["blogPost"], "title": "Ask the API", "readingTime": 4 },
    {
      "id": "2b…",
      "__model": "roadmapItem",
      "__kinds": ["roadmapItem"],
      "title": "Interfaces",
      "status": "shipped"
    },
    { "id": "3c…", "__model": "about", "__kinds": ["about"], "title": "About Shapio" }
  ],
  "meta": {
    "locale": "en",
    "snapshot": 42,
    "pagination": { "page": 1, "pageSize": 10, "total": 3, "pageCount": 1 },
    "members": [
      { "apiKey": "about", "label": "About", "routeKey": "about" },
      { "apiKey": "blogPost", "label": "Blog post", "routeKey": "blogPosts" },
      { "apiKey": "roadmapItem", "label": "Roadmap item", "routeKey": "roadmapItems" }
    ]
  }
}
```

With `@shapio/client`, `delivery.list('featurables')` and `delivery.get('featurables', id)`; type the rows with
the generated `FeaturableAny` and switch on `__model`.

**Relations to an interface or to any entry.** A relation whose target is Featurable holds entries of any member;
one whose target is Any entry holds entries of any collection or single type. Populated, each target comes in
its own shape with its own `__model`, under the same rules as any populated relation: a target your token may
not read, or one that is not published in the read's locales, is left out. Any entry has no list route of its
own.

## Query parameters

| Parameter          | Example                               | Notes                                                                                          |
| ------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `locale`           | `locale=fr`                           | falls back along the locale chain ([Localization](localization.md))                            |
| `filters`          | `filters[slug][$eq]=about`            | see below                                                                                      |
| `sort`             | `sort=publishedOn:desc,createdAt:asc` | fields marked sortable, `id`, `createdAt`, `updatedAt`                                         |
| `page`, `pageSize` | `page=2&pageSize=50`                  | `pageSize` 25 by default, at most 100                                                          |
| `fields`           | `fields=title,slug`                   | top-level fields to return (system attributes always come)                                     |
| `populate`         | `populate=author`                     | relation paths: `author`, `author,tags.author`, or `*`; at most 3 levels                       |
| `q`                | `q=snapshot`                          | searches the title field chosen in the model's display settings (400 without one)              |
| `snapshot`         | `snapshot=10`                         | read as of a publication snapshot (below)                                                      |
| `richText`         | `richText=html`                       | rich-text shape: `json` (default, the document), `html`, or `both`                             |
| `publicationState` | `publicationState=draft`              | `published` (default) or `draft`: [drafts mode](#drafts-in-development)                        |
| `schemaVersion`    | `schemaVersion=0d5c…:17`              | answer in an older schema version's shape ([below](#schema-versions-old-clients-keep-working)) |

### Filters

`filters[<field>][<operator>]=<value>`, combined with `$and`, `$or` and `$not`:

```sh
curl -G "$SHAPIO_URL/api/content/articles" -H "Authorization: Bearer $SHAPIO_DELIVERY_TOKEN" \
  --data-urlencode 'filters[publishedOn][$gte]=2026-09-10' \
  --data-urlencode 'filters[$or][0][slug][$eq]=why-builds-pin-a-snapshot' \
  --data-urlencode 'filters[$or][1][slug][$eq]=modeling-without-a-deploy'
```

| Operators                                                             | Field types                                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `$eq`, `$ne`, `$in`, `$nin`, `$null`, `$notNull`                      | text, numbers, dates, enums, relations and media (booleans: `$eq`, `$ne`, `$null`, `$notNull`); on lists (`many` relations, multiple media/enums) `$eq` means "contains" |
| `$lt`, `$lte`, `$gt`, `$gte`                                          | text, numbers, dates and times, on fields marked **filterable** or **sortable**                                                                                          |
| `$contains`, `$notContains`, `$containsi`, `$startsWith`, `$endsWith` | text fields marked **filterable**                                                                                                                                        |

`id`, `createdAt` and `updatedAt` can be filtered too (`publishedAt` is returned but cannot be filtered or
sorted). JSON, rich text, component and dynamic zone fields cannot be filtered. `$in` takes repeated values or `a,b`. Values are read
like stored values, so `2026-10-01T10:00:00+02:00` matches `2026-10-01T08:00:00.000Z`. Unknown fields,
operators a type does not support, and filters or sorts on fields your token may not read are refused (400/403)
rather than ignored, so a filter can never reveal a hidden value. Relation and media filters see what the
response shows: a link to an entry that is unpublished, outside the read's locales, or one your token may not
read, and a deleted asset, count as not there, so `$null` matches an entry whose links are all hidden.

## Snapshots: one consistent moment

Every publish moves a global **publication snapshot** number forward; every published read reports the
one it read in `meta.snapshot` (a [draft read](#drafts-in-development) reports `null`). Pass `snapshot=N`
and Shapio answers exactly as it would have at that moment, even if more was published since:

```sh
curl -H "Authorization: Bearer $SHAPIO_DELIVERY_TOKEN" "$SHAPIO_URL/api/content/pages?snapshot=10&locale=en"
```

A static site build should read the current snapshot once at the start and pass it with every request: then
a publish in the middle of the build cannot produce a site that mixes two moments. Without `snapshot`, which
related entries a response shows is checked against what is live when it is answered, so an entry published a
moment after `meta.snapshot` may already appear; an unpublished one never does. The
[example site](example-site.md) does exactly this, and Shapio's deployment triggers carry the snapshot to build.

Old snapshots are read through the current schema (a value stored under an earlier field type comes back as
`null`), unless the request names a [schema version](#schema-versions-old-clients-keep-working). A
[change set](change-sets.md) goes live as one snapshot, schema and entries together, so a pinned
build sees all of it or none of it.

Two endpoints serve builds, with the same tokens as `/api/content` and only for models the token may read:

| Endpoint                                         | Answer                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `GET /api/snapshots/current`                     | `{ snapshot, schemaVersion, publishedAt }`: what an unpinned read serves |
| `GET /api/snapshots/changes?from&to&after&limit` | entries and locales whose live content changed between the two snapshots |

Details, the change classification and incremental-build recipes are in
[Snapshots and the changes API](snapshots.md).

## Schema versions: old clients keep working

A client can name the schema version it was built against, and every read then answers in that version's shape:
its routes, API IDs, field types, and components, whatever changed since. Server 0.9.0 or later. What each kind of
change looks like to such a client is in [Schema lenses](schema-lenses.md).

```sh
curl -H "Authorization: Bearer $SHAPIO_DELIVERY_TOKEN" \
  "$SHAPIO_URL/api/content/articles?schemaVersion=0d5c8f2a-6b1e-4c3d-9f70-2e8a4b6c1d95:17"
```

- The value is `<schemaId>:<version>`, exported as `SCHEMA_VERSION` by `shapio types generate`. Send it as
  `?schemaVersion=` on reads (always, behind a CDN that keys on the URL) or as the `Shapio-Schema-Version`
  header. Both, with different values, is `400 SCHEMA_VERSION_MISMATCH`. With `@shapio/client`,
  `createClient({ …, schemaVersion: SCHEMA_VERSION })`.
- `filters`, `sort`, `fields`, and `populate` take that version's API IDs. Fields removed since read `null`
  (`[]` for lists). Visibility and permissions are always today's.
- A read that names a version, today's included, reports `meta.schemaVersion: { requested, current }`, both
  as `<schemaId>:<version>`. Every delivery, preview, and snapshot response carries the current schema version
  in the `Shapio-Schema-Version-Current` header, so a client can tell that a newer schema exists; a request
  refused before Shapio reads its schema (an invalid credential, a request a route's schema refuses, an
  invalid, foreign, or newer schema version) gets no such header.
- It pairs with `snapshot`: the snapshot picks the content, the schema version picks the shape.
- Errors: `400 SCHEMA_VERSION_INVALID`, `SCHEMA_VERSION_FOREIGN` (a version from another instance),
  `SCHEMA_VERSION_AHEAD`, and `LENS_QUERY_UNSUPPORTED` (a filter or sort on a field that changed);
  `409 LENS_UNCOVERED` and `SCHEMA_VERSION_UNAVAILABLE`; `422 LENS_WRITE_UNSUPPORTED` on writes
  ([Errors](schema-lenses.md#errors)).

## Caching

Responses carry a strong `ETag` over the exact body and
`Vary: Authorization, Cookie, Shapio-Workspace, Shapio-Site, Shapio-Schema-Version`. Send
`If-None-Match` to get `304 Not Modified` when nothing changed. Anonymous responses are `Cache-Control: public,
max-age=0, must-revalidate`; authenticated ones `private`. A CDN that keys its cache on the URL alone and
ignores `Vary` must be given the workspace as `?workspace=` (or `?site=`), not as the header, so that two
workspaces never share a cached response. The same goes for a
[schema version](#schema-versions-old-clients-keep-working): send it as `?schemaVersion=`.

### Next.js cache tags

Under Next.js (detected by `process.env.NEXT_RUNTIME`), `@shapio/client` tags every delivery read for Next's
data cache, so a site refreshes exactly what changed with `revalidateTag`:

| Read                         | Tags                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| `delivery.list(routeKey)`    | `shapio:site:<key>`, `shapio:<routeKey>`                           |
| `delivery.singleton(apiKey)` | `shapio:site:<key>`, `shapio:<apiKey>`                             |
| `delivery.get(routeKey, id)` | `shapio:site:<key>`, `shapio:<routeKey>`, `shapio:<routeKey>:<id>` |
| `workspace.get()`            | `shapio:site:<key>`                                                |

Models are tagged by their route key (a collection's plural API ID, a singleton's API ID, and for a kind its
nested route key, `posts/guides`), as the [snapshot diff](snapshots.md#what-changed-between-two-snapshots)
names them. The workspace tag is `shapio:site:<key>` when the client names a workspace (`workspace: 'marketing'`)
and `shapio:site` when it leaves the workspace to the token; it keeps that spelling so tags you already revalidate
keep matching. `shapioTags.workspace(key)` (or its older name, `shapioTags.site(key)`),
`shapioTags.model(routeKey)` and `shapioTags.entry(routeKey, id)` build these strings:

```ts
import { createClient, shapioTags } from '@shapio/client';
import { revalidateTag } from 'next/cache';

const shapio = createClient({ baseUrl, token, workspace: 'marketing', next: { cache: 'force-cache' } });
const { data } = await shapio.delivery.get<Article>('articles', id, { locale: 'en' });

// In the webhook route, for each entry in the snapshot diff:
revalidateTag(shapioTags.entry('articles', id), { expire: 0 });
```

A guide is also in the posts list and readable as `posts/<id>`, so when one changes, revalidate the tags of
its own route key and of every ancestor's. `shapioTags.changed(routeKey, id)` gives them all:
`shapioTags.changed('posts/guides', id)` is `shapio:posts`, `shapio:posts:<id>`, `shapio:posts/guides` and
`shapio:posts/guides:<id>`. Webhook payloads carry the same `routeKey`
([Webhooks](publishing.md#entry-events)), so any framework can do the same.

An entry is also in the list of every [interface](#interfaces) its type implements, and readable as
`featurables/<id>`. Interface reads are tagged with the interface's plural API ID (`shapio:featurables`), so
pass the plural API IDs of the type's interfaces as the third argument: webhook payloads and snapshot diff
items carry them in `interfaces`. `shapioTags.changed(data.routeKey, data.entryId, data.interfaces)` adds `shapio:featurables` and
`shapio:featurables:<id>` to the tags above.

```ts
for (const entry of diff.items) {
  for (const tag of shapioTags.changed(entry.routeKey, entry.id)) {
    revalidateTag(tag, { expire: 0 });
  }
}
```

The cache mode is yours: the client sets `cache` and `next.revalidate` only when you ask, with
`next: { cache?: 'force-cache' | 'no-store', revalidate?: number | false }` on `createClient` or as the last
argument of one read (`delivery.list('articles', query, { next: { revalidate: 60 } })`), which overrides the
client's. A read pinned to a snapshot (`snapshot: N`) never changes, so under Next it is always `force-cache`.
`next: false` sends no Next options at all. Outside Next, with no `next` option, the client's requests are
exactly as before. Snapshot, preview, GraphQL and admin requests are never cached or tagged, and neither are
[drafts mode](#drafts-in-development) reads (`drafts: true`), which under Next are `no-store` whatever the
`next` options say. The
[Next.js starter](starters.md#incremental-rebuilds) puts it together.

## Drafts in development

Publishing rebuilds your live site, so it is not how you check a change. **Drafts mode** lets a site's
development server render saved drafts: save in the admin, reload the page on your machine, and the change is
there. Publish still rebuilds your site; drafts mode is for your machine.

1. Create a second delivery role for development (or let the starters' `npm run seed` create `<workspace name> dev`)
   with `read` on the workspace's models and **Read drafts**. Read drafts always covers every model the role
   reads; it adds no model of its own.
2. Create a token for that role. The tokens list marks it with a **Drafts** chip. Never put it in a production
   environment.
3. Ask for drafts: `publicationState=draft` on `GET /api/content/...` (both routes), `publicationState: DRAFT` in
   [GraphQL](graphql.md#reading-drafts), or `drafts: true` on `@shapio/client`'s `createClient` and
   `@shapio/local`'s `createLocalClient`. The [starters](starters.md#drafts-mode) turn it on with
   `SHAPIO_DRAFTS=true`.

```sh
curl -H "Authorization: Bearer $SHAPIO_DEV_DELIVERY_TOKEN" \
  "$SHAPIO_URL/api/content/articles?publicationState=draft&populate=author"
```

A draft read serves each entry's saved draft in the delivery shape, entries never published included, with
`meta.publicationState: "draft"` and `meta.snapshot: null`. Relation targets and `populate` follow their drafts too, still only for
models the role may read. Responses are `Cache-Control: private, no-store`, so no cache keeps them, and field
usage does not count them. A draft cannot be pinned: `publicationState=draft` with `snapshot` is a 400.
Published reads are unchanged, byte for byte.

Two safeguards keep drafts off your live site. The server only serves drafts to a token whose role grants Read
drafts (403 `DRAFTS_FORBIDDEN` otherwise, with a message naming the grant), and the site must ask for them. A
production token never carries the grant, so a flag left on by mistake fails loudly instead of showing drafts.
Anonymous callers and app users can never read drafts, whatever their roles say. Admin users and admin API
tokens can, as they always could in GraphQL.

A draft is whatever the admin has saved, autosaves included, and it may not pass validation yet (a required
field can be empty): render drafts defensively. For one entry in the admin's Preview pane, editors use
[preview](visual-editing.md) instead; drafts mode is the whole site, for developers.

## Writes

The same routes accept `POST`, `PUT` and `DELETE` from app users whose roles allow it (for example, members
editing their own entries). Delivery tokens cannot write. See [End users](end-users.md). Editors and your
build tools use the admin API (`/api/admin/content/<key>`) with admin credentials.

### Writing components

A component is written whole: an update sends the full instance (or the full list of items) a field holds.
Fields of an item the caller cannot read (private to its audience, or deprecated) are never wiped by that: left
out, they keep their stored values, carried over from the stored item that the item sent continues. From server
0.9.0, the item's `id` says which stored item that is.

#### Item IDs

Every component item has an `id`, assigned by the server: a single component, each item of a repeatable
component, and each item of a dynamic zone, at any depth. Like an entry's `id`, it is not a field. An item keeps
its `id` through edits and moves, and an unchanged item has the same `id` in the draft and the published version,
in every locale of a shared field, and after a restore.

```json
"links": [
  { "id": "3b0d6c1e-8f2a-4c55-9e10-7a4b2d9c6e31", "label": "Docs", "url": "https://example.com/docs" },
  { "id": "9a1c4e7b-2d3f-4a68-b5c0-1e9f8d7a6b42", "label": "Blog", "url": "https://example.com/blog" }
]
```

**Send back the `id` of each item you read.** Each item is then paired with the stored item it continues, in any
order, and its hidden fields go with it:

- Edit an item: change its fields and keep its `id`.
- Reorder: send the items in the new order with their `id`s.
- Delete an item: leave it out. Its hidden values are deleted with it.
- Add an item: send it without `id`, or with `"id": null`. It is new, and its hidden fields start empty.
- Replace an item with a different one: leave the old one out and send the new one without `id`.
- Move an item into another list, or under another parent item: send it there without `id`. It is new in its
  new place.

A list in which any item sends an `id` (a string, or `null`) is paired by `id`: there, every item without a
string `id` is new. A list in which no item has an `id` key is paired as described in
[Writes without item IDs](#writes-without-item-ids). A single (not repeatable) component always continues its
stored instance: send its `id` back, or `"id": null`, or no `id`. On a create, every `id` sent is ignored and the
server assigns new ones.

These are refused with `422 CONTENT_INVALID`, one issue in `details.issues` per problem, and nothing is written:

| Issue code               | Path            | Message                                                                                                                     |
| ------------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `UNKNOWN_ITEM_ID`        | the item's `id` | is not the ID of an item this list holds; send back the id of each item as you read it, and leave the id out for a new item |
| `DUPLICATE_ITEM_ID`      | the item's `id` | is sent for more than one item; send each item's id once, and leave the id out for a new item                               |
| `ITEM_COMPONENT_CHANGED` | the item's `id` | names an item that holds another component; to replace the item, leave its id out                                           |

`UNKNOWN_ITEM_ID` answers an `id` that is not one of the stored items of that list (for a single component, not
its stored instance): an item from another list or another parent item, or one that someone else's write
deleted. `ITEM_COMPONENT_CHANGED` answers a dynamic zone item sent with a known `id` and a different
`__component`. The path is a JSON pointer in your API IDs, such as `/links/2/id`. The order of refusals is: an
invalid body (`422`), item refusals (`422`), a forbidden field (`403`), then a stale version (`409`).

The write response names the `id` of each item it wrote, in `data.itemIds`, so a caller that cannot read the
entry back (an app user while the entry has unpublished changes, for example) can send them on its next write.
It holds only the component fields the body sent, by your API IDs (the client's own through a
[schema version](schema-lenses.md#writes)): each instance as `{ "id" }`, dynamic zone items with `__component`
too, and component fields nested inside them when the body sent those. It is `{}` when the body sent no component
field. GraphQL mutations do not return it.

```json
{
  "data": {
    "id": "6f2c0a1e-4b7d-4f3a-9c55-1e8d2b7a9f40",
    "locale": "en",
    "version": 3,
    "status": "modified",
    "createdAt": "2026-10-01T09:12:44.512Z",
    "updatedAt": "2026-11-11T10:04:31.207Z",
    "publishedAt": "2026-10-02T08:00:00.000Z",
    "itemIds": {
      "cards": [{ "id": "6b…" }, { "id": "9c…", "chips": [{ "id": "1f…" }] }],
      "hero": { "id": "a2…" },
      "blocks": [{ "id": "e4…", "__component": "quote" }]
    }
  },
  "meta": {}
}
```

#### Writes without item IDs

A client that sends no `id` (a client written before 0.9.0, for example) has its items paired with the stored
items by what the caller can read of each item. When the list can hold fields hidden from the caller, Shapio
pairs only what it can be certain of:

1. **The list sent back unchanged:** every item continues its stored item.
2. **An edit in place:** the list kept its length, every place holds the same component as before, no changed
   item's old content appears at another place, and the list is not just a reordering. Each changed item
   continues the stored item at its place and keeps its hidden values. Replacing the only item (`[A]` sent as
   `[X]`) is such an edit; send `X` with `"id": null` to make it new instead.
3. **Anything else:** only an item exactly equal to a stored item, as the caller reads it, continues that item:
   an item that appears once in each list wherever it moved, and items that look alike in order. Stored items
   left over are deleted with their hidden values, and sent items left over are new and carry nothing. When
   left-over stored items and new items fall in the same stretch between matched items, Shapio cannot tell an
   edit from a delete plus an insert, and refuses the list.
4. A list inside an item is paired the same way, under the stored item its parent continues. Items under a new
   parent are new.

A refused list answers `422 CONTENT_INVALID` with the issue `AMBIGUOUS_ITEMS` on the list's path and no other issue
under that path, and nothing is written. Whether a list can hold hidden fields is decided from
the content type alone: some component the list allows has, at any depth, a field private to its audience or
deprecated (through a [schema version](schema-lenses.md#writes), also a field added since that version or one
the caller cannot write). Stored values never decide it, so a refusal tells the caller nothing about values it
cannot see. Through a schema version, a value sent back for a field the client cannot write, on an item Shapio
could not match to a stored one, is also reported as `AMBIGUOUS_ITEMS` for the list. A list that cannot hold
hidden fields is never refused, and neither is an admin API write: items are paired as closely as possible, and
an item Shapio is unsure of gets a new `id`. The message is:

- "cannot be matched to the stored items with certainty, and its items can hold values this caller cannot see;
  send back the id of each item as you read it, or change one thing at a time"
- or, when the caller cannot see the stored items at all (see below): "replaces items this caller cannot read,
  and they can hold values it cannot see; send back the id of each item as you read it, leave the field out to
  keep it, or send an empty list to clear it"

| Change                                                              | Example                                           | Without `id`, on a list that can hold hidden fields                                        |
| ------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| No change                                                           |                                                   | every item continues                                                                       |
| Edits in place                                                      | `[A, B]` → `[A2, B2]`                             | each edited item keeps its hidden values                                                   |
| Replace the only item                                               | `[A]` → `[X]`                                     | an edit in place: `X` keeps `A`'s hidden values                                            |
| Delete one item                                                     | `[A, B, C]` → `[A, C]`                            | `B` deleted                                                                                |
| Insert an item away from edits                                      | `[A, B]` → `[A, X, B]`                            | `X` new                                                                                    |
| Reorder items that differ                                           | `[A, B]` → `[B, A]`                               | every item continues                                                                       |
| Delete the first item and add one at the end                        | `[A, B]` → `[B, X]`                               | `A` deleted, `X` new                                                                       |
| Move and edit an item in one write                                  | `[A, B]` → `[B2, A]`                              | read the same way: `B` deleted, `B2` new, keeping nothing of `B`                           |
| Move one item and replace the others                                |                                                   | the moved item keeps its hidden values; replaced items are deleted, new ones carry nothing |
| Delete one of several items that look the same                      | `[A, A]` → `[A]`                                  | refused                                                                                    |
| Duplicate an item                                                   | `[A]` → `[A, A]`                                  | refused                                                                                    |
| Edit an item and delete another                                     | `[A, B, C]` → `[A2, B]`                           | refused, whether or not the two are next to each other                                     |
| Insert next to an edited item                                       | `[A]` → `[X, A2]`                                 | refused                                                                                    |
| Reorder look-alikes across a moved item                             | `[A, B, A]` → `[A, A, B]`                         | refused                                                                                    |
| An edit mixed with a move                                           |                                                   | refused when the changed item and a left-over stored item fall in the same stretch         |
| Swap and edit both, through a schema version where `w` is read-only | `[{p, w:1}, {q, w:2}]` → `[{q2, w:2}, {p2, w:1}]` | refused; with `id`s it is accepted and each `w` stays with its item                        |

With `id`s every row is certain. To move and edit an item in one write and keep its hidden values, send its `id`.
To replace the only item with a new one, send the new item with `"id": null`: `A` and its hidden values are
deleted.

**Who can be refused.** Fields private to their audience inside a component are hidden from every delivery
caller, whatever its role grants, and deprecated fields are hidden from every caller. Delivery tokens cannot
write. So on a content type whose components hold a private or deprecated field, at any depth, app users and
anonymous callers with an update grant can be refused, when they send no `id`s, for:

- deleting one of several items that look the same to the caller;
- duplicating an item;
- editing an item and deleting another in the same write, next to it or not;
- editing an item and inserting a new one next to it;
- reordering look-alike items so that one crosses a moved item;
- an edit mixed with a move, so that a changed item and a left-over stored item share a stretch;
- any list with items while the caller cannot see the draft it writes. App users and anonymous callers never
  read drafts, so this covers every entry with unpublished changes or never published, including an app user's
  own second edit before an editor publishes the entry.

Sending `[]`, leaving the field out, and sending back the `id`s read are always allowed. Content types whose
components hold no private or deprecated field never see these refusals. An admin writing through the delivery
routes can be refused only when the components hold deprecated fields; admin API writes (`/api/admin/content`)
never are.

#### Limits and single components

Every delivery update that sends a component value, with or without `id`s, and every write through a
[schema version](schema-lenses.md#writes), may hold at most a component list or dynamic zone's `max` items, at any
depth, or 50,000 when the field sets none. A longer one is refused with `422 CONTENT_INVALID` (`TOO_MANY`) with
the body, before a forbidden field (`403`) or a stale version (`409`) is answered. Admin writes and delivery
creates that name no schema version have no such cap beyond the field's own `max`.

A single (not repeatable) component always continues the stored instance. The fields kept are the ones the
caller cannot read. A caller that may update an entry but not read it sees nothing, so only what it cannot write
(deprecated fields) is kept: a field inside a component that it leaves out, or sends as `null`, is cleared, as
for every field it writes.
