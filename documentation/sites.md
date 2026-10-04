# Sites

One Shapio instance can run several **sites**: a company site, a docs site and a campaign microsite, say, with
one login and one set of content types. Each site has its own content; the schema and the team are shared.

| Shared by every site                          | Each site's own                                                   |
| --------------------------------------------- | ----------------------------------------------------------------- |
| content types and components (one schema)     | entries, with their history, drafts and schedules                 |
| locales                                       | media library and folders                                         |
| admin users and roles                         | snapshots (its own numbering) and change sets                     |
| app roles (their grants)                      | app users (end users), and which app roles anonymous callers get  |
| the extension config (hooks, routes, editors) | delivery tokens, webhooks, deployment connections, preview tokens |
|                                               | field usage counters and content health findings                  |

Content never crosses sites. A relation or a media field can only point at an entry or asset on the same site;
pointing at another site's is refused as `RELATION_TARGET_MISSING` or `MEDIA_MISSING` ("does not exist on this
site"), the same answer as for an ID that exists nowhere. To publish the same article on two sites, create it on
both. Every site has the same content types; a site that does not use one simply leaves it empty.

An instance with one site works exactly as before: requests that name no site go to the primary site, and
nothing in this page needs doing.

## Content types in the admin

Where there is more than one site, creating a content type or a component asks where it is **available on**:
_This site_ (the default) or _All sites_. A new type belongs to the site it was created on unless _All sites_ is
chosen; that choice needs a role on every site, and is otherwise shown switched off with a hint. On a
one-site instance the choice is not shown and new types belong to that site.

In the sidebar, a content type shared with all sites has a small globe beside its name ("Shared with all
sites"); a site's own types have no mark. The Components list marks shared components the same way.

The builder's **Model settings** show where a type is available. With a role on every site, _Share with all
sites_ or _Keep on this site_ changes it, after a confirmation; keeping a shared type on one site is refused
while another site still has entries of it. An admin whose schema role is held on one site only can read a
shared type's structure but not change it.

**Network → Content types** lists the content types and components shared with all sites, with their kind,
and creates new shared ones. It is shown to admins with `schema.create` on every site.

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

A site can be deleted only when it is empty: no entries, media, folders, change sets or app users
(`409 SITE_NOT_EMPTY` lists what is left). Its tokens, webhooks, deployment connections, role assignments and
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

A schema change is shared, so when it converts stored values it takes one snapshot on every site whose published
content it changes, and none on the others. The change set's own site records it as the change set; the other
sites record a **conversion** that names the change set and its site.

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
  admin cannot change the shared schema, invite people or give themselves another site.
- **Site permissions** are about one site: `tokens.manage`, `media.*`, `publishing.manage`, `webhooks.manage`,
  `deployments.*`, `changes.manage` and `changes.ship`.
- The **Owner** role can only be held on all sites.
- An admin who holds no role on a site gets `403 SITE_FORBIDDEN` there. `GET /api/admin/auth/me` still answers on
  every site, with `site`, `sites` (where they work), `networkPermissions`, `sitePermissions` and the model
  permissions of that site, which is what the admin's site switcher uses.

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

- A **site webhook** receives its site's events and network events (schema and locale changes, which concern
  every site). A **network webhook** receives every site's events. Create one with `"network": true`, which needs
  `webhooks.manage` on all sites; that choice is fixed once created. Every delivery body has a `site` field
  (`{ "id", "key" }`, or `null` for a network event). See [Webhooks](publishing.md#webhooks).
- **Deployment connections** belong to a site. A site's publishes and change sets build its own connections; a
  schema change builds every site's connections that build on schema changes.

## Preview

A preview token previews one entry of one site, and the preview API answers only for that site
([Preview](publishing.md#preview)). The preview URL template comes from a connection of the entry's site.

## Change sets, field usage and content health

- A change set belongs to one site and ships as one snapshot there. It can only hold that site's entries. A
  schema item in it changes the shared schema, so adding one needs schema permission held on all sites, and its
  review lists the affected entries per site ([Change sets](change-sets.md)).
- Field usage is counted per site. Before a breaking change, the review shows the readers of the affected fields
  on every site (the schema is shared): with permissions on all sites you see each reader and its site, otherwise
  your site's readers and the other sites as totals.
- Content health checks every site in one sweep; each site sees its own findings.

## Export and import

A bundle holds one site's content, media, app users, webhooks and deployment connections, plus the shared schema,
locales and roles:

```sh
npx shapio export --url https://cms.example.com --token shp_… --site marketing marketing.ndjson
npx shapio import --url https://cms.example.com --token shp_… --site docs marketing.ndjson
```

Without `--site` (or `SHAPIO_SITE`) the token's site is used, else the primary site. See
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

Not yet available: choosing the site from the request's host name, a media library shared by several sites, and
per-site differences in the schema.
