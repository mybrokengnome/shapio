# REST API reference

<!-- Generated from Shapio’s OpenAPI generator for the example site’s schema by `pnpm docs:reference`. Do not edit by hand. -->

Shapio has no route per model in its code: every model is served by the same generic routes,
`/api/content/:modelKey` (delivery) and `/api/admin/content/:modelKey` (admin), resolved through the schema
registry at request time. The OpenAPI 3.1 document is generated from the active schema in memory, so it is
always current: your instance serves it to admins at `/api/docs` (HTML) and `/api/docs/openapi.json`.

The two APIs name a model differently. Delivery (and preview) addresses it by its **route key**: the
**plural API ID** of a collection (`/api/content/articles`), the API ID of a singleton
(`/api/content/homepage`). The admin content API always uses the **API ID** (`/api/admin/content/article`),
for collections and singletons alike.

Below are the routes generated for the `article` collection (plural API ID `articles`) of the
[example site](../example-site.md) (`examples/shared/shapio/models/article.json`). Every other model gets
the same set under its own API IDs.
Usage, filters and examples are in the [delivery API guide](../delivery-api.md); `seo=resolved` and
`GET /api/site` are in [SEO fields](../seo.md).

## The `Article` entry

What delivery returns for one entry (system attributes first, then every readable field):

| Property | Type | Description |
| --- | --- | --- |
| `id` | string (uuid) |  |
| `locale` | string |  |
| `createdAt` | string (date-time) |  |
| `updatedAt` | string (date-time) |  |
| `publishedAt` | string (date-time) |  |
| `title` | string or null |  |
| `slug` | string or null |  |
| `excerpt` | string or null |  |
| `body` | RichTextOutput or null |  |
| `cover` | MediaAsset or null |  |
| `author` | string (uuid) or Author or null |  |
| `publishedOn` | string (date) or null |  |
| `seo` | Seo or null |  |

## Routes

### GET /api/content/articles

List published Article entries.

