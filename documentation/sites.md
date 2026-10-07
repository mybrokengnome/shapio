# Sites

One Shapio instance can run several **sites**: a company site, a docs site and a campaign microsite, say, with
one login. Each site has its own content and its own content types; a content type can also be shared with
every site, so a fleet of sites can have one `article` type and each site its own extras.

| Shared by every site                          | Each site's own                                                   |
| --------------------------------------------- | ----------------------------------------------------------------- |
| content types and components shared with all  | its own content types and components                              |
| locales                                       | entries, with their history, drafts and schedules                 |
| admin users and roles                         | media library and folders                                         |
| app roles (their grants)                      | snapshots (its own numbering) and change sets                     |
| the extension config (hooks, routes, editors) | app users (end users), and which app roles anonymous callers get  |
|                                               | delivery tokens, webhooks, deployment connections, preview tokens |
|                                               | field usage counters and content health findings                  |

Content never crosses sites. A relation or a media field can only point at an entry or asset on the same site;
pointing at another site's is refused as `RELATION_TARGET_MISSING` or `MEDIA_MISSING` ("does not exist on this
site"), the same answer as for an ID that exists nowhere. To publish the same article on two sites, create it on
both. A shared content type exists on every site, each with its own entries; a site that does not use it simply
leaves it empty.

An instance with one site works exactly as before: requests that name no site go to the primary site, and
nothing in this page needs doing.

## Content types per site

Every content type and component has a **scope**:

- **This site** (`site`): it belongs to one site. Only that site's admin, APIs, GraphQL schema, schema files
  and agents see it. Another site can have its own content type with the same API ID and different fields:
  two sites can each have a `post`.
- **All sites** (`network`, _shared_): one definition that every site has, with content per site. This is how
  every content type behaved before per-site schemas, and an upgraded instance finds all its existing content
  types and components shared.

