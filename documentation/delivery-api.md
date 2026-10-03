# Delivery API (REST)

Your sites and apps read published content from one generic route per model:

```text
GET {PUBLIC_URL}{BASE_PATH}/api/content/<plural API ID>              # a collection: a page of entries
GET {PUBLIC_URL}{BASE_PATH}/api/content/<plural API ID>/<entry id>   # a collection: one entry
GET {PUBLIC_URL}{BASE_PATH}/api/content/<API ID>                     # a single type: its entry
```

A collection is addressed by its **plural API ID** (`/api/content/articles`), a single type by its **API ID**
(`/api/content/homepage`). The singular API ID of a collection is not a delivery route: `/api/content/article`
is a 404. Both IDs are set on the model ([Modelling](modelling.md#kinds-of-definitions)). The admin content API
(`/api/admin/content/<API ID>`) always uses the singular.

There is no generated code per model: a model created a minute ago is served by the same routes at once.
Delivery returns **published** content only; drafts, unpublished entries, private media and fields your token
may not read never appear. The [REST reference](reference/rest-api.md) lists every read parameter (app-user
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
  grant names them.
- Without a token, a request is _anonymous_: it gets what the built-in **public** app role grants, which is
  nothing until you allow it (Network → Roles → App roles). Use that for content anyone may read from the
  browser. App users' own tokens are covered in [End users](end-users.md).

## Sites

One Shapio instance can host several [sites](sites.md) that share the content types but each have their own
content, tokens and snapshots. Every delivery request reads exactly one site:

1. **The token's site.** Delivery tokens belong to the site they were created on, and only ever read it.
2. **The site the request names**, with `?site=<key>` or the `Shapio-Site: <key>` header. Anonymous callers and
   network admin tokens use this to pick a site.
3. **The primary site**, when neither names one. An instance with a single site never needs to name it.

Naming a different site than the token's is refused with `403 SITE_MISMATCH`, never redirected, and so is a
request whose header and `?site=` disagree. An unknown key is `404 SITE_NOT_FOUND`. Entries of another site
read as not found, and relations never cross sites.

```sh
curl "$SHAPIO_URL/api/content/articles?site=marketing"
```

Anonymous reads get what the app roles bound to the request site's `public` audience grant. The primary site
binds the built-in **public** role; a new site binds none, so it serves nothing anonymously until you bind one
([Sites](sites.md#app-users-and-anonymous-access)).

With `@shapio/client`, pass the site once:

```ts
const shapio = createClient({ baseUrl: process.env.SHAPIO_URL, token, site: 'marketing' });
```

The client sends it as `?site=` on delivery and snapshot reads, which keeps a cross-origin `GET` free of a
CORS preflight and keeps URL-keyed caches apart. Every other request (writes, GraphQL, the admin API) carries
the `Shapio-Site` header. Leave `site` out to read the token's site, or the primary site.

## Responses

```json
{
  "data": [
    {
      "id": "6f2c…",
      "locale": "fr",
      "createdAt": "2026-10-01T09:12:44.512Z",
      "updatedAt": "2026-10-01T09:30:02.104Z",
      "publishedAt": "2026-10-01T09:30:02.104Z",
      "title": "Modéliser du contenu sans déploiement",
      "slug": "modelling-without-a-deploy",
      "excerpt": "…",
      "body": {
        "format": "shapio-richtext",
        "version": 1,
        "doc": { "type": "doc", "content": [] },
        "html": "<p>…</p>"
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
- **Rich text** is the stored JSON document plus `html`, rendered on the server from the JSON with an allow-list
  sanitiser (safe link protocols only, images resolved through the media library).
- **Media** fields are asset objects with URLs and ready [variants](media.md#image-variants); private assets
  carry an expiring signed URL.
- **Relations** are target IDs unless you `populate` them. A target that is not published, or that your token
  may not read, is left out (never its ID).
- **Components** are objects; **dynamic zones** are arrays of objects with `__component` (the component's
  API ID).
- A single type answers `/api/content/<API ID>` with `{ data: {…}, meta }`.

Errors always look like `{ "error": { "code": "…", "message": "…", "details": … } }`: 400 for an invalid query,
401 without credentials for content that needs them, 403 when your role may not read the model, 404 for an
unknown model or entry.

## Query parameters

| Parameter          | Example                               | Notes                                                                             |
| ------------------ | ------------------------------------- | --------------------------------------------------------------------------------- |
| `locale`           | `locale=fr`                           | falls back along the locale chain ([Localization](localization.md))               |
| `filters`          | `filters[slug][$eq]=about`            | see below                                                                         |
| `sort`             | `sort=publishedOn:desc,createdAt:asc` | fields marked sortable, `id`, `createdAt`, `updatedAt`                            |
| `page`, `pageSize` | `page=2&pageSize=50`                  | `pageSize` 25 by default, at most 100                                             |
| `fields`           | `fields=title,slug`                   | top-level fields to return (system attributes always come)                        |
| `populate`         | `populate=author`                     | relation paths: `author`, `author,tags.author`, or `*`; at most 3 levels          |
| `q`                | `q=snapshot`                          | searches the title field chosen in the model's display settings (400 without one) |
| `snapshot`         | `snapshot=10`                         | read as of a publication snapshot (below)                                         |

### Filters

`filters[<field>][<operator>]=<value>`, combined with `$and`, `$or` and `$not`:

```sh
curl -G "$SHAPIO_URL/api/content/articles" -H "Authorization: Bearer $SHAPIO_DELIVERY_TOKEN" \
  --data-urlencode 'filters[publishedOn][$gte]=2026-09-10' \
  --data-urlencode 'filters[$or][0][slug][$eq]=why-builds-pin-a-snapshot' \
  --data-urlencode 'filters[$or][1][slug][$eq]=modelling-without-a-deploy'
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
rather than ignored, so a filter can never reveal a hidden value.

## Snapshots: one consistent moment

Every publish moves a global **publication snapshot** number forward; every delivery response reports the
one it read in `meta.snapshot`. Pass `snapshot=N` and Shapio answers exactly as it would have at that moment,
even if more was published since:

```sh
curl -H "Authorization: Bearer $SHAPIO_DELIVERY_TOKEN" "$SHAPIO_URL/api/content/pages?snapshot=10&locale=en"
```

A static site build should read the current snapshot once at the start and pass it with every request: then
a publish in the middle of the build cannot produce a site that mixes two moments. The
[example site](example-site.md) does exactly this, and Shapio's deployment triggers carry the snapshot to build.

Old snapshots are read through the current schema (a value stored under an earlier field type comes back as
`null`). A [change set](change-sets.md) goes live as one snapshot, schema and entries together, so a pinned
build sees all of it or none of it.

Two endpoints serve builds, with the same tokens as `/api/content` and only for models the token may read:

| Endpoint                                         | Answer                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `GET /api/snapshots/current`                     | `{ snapshot, schemaVersion, publishedAt }`: what an unpinned read serves |
| `GET /api/snapshots/changes?from&to&after&limit` | entries and locales whose live content changed between the two snapshots |

Details, the change classification and incremental-build recipes are in
[Snapshots and the changes API](snapshots.md).

## Caching

Responses carry a strong `ETag` over the exact body and `Vary: Authorization, Cookie, Shapio-Site`. Send
`If-None-Match` to get `304 Not Modified` when nothing changed. Anonymous responses are `Cache-Control: public,
max-age=0, must-revalidate`; authenticated ones `private`. A CDN that keys its cache on the URL alone and
ignores `Vary` must be given the site as `?site=`, not as the header, so that two sites never share a cached
response.

## Writes

The same routes accept `POST`, `PUT` and `DELETE` from app users whose roles allow it (for example, members
editing their own entries). Delivery tokens cannot write. See [End users](end-users.md). Editors and your
build tools use the admin API (`/api/admin/content/<key>`) with admin credentials.
