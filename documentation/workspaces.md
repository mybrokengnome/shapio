# Workspaces

One Shapio instance can hold several **workspaces**: one for a company website, one for a docs site, one for a
mobile app, say, with one login. Each workspace has its own content and its own content types; a content type
can also be shared with every workspace, so a fleet of workspaces can have one `article` type and each workspace
its own extras. The websites and apps that read a workspace are yours; the workspace is where their content
lives.

| Shared by every workspace                     | Each workspace's own                                              |
| --------------------------------------------- | ----------------------------------------------------------------- |
| content types and components shared with all  | its own content types and components                              |
| locales                                       | entries, with their history, drafts and schedules                 |
| admin users and roles                         | media library and folders                                         |
| app roles (their grants)                      | snapshots (its own numbering) and change sets                     |
| the extension config (hooks, routes, editors) | app users (end users), and which app roles anonymous callers get  |
|                                               | delivery tokens, webhooks, deployment connections, preview tokens |
|                                               | field usage counters and content health findings                  |

Content never crosses workspaces. A relation or a media field can only point at an entry or asset in the same
workspace; pointing at another workspace's is refused as `RELATION_TARGET_MISSING` or `MEDIA_MISSING` ("does not
exist in this workspace"), the same answer as for an ID that exists nowhere. To publish the same article in two
workspaces, create it in both. A shared content type exists in every workspace, each with its own entries; a
workspace that does not use it simply leaves it empty.

An instance with one workspace works exactly as before: requests that name no workspace go to the primary
workspace, and nothing in this page needs doing.