A site's **view** of the schema is its own definitions plus the shared ones. Everything about content reads
that view: the delivery and admin APIs (`/api/content/post` on a site without a `post` is `404`), GraphQL
([one schema per site](graphql.md#authentication)), the API docs, extensions' `services.content.models()`,
schema files and the MCP server. An entry can only be written on a site whose view has its model, also while
the model's scope is changing.

A few rules keep every view valid:

- A site's content types may use shared components and relate to shared content types and to their own
  site's. A shared definition may only refer to shared ones, since a site's are missing on the other sites.
- API IDs (and plural API IDs and the generated GraphQL names) must be unique within each view. So a shared
  content type can never have the API ID of any site's own, and creating a shared `post` is refused while a
  site has a `post` of its own (`422 API_KEY_COLLISION`, naming the site in `details.issues[].siteKey`). Stable
  IDs of definitions and fields stay unique across the whole instance.
- A change to a site's definition is checked against that site's view; a change to a shared one against every
  site's.

### Who can change them

A role held on one site grants `schema.create` and `schemaManage` (see [Permissions](#permissions-and-assignments))
for that site's own content types and components: a site admin creates and changes their site's schema without
any role elsewhere. Creating, changing or deleting a **shared** definition, and changing any definition's
scope, needs the permission from a role held on all sites, as do locales and the
[read-only lock](schema-sync.md#optional-a-read-only-lock).

### Content types in the admin

Where there is more than one site, creating a content type or a component asks where it is **available on**:
_This site_ (the default) or _All sites_. A new type belongs to the site it was created on unless _All sites_ is
chosen; that choice needs `schema.create` on every site, and is otherwise shown switched off with a hint. On a
one-site instance the choice is not shown and new types belong to that site; share them before they are
needed on a second site.

In the sidebar, a content type shared with all sites has a small globe beside its name ("Shared with all
sites"); a site's own types have no mark. The Components list marks shared components the same way.

The builder's **Model settings** show where a type is available. With schema permission on every site, _Share
with all sites_ or _Keep on this site_ changes it, after a confirmation. An admin whose schema role is held on
one site only can read a shared type's structure but not change it, and the builder says why.

**Network → Content types** lists the content types and components shared with all sites, with their kind,
and creates new shared ones. It is shown to admins with `schema.create` on every site.

### Changing the scope

Sharing a site's content type with all sites is allowed whenever the result is valid in every site's view:
its API ID must not be taken on another site, and whatever it refers to must be shared first (share
components and related types before the types that use them). Its entries stay on their site.

Keeping a shared content type on one site is refused while:

- another site still has entries of it (`409 SCOPE_IN_USE`, with the number of entries; admins who see every
  site also get the count per site), or
- a shared definition or another site's definition refers to it (`SCHEMA_INVALID`).

Delete the other sites' entries, or the references, first. Once kept on one site, the type disappears from the
other sites' admin, APIs and GraphQL schema.

A site's own content type can also move to another site: `PUT /:id/scope` with `"scope": "site"` and the other
site's `siteId`. It is allowed only while no site other than the target holds entries of it, so in practice its
current site must have none; the same refusals and the same `schema.scope` audit apply. The admin and
`shapio schema scope` cannot do this; it is done through the API.

A scope change is metadata: the definition itself does not change, but it gets a new version (a save from a
builder opened before the change is refused as a conflict), the schema version moves, and no snapshot is taken
on any site. It is recorded in the audit log as `schema.scope`.

### In the API

`/api/admin/models` and `/api/admin/components` answer for the request's site (`Shapio-Site` or `?site=`):

- `GET` lists the site's view; every item carries `scope` (`site` or `network`) and `siteId` (null when
  shared). `?scope=network` lists the shared definitions only.
- `POST` (and `POST /plan`) take an optional `scope`: `site` (the default) creates the definition on the
  request's site, `network` shares it with all sites.
- `PUT /:id/scope` with `{ "scope": "network" | "site", "version": <active version> }` changes the scope.
  For `site` the definition goes to the request's site, or to `siteId` when given. A stale `version` is
  `409 SCHEMA_VERSION_CONFLICT`.

```sh
curl -X PUT "$SHAPIO_URL/api/admin/models/<model id>/scope?site=blog" -H "Authorization: Bearer $SHAPIO_TOKEN" \
  -H 'Content-Type: application/json' -d '{"scope":"network","version":4}'
```

The built-in SEO component is always shared with all sites; each site keeps its own SEO defaults
([SEO fields](seo.md)).

`GET /api/admin/auth/me` reports `siteCount` (how many sites the instance has) and lists `schema.create` in
`sitePermissions` when a role on the site grants it there; `networkPermissions` lists it only when a role on
every site does, which is what creating shared types needs. From the command line, `shapio schema scope` does
the same ([Schema sync](schema-sync.md#several-sites)).

## Creating a site

From the server host (direct database access, like `shapio admin create`):

```sh
npx shapio sites create --key marketing --name "Marketing site"
npx shapio sites list
# default   Default site   (primary)
# marketing Marketing site
```

Or through the admin API (`sites.manage`, which only roles held on every site grant):

```sh
curl -X POST "$SHAPIO_URL/api/admin/sites" -H "Authorization: Bearer $SHAPIO_TOKEN" \
  -H 'Content-Type: application/json' -d '{"key":"marketing","name":"Marketing site"}'
```

Creating a site is a row in the database: no restart, no migration. The **key** (lower case, starting with a
letter: `^[a-z][a-z0-9-]{0,62}$`) is how URLs, `?site=`, the `Shapio-Site` header and starter config name the
site, and it cannot change. The name can (`PATCH /api/admin/sites/:id` with `expectedVersion`).

A new site starts empty: snapshot 0, no tokens, no webhooks, and **no anonymous access** (see
[App users](#app-users-and-anonymous-access)).

A site can be deleted only when it is empty: no entries, media, folders, change sets, app users or content
types and components of its own (`409 SITE_NOT_EMPTY` lists what is left, with `definitions` counting its own
content types and components). Delete them, or share them with all sites, first; definitions the site had
already deleted go with it. Its tokens, webhooks, deployment connections, role assignments and
snapshot history go with it. Sites cannot be merged or split later.

### The primary site

Every instance has exactly one **primary** site, key `default`. It cannot be deleted. Requests that name no site
go to it, and an upgraded instance finds all its existing content there.

## Which site a request reads

Every request about content is about exactly one site, chosen in this order:

1. **The credential's site.** Delivery tokens, site admin tokens, app-user tokens and preview tokens belong to
   one site and only ever act on it.
2. **The site the request names**, with `?site=<key>` or the `Shapio-Site: <key>` header. Anonymous callers,
   admins in the browser and network admin tokens pick a site this way.
3. **The primary site**, when neither names one.

Naming a different site than the credential's is refused with `403 SITE_MISMATCH`, never redirected, and so is a
request whose header and `?site=` disagree. An unknown key is `404 SITE_NOT_FOUND`. Another site's entries,
assets, change sets and tokens read as not found.

| Client                            | How to name the site                                                     |
| --------------------------------- | ------------------------------------------------------------------------ |
| REST delivery and snapshot routes | `?site=<key>` or `Shapio-Site` ([Delivery API](delivery-api.md#sites))   |
| GraphQL                           | `Shapio-Site`, or `?site=` on GET ([GraphQL](graphql.md#authentication)) |
| `@shapio/client`                  | `createClient({ …, site: 'marketing' })`                                 |
| `shapio export` / `shapio import` | `--site <key>` or `SHAPIO_SITE`                                          |
| `@shapio/mcp` / `shapio mcp`      | `--site <key>` or `SHAPIO_SITE` ([MCP server](mcp.md))                   |
| Starters                          | the site key in the starter's config ([Starters](starters.md))           |

With a delivery token you never need to name the site: the token's site is the only one it reads. Naming it
anyway is harmless when it matches, and catches a token pasted into the wrong site's config.

`@shapio/client` puts the site in the query string on delivery and snapshot `GET`s (a simple cross-origin `GET`
needs no CORS preflight, and URL-keyed caches keep sites apart) and in the `Shapio-Site` header everywhere else.

### Caches and CDNs

Cacheable delivery responses (REST and GraphQL `GET`s) send `Vary: Authorization, Cookie, Shapio-Site`. A CDN
that keys its cache on the URL alone and ignores `Vary` must be given the site as `?site=`, never only as the
header, or two sites could share a cached response.

### Snapshots

Each site numbers its own snapshots: snapshot 12 of one site says nothing about another. `?snapshot=N`,
`/api/snapshots/*` and GraphQL's `_snapshot` and `_changes` answer for the request's site
([Snapshots and the changes API](snapshots.md)). Publishing on one site never moves another site's number, so
builds pinned on other sites are unaffected.

A schema change that converts stored values takes one snapshot on every site whose published content it
changes, and none on the others. A change to a site's own content type can only change that site's content, so
it numbers that site alone; a change to a shared one can number several. The change set's own site records it as
the change set; the other sites record a **conversion** that names the change set and its site. Changing a
content type's scope takes no snapshot.

### Media files

Media file URLs (`/api/media/f/<key>`) are the same for every site and need no site: public files are public,
and a private file's signed URL is its own access control. Signed URLs are only issued by reads on the asset's
own site.

## Permissions and assignments

Roles are shared by every site; an **assignment** says where a role applies: on one site, or on **all sites**.
Someone can be Editor on the marketing site, Read-only on the docs site and nothing on the rest.

| Assigned on | Gives                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------- |
| one site    | the role's content permissions and **site permissions** on that site                      |
| all sites   | the role's permissions on every site, current and future, and its **network permissions** |

- **Network permissions** are about the whole instance: `schema.create`, `users.manage`, `roles.manage`,
  `audit.read`, `sites.manage`, and `schemaManage` on models. Only roles held on all sites grant them, so a site
  admin cannot change shared content types, locales, invite people or give themselves another site. The one
  exception is the site's own schema: a role held on a site grants `schema.create` and `schemaManage` there for
  that site's own content types and components ([Who can change them](#who-can-change-them)).
- **Site permissions** are about one site: `tokens.manage`, `media.*`, `publishing.manage`, `webhooks.manage`,
  `deployments.*`, `changes.manage` and `changes.ship`.
- The **Owner** role can only be held on all sites.
- An admin who holds no role on a site gets `403 SITE_FORBIDDEN` there. `GET /api/admin/auth/me` still answers on
  every site, with `site`, `sites` (where they work), `siteCount`, `networkPermissions`, `sitePermissions` and the
  model permissions of that site, which is what the admin's site switcher uses.

The users and invitations APIs take assignments:

```json
{ "assignments": [{ "roleId": "<editor role id>", "siteId": "<marketing site id>" }] }
```

`"siteId": null` means all sites. The older `roleIds` list is still accepted and means "these roles on all sites".

## App users and anonymous access

App users (the end users of your sites, see [End users](end-users.md)) belong to one site. The same email address
can have separate accounts on two sites, each with its own password; signing up, signing in and OAuth all happen
on the request's site. An app user's access token names its site and is refused on any other
(`403 SITE_MISMATCH`), and so are its refresh token, its confirmation and reset links and an OAuth login code
used on another site.

Which app roles apply is set per site. App roles and their grants are shared, but which ones **anonymous
callers** (`public`) and **every signed-in app user** (`authenticated`) hold is bound on each site:

```sh
curl -X PUT "$SHAPIO_URL/api/admin/sites/<site id>/app-roles" -H "Authorization: Bearer $SHAPIO_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"public":["<public role id>"],"authenticated":["<authenticated role id>"]}'
```

The primary site binds the built-in `public` and `authenticated` roles. **A new site binds nothing**, so it serves
nothing anonymously and gives signed-in app users only their own custom roles until you bind roles there.
Changing bindings needs `roles.manage`.

The per-email rate limits on sign-up, password reset and confirmation mail count an address across all sites
together. App-user emails use the instance's sender for every site.

## API tokens

- **Delivery tokens** always belong to the site they were created on.
- **Site admin tokens** act on their site only, and never get network permissions.
- **Network admin tokens** carry their role on every site and to network actions, and pick a site per request
  with `?site=` or `Shapio-Site`. Create one with `"network": true`; only admins with `users.manage` (held on
  all sites) can. Without it, every token belongs to the site it was created on.

Settings → API tokens lists and revokes the current site's tokens, plus network tokens for admins with
`users.manage`, with a **Site** column. Creating an admin token there asks where it **works on**: _This site_
(the default) or _Every site (network token)_, a choice shown only to admins with `users.manage`.

## Webhooks and deployments

- A **site webhook** receives its site's events and network events (locale changes and changes to shared
  content types, which concern every site; a change to a site's own content type is that site's event only). A **network webhook** receives every site's events. Create one with `"network": true`, which needs
  `webhooks.manage` on all sites; that choice is fixed once created. Every delivery body has a `site` field
  (`{ "id", "key" }`, or `null` for a network event). See [Webhooks](publishing.md#webhooks).
- **Deployment connections** belong to a site. A site's publishes and change sets build its own connections; a
  change to a shared content type builds every site's connections that build on schema changes, a change to a
  site's own content type only that site's.

## Preview

A preview token previews one entry of one site, and the preview API answers only for that site
([Preview](publishing.md#preview)). The preview URL template comes from a connection of the entry's site.

## Change sets, field usage and content health

- A change set belongs to one site and ships as one snapshot there. It can only hold that site's entries and
  schema drafts of definitions in that site's view. A draft of the site's own content type needs schema
  permission on the site; a draft of a shared one (or a new definition created shared) needs it on all sites,
  and the review marks it "Shared, affects every site" and lists the affected entries per site
  ([Change sets](change-sets.md)).
- Field usage is counted per site. Before a breaking change, the review shows the readers of the affected fields.
  A site's own content type is only read on that site, so its readers are that site's. A shared one is read on
  every site: with permissions on all sites you see each reader and its site, otherwise your site's readers and
  the other sites as totals.
- Content health checks every site in one sweep; each site sees its own findings.

## Export and import

A bundle holds one site's content, media, app users, webhooks and deployment connections, plus its view of the
schema (the site's own content types and the shared ones, each marked with its scope), locales and roles:

```sh
npx @shapio/cms export --url https://cms.example.com --token shp_… --site marketing marketing.ndjson
npx @shapio/cms import --url https://cms.example.com --token shp_… --site docs marketing.ndjson
```

Without `--site` (or `SHAPIO_SITE`) the token's site is used, else the primary site. On import, the exported
site's own content types are created on the target site and shared ones are shared on the target instance, which
needs schema permission on every site (refused definitions are listed before anything is written). Bundles from
before per-site schemas mark nothing, and their content types import as shared. See
[Backup and restore](backup-restore.md#content-export-and-import).

## Agents (MCP)

Set `SHAPIO_SITE` or pass `--site <key>` to `@shapio/mcp` (`shapio mcp --site <key>` prints the configuration);
otherwise the agent works on its token's site, else the primary site. See [MCP server](mcp.md).

## Extensions

Custom routes are site routes: `request.site` is the request's site (`{ id, key }`). Hooks receive `site` (the
entry's site), and the `services` they get read that site. Services given to routes, jobs and service factories
read the primary site; use `services.forSite(request.site)` for another. See [Extensions](extensions.md).

## In the admin

The admin's URLs carry the site: `/admin/s/<key>/…`. A URL without a site opens the last site used in that
browser, else the primary site. Pages about the whole instance live under `/admin/network/…`, and the old
`/admin/users`, `/admin/settings/roles` and `/admin/settings/audit-log` addresses redirect there.

**The site switcher** sits in the sidebar header, under the wordmark. It shows the current site's name and key,
the other sites you work on and, if you hold any of `sites.manage`, `users.manage`, `roles.manage`,
`audit.read` or `schema.create`, **Network**. Picking another site opens its Inbox with a full page load, so
nothing from one site's screens carries over to another. The ⌘K palette offers the network pages from any site.

**Network** pages:

- **Sites**: every site, and **New site** (a name and a key, which is fixed once created). Any admin with a
  network permission can look; creating a site needs `sites.manage`. A site's page renames it (a stale edit is
  refused with a conflict), sets its **App roles** (checkbox groups for _Public_ and _Authenticated_; needs
  `roles.manage`), and deletes it. **Delete site** shows the server's reason when the site is not empty; the
  primary site has no delete button.
- **Users**: people, their access and invitations. A badge per assignment reads _Editor · Blog_ or
  _Editor · All sites_. **Change access** edits the rows (site or _All sites_, and a role; **Add a site**, remove
  a row); Owner can only be given on _All sites_. On a single-site instance this is just the role. Pending
  invitations show their assignments, with copy-link and revoke.
- **Roles** (admin and app roles) and the **Audit log**.

In a site, the sidebar's **Workspace** group has **App users** (that site's end users; needs `users.manage`),
**Locales** and **Settings**. Settings no longer lists Roles or the Audit log.

- **Webhooks**: admins with any network permission choose whether a new webhook **receives events from** this
  site or every site; network webhooks show an _Every site_ badge in the list and on their page.
- **No role on a site**: an admin who opens a site they hold no role on sees only the site switcher and a
  button to open their first site.
- The API explorer and the Snapshots page's pinning snippet add `?site=<key>` when you are on a site other than
  the primary one.

## Upgrading to sites

The upgrade migrates on start, as usual, and moves everything to the primary site. Single-site instances behave as
before, with three visible effects:

- **App users' access tokens** issued before the upgrade are rejected (`401 INVALID_TOKEN`), because they do not name a
  site.
  Apps that refresh on `401` recover by themselves; refresh tokens keep working.
- **Model-wide preview tokens** are deleted; preview tokens now always name an entry. Open Preview again.
- **Field indexes** are rebuilt in the background by the `schema.fieldIndexLayout` job, with the site leading.
  The old indexes serve queries until their replacements are ready. Instances without field indexes skip it.

Existing admin API tokens become network tokens and existing delivery tokens belong to the primary site, so
both keep working. Role assignments become "all sites". Rolling the migration back is only possible while one
site exists.

The later upgrade to per-site content types makes every existing content type and component shared with all
sites, so nothing changes for existing sites. Content types created afterwards belong to their site unless
shared (see [Content types per site](#content-types-per-site)). Its migration can be rolled back only while no
content type or component belongs to a site.

Not yet available: choosing the site from the request's host name, and a media library shared by several sites.