| Parameter | In | Type | Description |
| --- | --- | --- | --- |
| `filters` | query | object | Filter with `filters[field][$op]=value`; combine with `$and`, `$or`, `$not`. Ranges need a filterable or sortable field; text matches (`$contains`, `$containsi`, `$startsWith`, `$endsWith`) a filterable one.<br>- `title`: $eq $ne $in $nin $null $notNull<br>- `slug`: $eq $ne $in $nin $null $notNull $lt $lte $gt $gte $contains $notContains $containsi $startsWith $endsWith<br>- `excerpt`: $eq $ne $in $nin $null $notNull<br>- `cover`: $eq $ne $in $nin $null $notNull<br>- `author`: $eq $ne $in $nin $null $notNull<br>- `publishedOn`: $eq $ne $in $nin $null $notNull $lt $lte $gt $gte |
| `sort` | query | string | Comma-separated `field:asc\|desc` (sortable fields, `id`, `createdAt`, `updatedAt`) |
| `page` | query | integer |  |
| `pageSize` | query | integer |  |
| `q` | query | string | Search the title field |
| `fields` | query | string | Comma-separated fields to return |
| `populate` | query | string | Relations to expand: `author,tags.author` or `*` (at most 3 levels) |
| `locale` | query | string | Locale to serve; falls back along the locale chain |
| `snapshot` | query | integer | Read content as of this publication sequence number (`meta.snapshot`) |
| `richText` | query | `json`, `html`, `both` | Rich-text shape: the JSON document, sanitized HTML rendered from it, or both |
| `seo` | query | `raw`, `resolved` | SEO fields as stored (`raw`) or merged with the site's SEO defaults (`resolved`): the title through the site's title template (the entry's own title when empty), description and image from the defaults, `noindex` a boolean. A pinned `snapshot` uses today's defaults. |

Responses: 200 OK; 304 Not modified (If-None-Match); 400 Invalid query or body; 401 Not authenticated; 403 Not allowed (including filters on hidden fields); 404 Unknown model or entry.

### GET /api/content/articles/{id}

Read one published Article entry.

| Parameter | In | Type | Description |
| --- | --- | --- | --- |
| `id` (required) | path | string (uuid) |  |
| `fields` | query | string | Comma-separated fields to return |
| `populate` | query | string | Relations to expand: `author,tags.author` or `*` (at most 3 levels) |
| `locale` | query | string | Locale to serve; falls back along the locale chain |
| `snapshot` | query | integer | Read content as of this publication sequence number (`meta.snapshot`) |
| `richText` | query | `json`, `html`, `both` | Rich-text shape: the JSON document, sanitized HTML rendered from it, or both |
| `seo` | query | `raw`, `resolved` | SEO fields as stored (`raw`) or merged with the site's SEO defaults (`resolved`): the title through the site's title template (the entry's own title when empty), description and image from the defaults, `noindex` a boolean. A pinned `snapshot` uses today's defaults. |

Responses: 200 OK; 304 Not modified; 400 Invalid query or body; 401 Not authenticated; 403 Not allowed (including filters on hidden fields); 404 Unknown model or entry.

### GET /api/admin/content/article

List Article drafts (admin).

| Parameter | In | Type | Description |
| --- | --- | --- | --- |
| `filters` | query | object | Filter with `filters[field][$op]=value`; combine with `$and`, `$or`, `$not`. Ranges need a filterable or sortable field; text matches (`$contains`, `$containsi`, `$startsWith`, `$endsWith`) a filterable one.<br>- `title`: $eq $ne $in $nin $null $notNull<br>- `slug`: $eq $ne $in $nin $null $notNull $lt $lte $gt $gte $contains $notContains $containsi $startsWith $endsWith<br>- `excerpt`: $eq $ne $in $nin $null $notNull<br>- `cover`: $eq $ne $in $nin $null $notNull<br>- `author`: $eq $ne $in $nin $null $notNull<br>- `publishedOn`: $eq $ne $in $nin $null $notNull $lt $lte $gt $gte |
| `sort` | query | string | Comma-separated `field:asc\|desc` (sortable fields, `id`, `createdAt`, `updatedAt`) |
| `page` | query | integer |  |
| `pageSize` | query | integer |  |
| `q` | query | string | Search the title field |
| `fields` | query | string | Comma-separated fields to return |
| `populate` | query | string | Relations to expand: `author,tags.author` or `*` (at most 3 levels) |
| `locale` | query | string | Locale to serve; falls back along the locale chain |

Responses: 200 OK; 400 Invalid query or body; 401 Not authenticated; 403 Not allowed (including filters on hidden fields); 404 Unknown model or entry.

### POST /api/admin/content/article

Create a Article entry (admin).

Body: `locale` (string), `publish` (boolean), `data` (ArticleInput).

Responses: 201 Created; 400 Invalid query or body; 401 Not authenticated; 403 Not allowed (including filters on hidden fields); 404 Unknown model or entry; 422 Invalid content.

### GET /api/admin/content/article/{id}

Read a Article draft (admin).

| Parameter | In | Type | Description |
| --- | --- | --- | --- |
| `id` (required) | path | string (uuid) |  |
| `locale` | query | string |  |

Responses: 200 OK; 400 Invalid query or body; 401 Not authenticated; 403 Not allowed (including filters on hidden fields); 404 Unknown model or entry.

### PUT /api/admin/content/article/{id}

Save a Article draft (admin; 409 when the expected version is stale).

| Parameter | In | Type | Description |
| --- | --- | --- | --- |
| `id` (required) | path | string (uuid) |  |

Body: `locale` (string), `expectedVersion` (integer or null), `autosave` (boolean), `data` (ArticleInput).

Responses: 200 OK; 400 Invalid query or body; 401 Not authenticated; 403 Not allowed (including filters on hidden fields); 404 Unknown model or entry; 409 Stale version; 422 Invalid content.

### DELETE /api/admin/content/article/{id}

Delete a Article entry (admin).

| Parameter | In | Type | Description |
| --- | --- | --- | --- |
| `id` (required) | path | string (uuid) |  |

Responses: 204 Deleted; 400 Invalid query or body; 401 Not authenticated; 403 Not allowed (including filters on hidden fields); 404 Unknown model or entry; 409 Still referenced.

### POST /api/admin/content/article/{id}/publish

Publish locales of a Article entry (admin).

| Parameter | In | Type | Description |
| --- | --- | --- | --- |
| `id` (required) | path | string (uuid) |  |

Body: `locales` (array of string).

Responses: 200 OK; 400 Invalid query or body; 401 Not authenticated; 403 Not allowed (including filters on hidden fields); 404 Unknown model or entry.

### POST /api/admin/content/article/{id}/unpublish

Unpublish locales of a Article entry (admin).

| Parameter | In | Type | Description |
| --- | --- | --- | --- |
| `id` (required) | path | string (uuid) |  |

Body: `locales` (array of string).

Responses: 200 OK; 400 Invalid query or body; 401 Not authenticated; 403 Not allowed (including filters on hidden fields); 404 Unknown model or entry.

### GET /api/snapshots/current

The current publication snapshot and schema version.

Responses: 200 OK; 400 Invalid query; 401 Anonymous, and the public role may read nothing.

### GET /api/snapshots/changes

Entries whose live content changed between two snapshots, by locale.

| Parameter | In | Type | Description |
| --- | --- | --- | --- |
| `from` (required) | query | integer |  |
| `to` | query | integer |  |
| `after` | query | string (uuid) |  |
| `limit` | query | integer |  |

Responses: 200 OK; 400 Invalid query; 401 Anonymous, and the public role may read nothing.