Workspaces were called sites before 0.8.2. Requests, responses, and files still use the older spelling in a few
places, and every one of them keeps working: see [Names you may still see](#names-you-may-still-see).

## Content types per workspace

Every content type and component has a **scope**:

- **This workspace** (`site`): it belongs to one workspace. Only that workspace's admin, APIs, GraphQL schema,
  schema files, and agents see it. Another workspace can have its own content type with the same API ID and
  different fields: two workspaces can each have a `post`.
- **All workspaces** (`network`, _shared_): one definition that every workspace has, with content per
  workspace. This is how every content type behaved before per-workspace schemas, and an upgraded instance finds
  all its existing content types and components shared.

A workspace's **view** of the schema is its own definitions plus the shared ones. Everything about content reads
that view: the delivery and admin APIs (`/api/content/post` in a workspace without a `post` is `404`), GraphQL
([one schema per workspace](graphql.md#authentication)), the API docs, extensions' `services.content.models()`,
schema files, and the MCP server. An entry can only be written in a workspace whose view has its model, also
while the model's scope is changing.

A few rules keep every view valid:

- A workspace's content types may use shared components and relate to shared content types and to their own
  workspace's. A shared definition may only refer to shared ones, since a workspace's own are missing in the
  other workspaces.
- API IDs (and plural API IDs and the generated GraphQL names) must be unique within each view. So a shared
  content type can never have the API ID of any workspace's own, and creating a shared `post` is refused while a
  workspace has a `post` of its own (`422 API_KEY_COLLISION`, naming the workspace in
  `details.issues[].siteKey`). Stable IDs of definitions and fields stay unique across the whole instance.
- A change to a workspace's definition is checked against that workspace's view; a change to a shared one
  against every workspace's.

### Who can change them

A role held on one workspace grants `schema.create` and `schemaManage` (see
[Permissions](#permissions-and-assignments)) for that workspace's own content types and components: a workspace
admin creates and changes their workspace's schema without any role elsewhere. Creating, changing, or deleting a
**shared** definition, and changing any definition's scope, needs the permission from a role held on all
workspaces, as do locales and the [read-only lock](schema-sync.md#optional-a-read-only-lock).

### Content types in the admin

Where there is more than one workspace, creating a content type or a component asks where it is **available
on**: _This workspace_ (the default) or _All workspaces_. A new type belongs to the workspace it was created in
unless _All workspaces_ is chosen; that choice needs `schema.create` on every workspace, and is otherwise shown
switched off with a hint. On a one-workspace instance the choice is not shown and new types belong to that
workspace; share them before they are needed in a second workspace.

In the sidebar, a content type shared with all workspaces has a small globe beside its name ("Shared with all
workspaces"); a workspace's own types have no mark. The Components list marks shared components the same way.

The builder's **Model settings** show where a type is available. With schema permission on every workspace,
_Share with all workspaces_ or _Keep on this workspace_ changes it, after a confirmation. An admin whose schema
role is held on one workspace only can read a shared type's structure but not change it, and the builder says
why.

**Network → Content types** lists the content types and components shared with all workspaces, with their kind,
and creates new shared ones. It is shown to admins with `schema.create` on every workspace.

### Changing the scope

Sharing a workspace's content type with all workspaces is allowed whenever the result is valid in every
workspace's view: its API ID must not be taken in another workspace, and whatever it refers to must be shared
first (share components and related types before the types that use them). Its entries stay in their workspace.

Keeping a shared content type in one workspace is refused while:

- another workspace still has entries of it (`409 SCOPE_IN_USE`, with the number of entries; admins who see
  every workspace also get the count per workspace), or
- a shared definition or another workspace's definition refers to it (`SCHEMA_INVALID`).

Delete the other workspaces' entries, or the references, first. Once kept in one workspace, the type disappears
from the other workspaces' admin, APIs, and GraphQL schema.

A workspace's own content type can also move to another workspace: `PUT /:id/scope` with `"scope": "site"` and
the other workspace's `siteId`. It is allowed only while no workspace other than the target holds entries of
it, so in practice its current workspace must have none; the same refusals and the same `schema.scope` audit
apply. The admin and `shapio schema scope` cannot do this; it is done through the API.

A scope change is metadata: the definition itself does not change, but it gets a new version (a save from a
builder opened before the change is refused as a conflict), the schema version moves, and no snapshot is taken
in any workspace. It is recorded in the audit log as `schema.scope`.

### Interfaces across workspaces

An [interface](modeling.md#interfaces) has a scope like a content type. The common case is one shared
interface, Featurable, with members that each belong to one workspace: the blog's BlogPost in the blog
workspace, the shop's Product in the shop workspace. Each workspace's view holds the interface and that
workspace's members, so `/api/content/featurables` in the blog workspace lists BlogPosts and never the shop's
products. An interface's list is always one workspace's view; there is no list across workspaces.

- A workspace's type may implement a shared interface or an interface of its own workspace.
- A shared type may implement shared interfaces only.
- An interface of one workspace may only be implemented by types of that workspace (`INVALID_INTERFACE`, naming
  both scopes).
- Sharing an interface with all workspaces is always allowed. Keeping a shared interface in one workspace is
  refused while a type in another workspace implements it.

**Adding a contract field to a shared interface.** The admin offers to add the new field to every member that
lacks it, in one change set. A change set belongs to one workspace, so the offer covers the members in the
workspace you are working in. A member in another workspace is listed with "add it in workspace B first": open
that workspace, add the field to its type, ship that change, then come back and ship the interface change.

### In the API

`/api/admin/models`, `/api/admin/components`, and `/api/admin/interfaces` answer for the request's workspace
(`Shapio-Workspace` or `?workspace=`; server 0.8.2 or later; `Shapio-Site` and `?site=` work on every version):

- `GET` lists the workspace's view; every item carries `scope` (`site` for one workspace, or `network`) and
  `siteId` (the workspace's ID, null when shared). `?scope=network` lists the shared definitions only.
- `POST` (and `POST /plan`) take an optional `scope`: `site` (the default) creates the definition in the
  request's workspace, `network` shares it with all workspaces.
- `PUT /:id/scope` with `{ "scope": "network" | "site", "version": <active version> }` changes the scope. For
  `site` the definition goes to the request's workspace, or to `siteId` when given. A stale `version` is
  `409 SCHEMA_VERSION_CONFLICT`.

```sh
curl -X PUT "$SHAPIO_URL/api/admin/models/<model id>/scope?workspace=blog" \
  -H "Authorization: Bearer $SHAPIO_TOKEN" \
  -H 'Content-Type: application/json' -d '{"scope":"network","version":4}'
```

The built-in SEO component is always shared with all workspaces; each workspace keeps its own SEO defaults
([SEO fields](seo.md)).

`GET /api/admin/auth/me` reports `siteCount` (how many workspaces the instance has) and lists `schema.create` in
`sitePermissions` when a role in the workspace grants it there; `networkPermissions` lists it only when a role
on every workspace does, which is what creating shared types needs. From the command line,
`shapio schema scope` does the same ([Schema sync](schema-sync.md#several-workspaces)).

## Creating a workspace

From the server host (direct database access, like `shapio admin create`):

```sh
npx shapio workspaces create --key marketing --name "Marketing"
npx shapio workspaces list
# default   Default workspace   (primary)
# marketing Marketing
```

Or through the admin API (`sites.manage`, which only roles held on every workspace grant):

```sh
curl -X POST "$SHAPIO_URL/api/admin/workspaces" -H "Authorization: Bearer $SHAPIO_TOKEN" \
  -H 'Content-Type: application/json' -d '{"key":"marketing","name":"Marketing"}'
```

With `@shapio/client`, the same calls are `admin.workspaces.list()`, `create()`, `update()`, `remove()`, and
`makePrimary()`.

Creating a workspace is a row in the database: no restart, no migration. The **key** (lower case, starting with
a letter: `^[a-z][a-z0-9-]{0,62}$`) is how URLs, `?workspace=`, the `Shapio-Workspace` header, and starter
config name the workspace, and it cannot change. The name can (`PATCH /api/admin/workspaces/:id` with
`expectedVersion`).

A new workspace starts empty: snapshot 0, no tokens, no webhooks, and **no anonymous access** (see
[App users](#app-users-and-anonymous-access)).

A workspace can be deleted only when it is empty: no entries, media, folders, change sets, app users, or content
types and components of its own (`409 SITE_NOT_EMPTY` lists what is left, with `definitions` counting its own
content types and components). Delete them, or share them with all workspaces, first; definitions the workspace
had already deleted go with it. Its tokens, webhooks, deployment connections, role assignments, and snapshot
history are deleted with it. The primary workspace cannot be deleted (`409 SITE_IS_PRIMARY`): make another
workspace primary first. Workspaces cannot be merged or split later.

### The primary workspace

Every instance has exactly one **primary** workspace. Requests that name no workspace go to it. At first it is
the built-in workspace, key `default`, where an upgraded instance finds all its existing content. A new install
names it in first-run setup ("Default workspace" unless you type another name); the key stays `default`. An
install set up with `shapio admin create`, or with a setup API call that sends no name, keeps the name "Default
site" until you rename it.

You can make another workspace primary, from the workspace's page in the admin (**Make primary**), the admin API
(`sites.manage`), or the server host:

```sh
npx shapio workspaces make-primary --key marketing
# Workspace marketing is now the primary workspace.
```

```sh
curl -X POST "$SHAPIO_URL/api/admin/workspaces/<workspace id>/make-primary" \
  -H "Authorization: Bearer $SHAPIO_TOKEN"
```

The switch is live, with no restart, and takes effect from the next request:

- **Requests that name no workspace** read the new primary workspace: anonymous delivery without
  `?workspace=`, network admin tokens without `Shapio-Workspace`, the admin at a URL without a workspace (for a
  browser that has no last workspace remembered), extension services given to routes, jobs, and factories, and
  starters and CLI commands that ask the instance which workspace is primary. Requests that name a workspace,
  and credentials that belong to one, are not affected.
- **Tokens, webhooks, deployment connections, and app role bindings stay with their own workspace.** Every
  delivery token from before workspaces belongs to `default`, so a frontend reading with such a token keeps
  reading `default` after a switch, and stops working if `default` is deleted (its tokens are deleted with it).
  Create tokens in the new workspace first.
- **A new workspace binds no `public` role** (see [App users](#app-users-and-anonymous-access)), so anonymous
  delivery that names no workspace returns nothing after a switch to it until you bind app roles there.
- **CDN caches**: a CDN that keys on the URL alone and caches responses for requests that name no workspace
  keeps serving the old primary's responses until they expire. Purge it after a switch.

The former primary is then an ordinary workspace: it can be deleted once it is empty. Making the workspace that
is already primary primary again changes nothing.

## Which workspace a request reads

Every request about content is about exactly one workspace, chosen in this order:

1. **The credential's workspace.** Delivery tokens, workspace admin tokens, app-user tokens, and preview tokens
   belong to one workspace and only ever act on it.
2. **The workspace the request names**, with `?workspace=<key>` or the `Shapio-Workspace: <key>` header (server
   0.8.2 or later; `?site=` and `Shapio-Site` work on every version). Anonymous callers, admins in the browser,
   and network admin tokens pick a workspace this way.
3. **The primary workspace**, when none of these names one.

Naming a different workspace than the credential's is refused with `403 SITE_MISMATCH`, never redirected, and
so is a request whose header and query parameter disagree, or that sends both spellings of either with
different keys. A repeated `?workspace=` or `?site=` is `400`. An unknown key is `404 SITE_NOT_FOUND`. Another
workspace's entries, assets, change sets, and tokens read as not found.

| Client                              | How to name the workspace                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| REST delivery and snapshot routes   | `?workspace=<key>` or `Shapio-Workspace` ([Delivery API](delivery-api.md#workspaces)) |
| GraphQL                             | `Shapio-Workspace`, or `?workspace=` on GET ([GraphQL](graphql.md#authentication))    |
| `@shapio/client`                    | `createClient({ …, workspace: 'marketing' })`                                         |
| `shapio export` / `shapio import`   | `--workspace <key>` or `SHAPIO_WORKSPACE`                                             |
| `shapio schema …` and the importers | `--workspace <key>` or `SHAPIO_WORKSPACE` ([Schema sync](schema-sync.md))             |
| `@shapio/mcp` / `shapio mcp`        | `--workspace <key>` or `SHAPIO_WORKSPACE` ([MCP server](mcp.md))                      |
| Starters                            | the workspace key in the starter's config ([Starters](starters.md))                   |

The CLI and the MCP server refuse to start when `--workspace` and `--site`, or `SHAPIO_WORKSPACE` and
`SHAPIO_SITE`, are both set to different keys.

With a delivery token you never need to name the workspace: the token's workspace is the only one it reads.
Naming it anyway is harmless when it matches, and catches a token pasted into the wrong workspace's config.

`@shapio/client` puts the workspace in the query string on delivery and snapshot `GET`s (a simple cross-origin
`GET` needs no CORS preflight, and URL-keyed caches keep workspaces apart) and in a header everywhere else. In
0.8.2 the client still sends the older `?site=` and `Shapio-Site` on the wire, so a newer client works against
an older server.

### Caches and CDNs

Cacheable delivery responses (REST and GraphQL `GET`s) send
`Vary: Authorization, Cookie, Shapio-Workspace, Shapio-Site`. A CDN that keys its cache on the URL alone and
ignores `Vary` must be given the workspace in the query string, never only as a header, or two workspaces could
share a cached response. Pick one spelling (`?workspace=` or `?site=`) per front end so each URL is cached once.

### Snapshots

Each workspace numbers its own snapshots: snapshot 12 of one workspace says nothing about another.
`?snapshot=N`, `/api/snapshots/*`, and GraphQL's `_snapshot` and `_changes` answer for the request's workspace
([Snapshots and the changes API](snapshots.md)). Publishing in one workspace never moves another workspace's
number, so builds pinned on other workspaces are unaffected.

A schema change that converts stored values takes one snapshot in every workspace whose published content it
changes, and none in the others. A change to a workspace's own content type can only change that workspace's
content, so it numbers that workspace alone; a change to a shared one can number several. The change set's own
workspace records it as the change set; the other workspaces record a **conversion** that names the change set
and its workspace. Changing a content type's scope takes no snapshot.

### Media files

Media file URLs (`/api/media/f/<key>`) are the same for every workspace and need no workspace: public files are
public, and a private file's signed URL is its own access control. Signed URLs are only issued by reads in the
asset's own workspace.

## Permissions and assignments

Roles are shared by every workspace; an **assignment** says where a role applies: in one workspace, or on **all
workspaces**. Someone can be Editor in the marketing workspace, Read-only in the docs workspace, and nothing in
the rest.

| Assigned on    | Gives                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------- |
| one workspace  | the role's content permissions and **workspace permissions** in that workspace                 |
| all workspaces | the role's permissions in every workspace, current and future, and its **network permissions** |

- **Network permissions** are about the whole instance: `schema.create`, `users.manage`, `roles.manage`,
  `audit.read`, `sites.manage` (manage workspaces), and `schemaManage` on models. Only roles held on all
  workspaces grant them, so a workspace admin cannot change shared content types, locales, invite people, or
  give themselves another workspace. The one exception is the workspace's own schema: a role held in a workspace
  grants `schema.create` and `schemaManage` there for that workspace's own content types and components
  ([Who can change them](#who-can-change-them)).
- **Workspace permissions** are about one workspace: `tokens.manage`, `media.*`, `publishing.manage`,
  `webhooks.manage`, `deployments.*`, `changes.manage`, `changes.ship`, `changes.approve`, and `site.settings`
  (workspace settings).
- **Approval workflows** follow the same split: the default every workspace inherits is a network setting
  (`sites.manage`, Network → Approval), and each workspace chooses to inherit it, switch approval off, or keep
  its own workflow (`site.settings`, Settings → Change sets). A stage's roles count when held in that workspace
  or on every workspace ([Approval](change-sets.md#approval)).
- The **Owner** role can only be held on all workspaces.
- An admin who holds no role in a workspace gets `403 SITE_FORBIDDEN` there. `GET /api/admin/auth/me` still
  answers in every workspace, with `site` (the current workspace), `sites` (where they work), `siteCount`,
  `networkPermissions`, `sitePermissions`, and the model permissions of that workspace, which is what the
  admin's workspace switcher uses.

The users and invitations APIs take assignments:

```json
{ "assignments": [{ "roleId": "<editor role id>", "siteId": "<marketing workspace id>" }] }
```

`"siteId": null` means all workspaces. The older `roleIds` list is still accepted and means "these roles on all
workspaces".

## App users and anonymous access

App users (the end users of your websites and apps, see [End users](end-users.md)) belong to one workspace. The
same email address can have separate accounts in two workspaces, each with its own password; signing up, signing
in, and OAuth all happen in the request's workspace. An app user's access token names its workspace and is
refused in any other (`403 SITE_MISMATCH`), and so are its refresh token, its confirmation and reset links, and
an OAuth login code used in another workspace.

Which app roles apply is set per workspace. App roles and their grants are shared, but which ones **every
caller** (`public`, anonymous or signed in) and **every signed-in app user** (`authenticated`, on top of
`public`) hold is bound in each workspace:

```sh
curl -X PUT "$SHAPIO_URL/api/admin/workspaces/<workspace id>/app-roles" -H "Authorization: Bearer $SHAPIO_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"public":["<public role id>"],"authenticated":["<authenticated role id>"]}'
```

The primary workspace binds the built-in `public` and `authenticated` roles. **A new workspace binds nothing**,
so it serves nothing anonymously and gives signed-in app users only their own custom roles until you bind roles
there. Changing bindings needs `roles.manage`.

The per-email rate limits on sign-up, password reset, and confirmation mail count an address across all
workspaces together. App-user emails use the instance's sender for every workspace.

## API tokens

- **Delivery tokens** always belong to the workspace they were created in.
- **Workspace admin tokens** act on their workspace only, and never get network permissions.
- **Network admin tokens** carry their role in every workspace and to network actions, and pick a workspace per
  request with `?workspace=` or `Shapio-Workspace`. Create one with `"network": true`; only admins with
  `users.manage` (held on all workspaces) can. Without it, every token belongs to the workspace it was created
  in.

Settings → API tokens lists and revokes the current workspace's tokens, plus network tokens for admins with
`users.manage`, with each token's workspace (or _Every workspace_) under its role. Creating an admin token there
asks where it **works on**: _This workspace_ (the default) or _Every workspace (network token)_, a choice shown
only to admins with `users.manage`.

## Webhooks and deployments

- A **workspace webhook** receives its workspace's events and network events (locale changes and changes to
  shared content types, which concern every workspace; a change to a workspace's own content type is that
  workspace's event only). A **network webhook** receives every workspace's events. Create one with
  `"network": true`, which needs `webhooks.manage` on all workspaces; that choice is fixed once created. Every
  delivery body has a `site` field naming the workspace (`{ "id", "key" }`, or `null` for a network event). See
  [Webhooks](publishing.md#webhooks).
- **Deployment connections** belong to a workspace. A workspace's publishes and change sets build its own
  connections; a change to a shared content type builds every workspace's connections that build on schema
  changes, a change to a workspace's own content type only that workspace's.

## Preview

A preview token previews one entry of one workspace, and the preview API answers only for that workspace
([Preview](publishing.md#preview)). The preview URL template comes from a connection of the entry's workspace.

## Change sets, field usage and content health

- A change set belongs to one workspace and ships as one snapshot there. It can only hold that workspace's
  entries and schema drafts of definitions in that workspace's view. A draft of the workspace's own content type
  needs schema permission in the workspace; a draft of a shared one (or a new definition created shared) needs
  it on all workspaces, and the review marks it "Shared, affects every workspace" and lists the affected entries
  per workspace ([Change sets](change-sets.md)).
- Field usage is counted per workspace. Before a breaking change, the review shows the readers of the affected
  fields. A workspace's own content type is only read in that workspace, so its readers are that workspace's. A
  shared one is read in every workspace: with permissions on all workspaces you see each reader and its
  workspace, otherwise your workspace's readers and the other workspaces as totals.
- Content health checks every workspace in one sweep; each workspace sees its own findings.

## Export and import

A bundle holds one workspace's content, media, app users, webhooks, and deployment connections, plus its view of
the schema (the workspace's own content types and the shared ones, each marked with its scope), locales, and
roles:

```sh
npx @shapio/cms export --url https://cms.example.com --token shp_… --workspace marketing marketing.ndjson
npx @shapio/cms import --url https://cms.example.com --token shp_… --workspace docs marketing.ndjson
```

Without `--workspace` (or `SHAPIO_WORKSPACE`) the token's workspace is used, else the primary workspace. On
import, the exported workspace's own content types are created in the target workspace and shared ones are
shared on the target instance, which needs schema permission on every workspace (refused definitions are listed
before anything is written). Bundles from before per-workspace schemas mark nothing, and their content types
import as shared. See [Backup and restore](backup-restore.md#content-export-and-import).

## Agents (MCP)

Set `SHAPIO_WORKSPACE` or pass `--workspace <key>` to `@shapio/mcp` (`shapio mcp --workspace <key>` prints the
configuration); otherwise the agent works on its token's workspace, else the primary workspace. See
[MCP server](mcp.md).

## Extensions

Custom routes are workspace routes: `request.site` is the request's workspace (`{ id, key }`). Hooks receive
`site` (the entry's workspace), and the `services` they get read that workspace. Services given to routes, jobs,
and service factories read the primary workspace, and follow it when another workspace is made primary (each
call reads which workspace is primary now); use `services.forSite(request.site)` for another. The extension API
keeps these `site` names. See [Extensions](extensions.md).

## In the admin

The admin's URLs carry the workspace: `/admin/s/<key>/…`. A URL without a workspace opens the last workspace used
in that browser, else the primary workspace. Pages about the whole instance live under `/admin/network/…`, and
the old `/admin/users`, `/admin/settings/roles`, and `/admin/settings/audit-log` addresses redirect there.

**The workspace switcher** sits in the sidebar header, under the wordmark. It shows the current workspace's name
and key, the other workspaces you work in and, if you hold any of `sites.manage`, `users.manage`,
`roles.manage`, `audit.read`, or `schema.create`, **Network**. Picking another workspace opens its Inbox with a
full page load, so nothing from one workspace's screens carries over to another. The ⌘K palette offers the
network pages from any workspace.

**Network** pages:

- **Workspaces** (`/admin/network/workspaces`; the older `/admin/network/sites` addresses redirect there): every
  workspace, and **New workspace** (a name and a key, which is fixed once created). Any admin with a network
  permission can look; creating a workspace needs `sites.manage`. A workspace's page renames it (a stale edit is
  refused with a conflict), sets its **App roles** (checkbox groups for _Public_ and _Authenticated_; needs
  `roles.manage`), shows whether it is the **Primary workspace** (with **Make primary** on any other workspace;
  needs `sites.manage`), and deletes it. **Delete workspace** shows the server's reason when the workspace is
  not empty; the primary workspace has no delete button until another workspace is made primary.
- **Users**: people, their access, and invitations. A badge per assignment reads _Editor · Blog_ or
  _Editor · All workspaces_. **Change access** edits the rows (a workspace or _All workspaces_, and a role;
  **Add a workspace**, remove a row); Owner can only be given on _All workspaces_. On a single-workspace instance
  this is just the role. Pending invitations show their assignments, with copy-link and revoke.
- **Roles** (admin and app roles) and the **Audit log**.

In a workspace, the sidebar's **Workspace** group has **App users** (that workspace's end users; needs
`users.manage`), **Locales**, and **Settings**. Settings no longer lists Roles or the Audit log.

- **Webhooks**: admins with any network permission choose whether a new webhook **receives events from** this
  workspace or every workspace; network webhooks show an _Every workspace_ badge in the list and on their page.
- **No role in a workspace**: an admin who opens a workspace they hold no role in sees only the workspace
  switcher and a button to open their first workspace.
- The API explorer and the Snapshots page's pinning snippet add `?workspace=<key>` when you are in a workspace
  other than the primary one.

## Upgrading to workspaces

Workspaces arrived under the name "sites". The upgrade that introduced them migrates on start, as usual, and
moves everything to the primary workspace. Single-workspace instances behave as before, with three visible effects:

- **App users' access tokens** issued before the upgrade are rejected (`401 INVALID_TOKEN`), because they do not
  name a workspace. Apps that refresh on `401` recover by themselves; refresh tokens keep working.
- **Model-wide preview tokens** are deleted; preview tokens now always name an entry. Open Preview again.
- **Field indexes** are rebuilt in the background by the `schema.fieldIndexLayout` job, with the workspace
  leading. The old indexes serve queries until their replacements are ready. Instances without field indexes
  skip it.

Existing admin API tokens become network tokens and existing delivery tokens belong to the primary workspace, so
both keep working. Role assignments become "all workspaces". Rolling the migration back is only possible while
one workspace exists.

The later upgrade to per-workspace content types makes every existing content type and component shared with
all workspaces, so nothing changes for existing workspaces. Content types created afterwards belong to their
workspace unless shared (see [Content types per workspace](#content-types-per-workspace)). Its migration can be
rolled back only while no content type or component belongs to a workspace.

The 0.8.2 rename from sites to workspaces changes no data, no stored rows, and nothing a caller sends. An
upgraded instance keeps its workspace names, including a built-in workspace still called "Default site".

Not yet available: choosing the workspace from the request's host name, and a media library shared by several
workspaces.

## Names you may still see

Workspaces were called sites before 0.8.2. The older spellings below name the workspace and keep working on
every version; nothing was removed, and nothing you have needs changing. The `site*` fields and the `site` scope
value name the workspace.

| Where                | Older spelling, still accepted                                                                           | Newer spelling (0.8.2 or later)                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Request header       | `Shapio-Site`                                                                                            | `Shapio-Workspace`                                                                                     |
| Query parameter      | `?site=`                                                                                                 | `?workspace=`                                                                                          |
| Admin API paths      | `/api/admin/sites`, `/:id`, `/:id/make-primary`, `/:id/app-roles`, `/api/admin/site/seo`, `/change-sets` | `/api/admin/workspaces/…`, `/api/admin/workspace/seo`, `/change-sets`                                  |
| Delivery path        | `GET /api/site`                                                                                          | `GET /api/workspace`                                                                                   |
| CLI                  | `shapio sites list \| create \| make-primary`, `--site <key>`                                            | `shapio workspaces …`, `--workspace <key>`                                                             |
| Environment variable | `SHAPIO_SITE`                                                                                            | `SHAPIO_WORKSPACE` (read first)                                                                        |
| `@shapio/client`     | `createClient({ site })`, `client.site.get()`, `admin.sites.*`, `admin.site.changeSets`, type `Site`     | `workspace`, `client.workspace.get()`, `admin.workspaces.*`, `admin.workspace.changeSets`, `Workspace` |
| `@shapio/local`      | `site` option                                                                                            | `workspace` option                                                                                     |

These stay as they are, with no newer spelling, because programs and stored data match on them:

- **JSON fields and values** in requests and responses: `siteId`, `site`, `sites`, `siteKey`, `siteCount`,
  `sitePermissions`, and the scope value `site` (one workspace; `network` is shared).
- **Error codes**: `SITE_NOT_FOUND`, `SITE_MISMATCH`, `SITE_FORBIDDEN`, `SITE_KEY_TAKEN`, `SITE_IS_PRIMARY`,
  `SITE_NOT_EMPTY`, `SITE_REQUIRED`, `LOCK_SITE_MISMATCH`, `INVALID_TOKEN_SITE`, `INVALID_SITES`, and
  `OWNER_ALL_SITES`. Their messages say workspace.
- **Permission keys** `sites.manage` (Manage workspaces) and `site.settings` (Workspace settings), and **audit
  actions** `site.*`.
- **The webhook event** `site.updated` and the `site` field in delivery bodies.
- **GraphQL** `_site`, `SiteInfo`, `SiteSeoDefaults`, and `SiteSeoLocale`: `_site.key` and `_site.name` are the
  workspace's; its `seo` block (with `siteName`) is the website's.
- **The `site` claim** in app users' access tokens.
- **Schema files**: the folder `sites/<key>/`, the lock file's `sites` and `definitions[].site`, and `site` in an
  importer's `import-map.json`.
- **The extension API**: `request.site`, `services.site`, `services.forSite()`, the hook context's `site`, and
  the `site` route config.
- **Next.js cache tags** `shapio:site:<key>`, and `shapioTags.site(key)` (the same as `shapioTags.workspace(key)`).

In 0.8.2, `@shapio/client`, the CLI, and the MCP server still send `Shapio-Site`, `?site=`, and the `sites` paths
on the wire, so a newer package works against an older server.

`create-shapio --site <astro|next|sveltekit>` is different: it picks a website starter, and "site" there means a
website.
