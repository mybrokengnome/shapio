# GraphQL

GraphQL is served at `{PUBLIC_URL}{BASE_PATH}/api/graphql`: POST with a JSON body
(`{ "query", "variables", "operationName" }`; `Content-Type: application/graphql` is not accepted, and neither are
batched requests), or GET for queries (`?query=…&variables=<JSON>`; a mutation over GET is refused with `405`).
Its schema is generated from your models, in memory: add a field in the admin and the next query can ask for it, with no restart. It
uses the same permissions, filters, page sizes and services as the [REST delivery API](delivery-api.md), so a
query returns exactly what the equivalent REST request returns.

## Playground

In the admin, **Develop → GraphQL** opens GraphiQL on the site you are working in: write a query, run it with
your admin session, and browse every type and field in its **Docs** panel, which shows each content type's and
field's label and help text. Your session can ask for drafts (`publicationState: DRAFT`); delivery tokens and
anonymous callers only ever get published content. GraphiQL follows the admin's light or dark look.

The **API explorer**'s GraphQL tab turns the request you built on its REST tab into the same query (filters,
sort, search, page, locale, snapshot and fields; `populate` has no GraphQL argument, since a query expands a
relation by selecting it) with **Open in playground**, which opens that query in Develop → GraphQL.

Outside the admin shell the page is at `/api/graphql/playground` (signed in to the admin): `?site=<key>` points
it at that site's schema, `?query=` opens it on an operation and `?theme=light|dark` fixes its theme. Its files
are served by Shapio itself, no CDN. Turn it off with `GRAPHQL_PLAYGROUND_ENABLED=false`.

## Authentication

The same credentials as REST, in the `Authorization: Bearer` header: a delivery token, an admin API token, or
an app user's access token. Without one the request is anonymous and gets what the public app role grants.
Requests made with the admin's session cookie must also send the `X-CSRF-Token` header.

On an instance with several [sites](sites.md), a request reads one site, chosen as in REST
([Delivery API](delivery-api.md#sites)): the token's site, else the `Shapio-Site` header or `?site=`, else the
primary site. Naming another site than the token's is refused with `403 SITE_MISMATCH`. The entries,
`_snapshot` and `_changes` are the request site's. GET responses vary on `Shapio-Site` as well as on the
credentials.

Each site has its own schema: its own content types and the shared ones. Two sites can each have a `post`
with different fields, and each site's schema shows its own; a content type of one site is not in another
site's schema or introspection, so a query for it there fails validation (`400`). Generate client types per
site (introspect with `?site=` or `Shapio-Site`). A site's schema is built on its first request and rebuilt
when a model changes; a site's schema that no request has used for ten minutes is dropped from memory and built
again when next asked for.

## Schema shape

For a collection `article` (plural API ID `articles`) Shapio generates:

| Name                                                                                           | What                                                |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `article(id: ID!, locale, fallback, snapshot, publicationState)`                               | one entry, or null                                  |
| `articles(filter, sort, search, page, pageSize, locale, fallback, snapshot, publicationState)` | `{ nodes, totalCount, pageInfo, locale, snapshot }` |
| `Article`, `ArticleFilter`, `ArticleSort`, `ArticleInput`, `ArticleConnection`                 | the types behind them                               |
| `createArticle`, `updateArticle`, `deleteArticle`, `publishArticle`, `unpublishArticle`        | mutations, for principals allowed to write          |

The list query takes the collection's plural API ID; everything else is named after the singular API ID
([Modelling](modelling.md#kinds-of-definitions)).

A single type `home` is `home(locale, …)`. Field types: rich text is `RichText { json html }` (`html` is rendered only when selected), media is
`Media { id url width height alt variants { name width url } … }`, a relation is the target type (or a list of
it), a component is its own type, and a dynamic zone is a list of a union of its components (ask for
`__typename`). Every entry also has `localizations` (its versions in the other locales).

`publicationState: DRAFT` reads drafts; only admin users and admin API tokens may ask for it.

SEO fields come back as stored. `_site { key name seo { … } }` returns the request's site and its SEO
defaults; merge them with `resolveSeo()` from `@shapio/client` ([SEO fields](seo.md#graphql)).

## Example

```graphql
query Articles($locale: String) {
  articles(
    locale: $locale
    filter: { publishedOn: { gte: "2026-09-01" } }
    sort: [{ publishedOn: DESC }]
    pageSize: 10
  ) {
    totalCount
    snapshot
    nodes {
      id
      title
      slug
      body {
        html
      }
      cover {
        url
        alt
        width
        height
      }
      author {
        name
      }
    }
  }
}
```

```sh
curl "$SHAPIO_URL/api/graphql" \
  -H "Authorization: Bearer $SHAPIO_DELIVERY_TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":"query($locale: String) { articles(locale: $locale, sort: [{ publishedOn: DESC }]) { totalCount nodes { title author { name } } } }","variables":{"locale":"fr"}}'
```

Filters mirror REST's operators without the `$`: `{ publishedOn: { gte: "2026-09-01" } }`,
`{ slug: { containsi: "snapshot" } }` (text matching and ranges need a filterable field, as in REST),
`{ or: [{ slug: { eq: "a" } }, { slug: { eq: "b" } }] }`. Pin a build to one moment with `snapshot`, exactly as
with REST.

## Snapshots

Two root queries mirror REST's `/api/snapshots` endpoints, for incremental builds:

| Query                                    | What                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `_snapshot`                              | `{ snapshot schemaVersion publishedAt }`: the current snapshot, to pin the build to                                 |
| `_changes(from: Int!, to, after, first)` | `{ from to fromSchemaVersion toSchemaVersion nextCursor nodes { id modelKey routeKey locales { locale change } } }` |

```graphql
query Since($from: Int!) {
  _snapshot {
    snapshot
  }
  _changes(from: $from, first: 100) {
    toSchemaVersion
    fromSchemaVersion
    nextCursor
    nodes {
      modelKey
      id
      locales {
        locale
        change
      }
    }
  }
}
```

`change` is `PUBLISHED`, `UPDATED` or `UNPUBLISHED`; only models the caller may read are reported. When the two
schema versions differ, rebuild the affected models. See [Snapshots and the changes API](snapshots.md).

These names are reserved: `_changes`, `_snapshot` and `_schemaVersion` as query names, and `SnapshotChange`,
`SnapshotChangeKind`, `SnapshotChangeLocale`, `SnapshotChangePage` and `SnapshotInfo` as type names. A model
whose generated names would collide with them is refused when you save it.

## Limits

- Query depth: `GRAPHQL_MAX_DEPTH` (10).
- Estimated cost: `GRAPHQL_MAX_COMPLEXITY` (20 000). Each field costs 1, multiplied by the page sizes and lists
  around it; a collection query also costs its page size (the rows it reads) and `totalCount` costs 10 (a
  count query). Ask for smaller pages or fewer nested lists if you hit it (`QUERY_TOO_COMPLEX`).
- At most 30 aliased fields in one selection (`QUERY_TOO_MANY_ALIASES`), so one request cannot repeat an
  expensive field thousands of times.
- `pageSize` is at most 100, like REST.
- Introspection is open to admins and API tokens. Anonymous callers and app users get it only with
  `GRAPHQL_PUBLIC_INTROSPECTION=true`.
- `GRAPHQL_ENABLED=false` turns GraphQL off.
