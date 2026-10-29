# Changelog

All notable changes to Shapio are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Approval workflows on change sets. A site's change sets go through an ordered list of stages before they ship;
  each stage names the roles that may sign off (or anyone who may approve) and how many sign-offs it needs, and
  the workflow says whether people may approve their own change sets. Asking for approval freezes the workflow
  on the set, so editing a workflow never changes a review in flight; a stage completes when enough different
  people sign off, and the set is approved after the last stage. Requesting changes at any stage ends the round.
- Network → Approval sets the default workflow every site inherits (off until set; needs `sites.manage`). Turning
  it off keeps the workflow for when it is turned back on.
  Settings → Change sets lets a site use the network default, switch approval off, or keep a workflow of its own
  (needs `site.settings`). A site with a workflow refuses to ship or schedule a set that is not approved
  (`CHANGE_SET_NOT_APPROVED`).
- A review is pinned to what the set holds. An edit to an item, an entry draft it publishes, or a schema draft
  after the first sign-off of a round, or after approval, marks it "Approval outdated": nobody can sign, and a
  site with a workflow refuses the ship (`CHANGE_SET_APPROVAL_STALE`) until approval is asked for again, which
  starts a new round. A scheduled set whose draft moved after approval fails at its time with the reason, and
  nothing of it goes live. Shipping a set that is still in review ends the review.
- A new permission, `changes.approve`. Upgrading gives it to every role that holds `changes.ship`, and the
  built-in editor role has it. A role an approval workflow names cannot be deleted (`ROLE_IN_USE`), and a stage
  whose roles were all deleted during a review cannot be signed by anyone until the approval is cleared and asked
  for again.
- The change set page shows the frozen workflow as a stage strip, every sign-off, and why you cannot sign when
  you cannot. The Changes list shows the stage a set is at; the Inbox lists only the sets you can sign off now.
  Every step shows on the set's timeline and sends a webhook event (`change_set.approval_requested`,
  `change_set.approval_stage_completed`, `change_set.approved`, and `change_set.changes_requested`).
- The API: `POST /api/admin/change-sets/:id/approval/request`, `…/approve`, `…/request-changes`, and `…/clear`;
  `GET` and `PUT /api/admin/site/change-sets` and `/api/admin/network/approval`; every change set carries
  `approval` with its round, stage, eligibility, and sign-offs; `?approval=` filters the list and
  `?awaitingMe=true` keeps the sets you can sign now. `@shapio/client` has the same calls. The MCP server offers
  `change_sets_request_approval`, and, with `--allow-ship` only (approving is what lets a set go live),
  `change_sets_approve` and `change_sets_request_changes`.
- `shapio import` says so when the site requires approval before the change sets it opened can ship.
- Rich text has three new marks: underline, subscript, and superscript. The editor's toolbar and the floating
  toolbar have a button for each (Mod+U, Mod+comma, Mod+period; the minimal toolbar shows Underline only),
  delivery HTML renders them as `<u>`, `<sub>`, and `<sup>`, and pasted and imported HTML keeps them (tags
  and the equivalent inline styles). Subscript and superscript replace each other. The stored format stays
  version 1: existing documents are unchanged.
- The Strapi importer keeps underline from Blocks fields.

### Changed

- Making a field required, or adding a required field, now goes live even when entries have no value for it.
  A `defaultValue` still fills them; otherwise those entries stay as they are, are listed in the Inbox under
  Required fields left empty, and can't be published again until the value is filled in. The review says how
  many before you ship, and the builder, the change set page and `shapio schema apply` say how many after.
  Before, such a change failed with "N entry version(s) have no value for the required field". An entry left
  without a value no longer fails a later, unrelated schema change, and importing a bundle accepts published
  versions without it.

- Backspace at the start of a list item joins it to the item above as its next paragraph, so an item can hold
  several paragraphs and the list keeps numbering straight through. It used to take the item out of the list
  and restart the numbering of the items after it. The list buttons' tooltips and the `+` menu's list entries
  say so.

### Fixed

- On a phone, a page header with many actions wraps them instead of widening the page.

## [0.6.4] - 2026-10-23

### Changed

- In the type builder's field list, a relation says what it points at ("→ Page and 3 kinds", "→ Linkable
  (interface)", "→ Any entry"), and component and dynamic zone fields name their components.
- A relation's Target list shows each kind indented under its type instead of as a separate type.
- The collapsed type settings say which interfaces the type implements, and which type it gets them from.
- Develop → Interfaces and an interface's Members panel explain the three steps to set one up, with a link to
  the guide.

### Fixed

- Changing a field on a component that no type uses yet works on PostgreSQL and MySQL; before, the change failed
  with a SQL error.

- Opening a type, component, or interface in the builder always shows it as it is now. Before, a definition
  changed through the schema API or in another tab still showed its old settings when you came back to it
  without reloading the page, for example a relation moved to an interface showed its old target and an
  empty help text, and the builder said it had changed in another session.
- The builder's notice that a definition changed in another session says whether it was a type, a component,
  or an interface, instead of always saying "model".

## [0.6.3] - 2026-10-22

### Fixed

- The media library and picker filter by kind (`kind=image`) instead of a mime pattern, so a web application
  firewall no longer mistakes the request for SQL injection.
- The media picker uses the server's rules for which files are documents, so RTF and EPUB files can be chosen
  for a media field that allows documents.
- Keyboard shortcut hints show the real key (⌘ on Mac, Ctrl elsewhere) instead of Mod.
- Choosing a heading from the toolbar keeps the cursor in the text.
- Inserting an image from the toolbar keeps the cursor in the text.
- A 403 from a firewall or proxy in front of Shapio is reported as a blocked request, not as a missing
  permission.

## [0.6.2] - 2026-10-22

### Fixed

- Applying a type and a kind that extends it in one schema apply works regardless of file order; before, the
  kind could activate before its parent and fail with UNKNOWN_PARENT. One apply now goes live as one unit: when
  any of its changes waits for index builds, the others wait and activate with it, so an interface and its
  members, or a type and its relation target, also change together.

## [0.6.1] - 2026-10-22

### Fixed

- The rich text toolbar stays at the top of the screen while you scroll a long document.
- Alt text and captions on images are edited in a box that grows with the text.

## [0.6.0] - 2026-10-21

### Added

- **Interfaces.** Unrelated types that play one role (a blog post, a roadmap item, and the About page that can
  all be featured) can implement an interface: a set of fields they must all have, matched by API ID. An
  interface stores nothing. Create one under Develop → Interfaces and pick it under Implements in a type's
  builder, or use `interfaces/` and `implements` in schema files. A kind implements what its parent implements,
  and single types can be members. While a type implements an interface, a change that would break its fields
  is refused with the interface named; adding a field to an interface offers to add it to every member in the
  same change set. See [Modeling](documentation/modeling.md#interfaces).
- `GET /api/content/<interface plural>` lists every member's entries in one page, each in its own shape with
  `__model`, filterable and sortable on the interface's fields, searchable on its title field, with the
  readable member types in `meta.members`. In GraphQL an interface is a GraphQL interface with its own list and
  single queries.
- A relation field can target an interface (an entry of any member) or any entry (`*` in schema files, Any
  entry in the admin). Populated, each target comes in its own shape. Widening a relation's target keeps its
  values. Removing an interface from a type, or deleting a type, while a relation to the interface holds its
  entries is refused with the count.
- Webhook entry events carry `interfaces`, the plural API IDs of the interfaces the entry's type implements,
  and `shapioTags.changed(routeKey, id, interfaces)` in `@shapio/client` adds their cache tags. The CLI, the
  MCP server, and the generated TypeScript and OpenAPI output know interfaces too.

### Changed

- `interfaces` is now a reserved API ID, like `new` and `components`: the admin serves interfaces at
  `/develop/interfaces`. A content type or component whose API ID is `interfaces` keeps working, but a
  change to it is refused until it is renamed.
- GraphQL: every schema now has an interface `Entry` with the system fields, which every entry type
  implements; a relation to any entry returns it. This is additive. The type mutations return, which was
  called `Entry`, is now `EntryState` with the same fields: queries that select its fields keep working, but a
  fragment on it (`fragment state on Entry { version status }`) must name `EntryState`. `EntryState` is a
  reserved type name, next to `Entry` and `Node`.
- `AnyEntry`, `InterfaceMember`, `Kind`, `Pagination`, and `Error` are now reserved generated type names,
  compared ignoring case: a model whose API ID is `anyEntry`, `interfaceMember`, `kind`, `pagination`, or
  `error` is refused with `API_KEY_RESERVED`. A field called `kind` is unaffected. Such a model already broke
  the generated OpenAPI document; the refusal makes the failure explicit. Rename it before upgrading.
- On SQLite, the upgrade rebuilds the `models` and `schema_drafts` tables to accept the new kind, and
  migrations now run with foreign keys off, checking every reference afterwards. Back up the database file
  first, as before any upgrade.

## [0.5.17] - 2026-10-21

### Changed

- The admin's Publishing area is now called Deployments, with Connections, Scheduled, and Webhooks tabs. It
  opens on Connections. URLs and permission names are unchanged.

### Fixed

- Editors can deploy. They had permission to trigger deploys, but the Deployments page needed the full
  connection list, which only managers can read, so Editors saw no connections and no Deploy now button.
  People who may trigger deploys now get each connection's name, status, and runs, with no settings, secrets,
  or URLs.

## [0.5.16] - 2026-10-21

### Fixed

- Typing in the middle of an image's alt text (or its caption on the canvas) moved the cursor to the end
  after the first character. The cursor now stays where you type.

## [0.5.15] - 2026-10-18

### Added

- The status bar shows the running Shapio version, linked to the changelog, with the Node version on hover.

### Fixed

- After saving or publishing an entry, reopening it from a list or the palette showed the old values until a
  page reload, and the next edit could fail with a conflict, so the preview kept showing the last saved
  version. Saves now mark every cached copy of the entry stale, and change-set ships and translation runs
  refresh content too.
- Preview of a type that extends another (for example Article under Page) returned 404: its preview link
  used the type's own route instead of the family's nested one.
- Snapshots → Timeline failed on sites with a type that extends another.

## [0.5.14] - 2026-10-18

### Fixed

- Editing a deployment connection sends only the fields you changed. Before, every save sent the build hook
  URL again, so a firewall in front of Shapio (such as AWS WAF's metadata rule) could refuse even a trigger
  change when the hook URL is on the same machine.

## [0.5.13] - 2026-10-18

### Fixed

- API tokens: the Status column shows when a token expires, warns in its last 14 days ("Expires in 5 days"),
  and says "Expired" once it has passed. Before, an expired token still showed "Active".
- API tokens: revoked tokens are no longer listed, and the table fits a laptop screen with Revoke visible.
  Before, the expiry date and the Revoke button were cut off on the right.

## [0.5.12] - 2026-10-17

### Fixed

- Needs you: a link to an unpublished entry names that entry, when you can read it, so two links from the same
  field no longer look like the same row.
- Needs you: each row opens the entry at the field it names, with the linked entry highlighted. Before, the
  links never scrolled to the field.
- Needs you: each group pages on its own ("Show all", then "Load more" inside the group). The panel-wide
  "Load more" is gone, and a group whose findings are all older than the newest page now shows up.

## [0.5.11] - 2026-10-17

### Added

- On a type that extends another, the builder's Layout setting offers "Same as <parent>", so the type follows
  its parent's layout again, including later changes.

### Fixed

- Needs you showed "Untitled" for entries whose title field is inherited from a parent type.
- Switching a type that extends a Form type to Document did nothing and failed with "Add at least one entry or
  schema change to the change set first", from the entry's settings and from the builder.
- The snapshot timeline missed titles inherited from a parent type.
- Removing a language now releases published unique values that a type inherits from its parent.

## [0.5.10] - 2026-10-14

### Changed

- The `cancelled` status of schema changes and scheduled publications is now `canceled`. A migration rewrites
  existing rows. Scripts that check for `cancelled` should check for `canceled`.

## [0.5.9] - 2026-10-13

### Added

- **Types that extend a type.** A collection can now extend another: Products holds the shared fields (name,
  price, images), and Digital and Physical add their own. Pick the parent under **Extends** when you create a
  type, or set `extends` in its schema file. A kind inherits every field of its parent, locked, and a field you
  add to the parent is on every kind at once, live. Kinds can have kinds, up to 8 levels. A kind has its
  parent's Localized and Draft & publish settings and lives where its parent does (shared, or on one site).
  See [Modeling](documentation/modeling.md#types-that-extend-a-type).
- **Nested routes and mixed lists.** A kind is read under its parent: `/api/content/products` lists every
  product, of every kind, filtered and sorted on the shared fields, and paged together, each row in its own
  shape; `/api/content/posts/guides` lists one kind. A relation to Products accepts any kind, and
  `populate` returns each in its own shape. `@shapio/client` sends nested route keys as nested paths.
- **GraphQL interfaces.** A type with kinds gets `ProductInterface`, which it and every kind implement.
  `products`, `product(id)`, and relations to Products return the interface; ask for a kind's own fields with a
  fragment (`... on Guide`). A type without kinds keeps exactly the schema it had.
- **Grants flow down.** A grant on a parent covers its kinds. A kind can get grants of its own, which only
  add access. The roles matrix shows kinds under their parent, with the inherited grant beside their own.
- **Change kind.** An entry can move to another kind in its family from the Settings panel's danger zone
  (`POST /api/admin/content/<API ID>/<id>/kind`). Shapio lists the fields the new kind lacks and drops their
  values once you confirm; history keeps them, and older snapshots keep serving the entry under its old kind.
  Webhooks receive the new `entry.kind_changed` event.
- Entry webhook payloads carry `routeKey` (nested for a kind) and `ancestors` (the API IDs of the types the
  entry's type extends). `shapioTags.changed(routeKey, id)` in `@shapio/client` gives the Next.js cache tags of
  a route key and every ancestor prefix, so a changed Guide refreshes the Posts list too.
- `shapio schema diff` and `apply` name parents (`model guide (extends post)`, `~ extends: article → post`)
  and explain each new refusal. Moving a type under another parent needs `--allow-breaking`.
- The MCP server lists inherited fields and each type's parent, and drafts accept `extends` as an API ID.
- Extensions: `content.models()` now returns each type's `routeKey` and its fields, inherited ones first with
  `inheritedFrom`, and hooks' `model` carries `extends` (the parent's API ID). A hook keyed by a type also runs
  for every type that extends it.

### Changed

- **Every delivery entry carries `__model` and `__kinds`**: the singular API ID of its own type, and that
  type's lineage, root first (`["product", "physical", "apparel"]`), in lists, single reads and populated
  relations, so a site can tell the kinds in a mixed list apart at any level. A list of a type with kinds also
  has `meta.kinds`, the kinds you may read as a flat tree with labels, parents and route keys. It is all
  additive: neither key is a field, `fields=` and `sort` can't name them, writes refuse them, and a type
  without kinds has no `meta.kinds`.

## [0.5.8] - 2026-10-12

### Fixed

- **The entry top bar fits on one row again with the settings drawer open.** At laptop width the actions
  dropped under the save state once the drawer had slid in. While the drawer is open, Settings now shows its
  icon only, and a change saved elsewhere reads "Changed elsewhere" with an icon-only Reload, so the place
  name, the save state, and the actions share one row.

## [0.5.7] - 2026-10-12

### Changed

- The example site walkthrough and the starter READMEs no longer send people to the monorepo and pnpm; everything
  runs from a `create-shapio` project with npm.

### Fixed

- **The model builder no longer stays on the old version after a quick change.** When a change's checks or
  conversions finished before the builder looked them up, it never reloaded: no "Model updated", the old
  version under the title, and a "changed in another session" banner for your own change. It now follows the
  change in any state, so a finished one reloads the new version at once.
- **API tokens no longer outlive their admin.** While an admin is disabled, the API tokens they created (and
  tokens made with those tokens) are refused, and deleting the admin revokes them, with the token names and
  the creator kept in the audit log. Network → Users names those tokens before you disable or remove someone,
  and Settings → API tokens shows a paused token as "Paused: creator disabled".
- **Changing a multi-value enum's type drops its values instead of hiding them.** Changing an enum with
  `multiple: true` to short text, long text, or code was treated as a change that keeps the stored values, so it
  went live with no review while every read returned `null`; to rich text it promised a conversion that then
  failed. It is now a destructive change that counts the entries losing their value, needs your
  acknowledgement, and shows "(values dropped)" in `shapio schema diff`. Text changed to a multi-value enum
  becomes a one-value list, checked against the choices.
- **An ended admin session no longer throws away unsaved edits.** When the session expires or is signed out
  elsewhere while you have unsaved changes, the admin stays on the page and asks for your password in a panel
  beside it; the save that failed runs again once you sign in. Signing out from the account menu over unsaved
  changes now asks first, like leaving the page.
- **Signing in from several places at once works on MySQL.** Parallel correct sign-ins of one admin could
  deadlock in InnoDB and answer 500; the sign-in now updates the admin before it creates the session.
- **Inbox "Recently published" keeps the latest publishes.** It used to look at the last five snapshots only,
  so a few schema changes, or publishes in types you can't read, emptied it and it said "Nothing published
  yet". It now lists the latest entries you may read that went live. `GET /api/snapshots/changes` takes
  `recent=N` in place of `from` for this.
- **Deleting a media file shows only "Deleted".** The open file sheet read the file again after the delete,
  and the 404 added a red "This no longer exists" toast beside the success one. A file that's gone no longer
  raises a toast; the screens that show files already say when one is missing.
- **Media "Used in" names entries by title.** Each entry version using a file now shows the entry's title and
  type and links to it in that locale, instead of a raw entry ID. Entries in types you can't read say so,
  without a link. `GET /api/admin/media/assets/:id/usage` returns each entry's `title`.
- **The GraphQL playground passes accessibility checks.** GraphiQL's query, variables, headers, and response
  editors now have names for screen readers, its colors reach WCAG AA contrast in both themes, and links in
  its docs are underlined.
- **Asking for a hidden field in `fields=` says so.** The 403 `FORBIDDEN_FIELD` now reads "You may not read the
  field …" instead of "You may not filter, sort or search on …", which the request never did.
- **An open entry now learns that another tab saved it.** With no edits of its own, the tab says who changed
  the draft and when, in place of "Saved", with a Reload button; with unsaved edits, it shows the "Someone else
  saved this entry" banner, which keeps them. The presence heartbeat now carries every locale's draft version.
- **A partly typed date or time no longer clears the saved value.** While a date, time, or date-time is
  incomplete, the field says "Enter a complete date." (or time, or date and time), stays an unsaved change, and
  Save, Create, and Publish refuse until it is complete or cleared. Leaving the page asks first.
- `shapio` and `create-shapio` now say plainly that Node.js 24 or newer is needed instead of failing with
  `No such built-in module: node:sqlite` on older Node.
- **Number and JSON fields no longer drop text that doesn't parse.** Text such as `3.7` in an integer field or
  half-typed JSON now stays in the field with its error, counts as an unsaved change, and blocks Save, Create,
  and Publish; autosave saves the other changes and holds that field back until it is fixed.
- **Public off on a component's field now hides it from delivery.** REST, GraphQL, in-process delivery, and
  previews returned a component's `public: false` fields to delivery tokens, app users, and anonymous callers,
  in single, repeatable, and dynamic-zone components. They are now left out at any depth; admin reads still
  show them.
- **Per-account sign-in and reset limits hold under parallel requests.** Sending many requests at once used to
  check up to 20 passwords a minute against one account and send 20 reset emails to one address; now each
  request takes its slot before it runs, so admin and app-user sign-ins, password resets, sign-ups, and
  confirmation resends stay at 5 per 15 minutes. Successful sign-ins still never count.
- **Deleting a locale no longer deletes entries of models that aren't localized.** Such an entry stays in the
  locale it was created in, so deleting that locale after the default changed used to delete it. It now moves
  to the default locale, with its history, links, and unique values intact. Entries of localized models that
  existed only in the deleted locale are deleted like a normal delete: an `entry.deleted` event is sent, and their
  unique values can be used again. The confirmation now says how many entries will be deleted and how many move.
- **Unique fields stay unique when they stop being per-locale.** Making a unique field shared, or its model
  non-localized, now checks for entries that hold the same value in different locales and refuses the change
  if any do, as making a field unique does. The registry of taken values moves to the shared key, so a later
  duplicate is refused in every locale. The reverse change, making a unique field per-locale, now lets
  locales share a value while still refusing duplicates within a locale.
- **Webhooks survive an unreadable secret.** After `SESSION_SECRET` changes, a webhook's deliveries are recorded
  as dead with the reason, the webhook list and page show a warning, and Rotate secret repairs it. Before,
  deliveries stayed pending forever and nothing in the admin said why.
- **Publish no longer puts live a draft the editor never saw.** Publishing from a tab that missed another
  session's save now shows the "Someone else saved this entry" banner instead of publishing. The publish API
  takes the draft version you read (`expectedVersion`, or `expectedVersions` per locale) and answers 409
  `CONTENT_VERSION_CONFLICT` when it moved. The editor, list, and bulk Publish send it; `@shapio/client` and
  the GraphQL `publish…` mutations accept it.
- **A shipped change set keeps showing what it shipped.** Its page used to compare the set with what it had
  just made live, so it said "No schema changes", asked to rebase the draft, and showed "Shipping is blocked".
  It now lists the schema changes and each entry's values before and after the ship, says who shipped it as
  which snapshot, and shows no ship checks. Also, on a phone, a card's buttons and chips no longer cover its
  title.
- **Snapshots record what a change set published when it also converts those entries.** A set that changed a
  field's type and published entries of that model recorded their old content, converted, as the snapshot, so
  `?snapshot=N`, snapshot diffs, and Restore showed the entries as they were before the set. The snapshot now
  holds what the set published.
- **New content types show why a name is refused on the first Create.** A name the server rejects, such as
  `Query`, `Media`, or one another type's GraphQL names already use, now shows its reason under API ID straight
  away instead of only "Fix the highlighted settings" with nothing highlighted. A refusal that points at no field
  shows its own reason above the buttons.
- **Signing in no longer takes away what visitors can read.** A signed-in app user now holds the roles the site
  gives to everyone (`public`) as well as the `authenticated` roles and their own, so content `public` can read
  no longer returns 403 once someone signs in. Anonymous callers still hold only the `public` roles.
- **Fields granted only on your own entries stay off everyone else's.** When one role could read every entry
  and another could read your own entries with more fields (an email, say), those extra fields showed on every
  entry. They now show only on entries you own, over REST, GraphQL, populate, and previews. Filtering, sorting,
  or searching on such a field is refused unless every entry you can read is your own.
- **Restoring a revision saved before a field's type changed** brings it back as its history view shows it,
  with values of the old type empty, instead of failing with `must be a string`. Restoring a snapshot from
  before the change works the same way, and a required field left empty is refused with a message naming the
  type change.
- **History compare says the right thing.** Restoring a version that fills an empty field now reads "would be
  filled in", and one that empties a field reads "would be cleared" (they were swapped). Dates in the compare
  show in your time, not as raw UTC text.
- **Relation and media filters no longer match what the response hides.** A delivery filter naming an
  unpublished entry, an entry the token may not read, or a force-deleted asset now matches as if the link were
  not there, so `$eq`, `$ne`, `$in`, and `$nin` agree with the returned data. A filter on a relation into a
  model the token may not read is refused with 403, like a hidden field.
- **`$not` is now the exact complement of the filter it wraps.** Over a range or text match (`$gte`,
  `$contains`, …), it used to leave out entries whose field is empty, so they appeared in neither result; it now
  includes them, like `$ne`, `$nin`, and `$notContains` (REST, GraphQL, and the admin list).
- **Publishing a draft that is already live is a no-op.** It no longer makes a new snapshot, writes an
  `entry.published` event (so webhooks and deployment triggers stay quiet), or adds a publication-log row. This
  covers bulk Publish, scheduled publishes, and change sets too, and matches how unpublishing twice behaves.
- **Entries using a force-deleted file can be saved again.** After an owner force-deleted a file that content
  used, saving or publishing those entries failed with `MEDIA_MISSING`. Saves now check only the files they add,
  the admin shows the missing file so you can remove it, and the Inbox lists the entries under "Files deleted
  from the library".
- **Entry history shows publishes and who did what.** History now names who made each revision, lists every
  publish and unpublish with who did it ("Published on schedule", "Published with change set Launch"), and marks
  the version that is live. A save that changes nothing no longer adds an empty "Saved" row: the admin and
  delivery write APIs answer with the same version, record no revision, and send no `entry.updated` event (a
  save over autosaved work still records one).
- **Changing a file's visibility returns a URL that keeps working.** The URL in the answer used the old prefix
  and broke once the background move finished. Until the move is done, the file's URLs now go through
  Shapio's own file route under the new prefix (also on S3 and behind a CDN), and that route serves the file
  before and after the move.
- **Creating an entry that goes live is now in the audit log.** Create and publish (in the admin, the delivery
  write API, or on a model without drafts) writes one `content.publish` row marked `via: create`, like the
  Publish button, bulk Publish, schedules, and change sets already did.
- **A type change review that knows a check fails no longer lets it ship.** When a type change would leave a
  required field empty, the review says both numbers ("3 entries (4 versions) would be left without a required
  value"), and Ship now stays disabled with the reason until you untick Required or set a default; Review in a
  change set still works. After a change fails, Review works again while the "didn't go live" notice is still
  shown.
- **A NUL character or an unpaired surrogate in input is a clear 422, not a server error.** Any request
  carrying one (content saves, delivery filters and search, GraphQL, app-user sign-up, locales, models) is
  refused with `INVALID_TEXT` and the path of the value, and import bundles and other content writes refuse it
  too. PostgreSQL failed with an internal error and SQLite stored the text, so both now agree.
- **Export and import keep timestamps to the microsecond.** Entries created within one millisecond on PostgreSQL
  no longer swap places in lists after an import. Bundles are now format 2 (six fractional digits); format 1
  bundles still import, and older Shapio releases refuse a format 2 bundle instead of misreading it.
- **`shapio status` no longer reports success for a server that is not Shapio.** A URL that answers 200 with
  something else (the admin page, a proxy's default page) now exits 1 with "not a Shapio instance", and a ready
  check that does not say ready exits 1 too.
- **A link to a content type you can't read no longer claims it was deleted.** A relation field whose target
  your role can't read now says "You can't read the content type this field links to.", and the entry's
  properties show "1 linked entry you can't read" instead of "Untitled" and an ID. The links are kept on save,
  as before.
- **Expired credentials and old delivery logs are now pruned.** The daily retention job deletes credentials
  that expired more than `RETENTION_DAYS` ago (admin sessions, invitations, password resets, app-user refresh
  tokens, login codes, email confirmations, and preview tokens), spent setup tokens, and finished webhook
  deliveries and deployment runs older than that. Each webhook keeps its newest delivery, and each deployment
  connection keeps its newest and live run.
- **Deleting a model or component through the API needs the breaking-change acknowledgement.**
  `DELETE /api/admin/models/:id` (and `/components/:id`) removed the API at once with no acknowledgement, while
  `shapio schema apply --prune` refuses the same deletion without `--allow-breaking`. It now answers 409
  `SCHEMA_CHANGE_NOT_ACKNOWLEDGED` unless `acknowledgeBreaking=true` is sent; the admin sends it after its
  confirm dialog.
- **New `.env` files and SQLite databases are readable by their owner only.** `create-shapio` writes `.env`
  (SESSION_SECRET, the database password) with mode 0600, and Shapio creates a new SQLite file, with its WAL
  files, the same way. Existing files keep their permissions.
- **`shapio schema diff` shows what changed inside a value.** Display changes (a form layout's groups, for
  example) were cut at 77 characters, with the two sides in different key orders, so the change itself was
  usually hidden. The diff, `apply`, and conflict output now print one line per part that changed (such as
  `~ display.groups[1].label: "Main" → "Details"`), in full and with sorted keys.
- **`shapio admin create` applies the same rules as Setup.** It refuses an invalid email, a name over 200
  characters, and a password outside 12 to 256 characters, instead of creating an admin who could never sign
  in.
- **A model's version history says which versions never went live.** `GET /api/admin/models/{id}/revisions`
  listed versions whose change failed its checks like any other. Each version now carries `status` (the outcome
  of its change: `activated`, `failed`, `canceled`, `pending`, or `running`) and `active`.
- **On SQLite, a second server or a worker can no longer run on a file another process serves.**
  `shapio worker` is refused on SQLite (its jobs run inside `shapio start`), and a second `shapio start` on the
  same file stops with "Another Shapio process already serves …". The server holds an operating-system lock on
  `<database>-shapio.lock` that is released when it exits, even after a crash. `shapio migrate`, `backup`, and
  `admin create` still run beside it.
- **`shapio schema apply` reports the version it activated at.** After waiting for a change's background
  checks, the last line printed the schema version from before the change; it now prints the version the
  lock file records.
- **Webhook and deployment job errors read once.** A webhook timeout was recorded as
  `Error: Error: Request timed out after 10000 ms`, and a failed deployment trigger logged its message
  twice (three times for a secret that cannot be decrypted); each now names the problem once.
- **The development server reports an invalid setting in one line.** `pnpm dev` printed a raw stack trace
  for a setting that `shapio start` reports as one line; both now print the same message.
- **REST drafts mode reports `meta.snapshot: null`.** A read with `publicationState=draft` (and
  `@shapio/local` with `drafts: true`) reported a snapshot number as if the drafts could be pinned; it now
  reports `null`, as GraphQL already did.
- **Acknowledgement errors name only the parameters the change needs.** Deleting a locale with content said
  to resend with `acknowledgeBreaking`, which that route refuses; the message now names
  `acknowledgeDestructive` there, `acknowledgeBreaking` for a new default locale, and both only when a
  model change needs both.
- **Pages your role can't use say so before you fill anything in.** Opening New content type, New component,
  a New entry of a type you can't create, or Settings → API tokens by URL, bookmark, or an old link now shows
  "You don't have access to this" instead of a form that fails on submit or a New token button.
- **Admin copy and layout fixes.** File sizes under a kilobyte read "44 bytes", not "44 byte". A time reads
  "09:15" in the entry settings, not "09:15:00.000". A date fills its column in a form. A new entry's
  settings no longer show an empty Status heading. Snapshots name the person or token that took them. A
  choice field says when it has no choices or a choice lacks a value or label. Adding `FR` when `fr` exists
  says the locale already exists. Site and role keys are suggested from the name, as API IDs are.
- **Scheduled publish and assist job errors read once.** A scheduled publication or an assist content
  operation that failed for good logged its reason twice; it now names it once.
- **Time and date-time inputs fill their form column.** In a form they kept their natural width; they now
  fill the column their width setting gives them, as text and date inputs do.
- **Roles can be limited to some models and fields in the admin.** A role's page (Network → Roles → the role)
  has a table of models, shared and per site, by action, with field lists per action, and shows every grant
  the role holds, including grants made through the API and grants on deleted models, which can be removed.
  Saving a grant whose field list names a field the model doesn't have is refused with `UNKNOWN_FIELD`, for
  admin, delivery, and app roles.
- **A delivery caller's GraphQL schema no longer names what it can't read.** Introspection with a delivery token
  listed every `public: false` field (in components too) and every model of the site. The schema a delivery
  token, app user, or anonymous caller sees now holds only the models, fields, filters, and inputs its role
  allows, and leaves out relations to models it can't read. This changes what delivery callers get: a query
  naming a hidden field, or a model the caller can't read while it may read others, now fails validation
  (`400`, `Cannot query field …`) instead of returning `null` or `FORBIDDEN`. A caller allowed no model at all
  still gets `401 UNAUTHENTICATED` (anonymous) or `403 FORBIDDEN`. Admin sessions and admin tokens, the
  playground included, still see the full schema.
- **Fields you may change only on your own entries stay locked on everyone else's.** When one role could
  change some fields on every entry and another could change more fields on your own entries, those extra
  fields could be changed on any entry. They are now refused with `FORBIDDEN_FIELD` on entries you don't own,
  over the admin, REST, and GraphQL; new entries count as your own.
- **Restoring a revision checks every field it changes.** On localized content types, a restore could change
  fields of its locale that your role may not edit. Those restores are now refused with `FORBIDDEN_FIELD`.
- **Duplicating an entry copies only what you may read on it.** A field you could not read on someone else's
  entry (granted only on your own entries, say) was copied into the duplicate, which you own, so the value
  showed there. It is now left empty, like unique fields, for you to fill in before saving.
- **Creating only your own entries needs someone to own them.** A role that may create entries only as their
  owner, bound to the public audience or held by an API token, let anonymous callers and tokens create, though
  they own nothing. Those creates are now refused with 403 before anything is written; signed-in users and
  admins create as before.
- **`$null` and `$notNull` on relation and media fields agree with the response.** An entry whose links all
  point at unpublished entries, entries outside the read's locales or the token's row filter, or force-deleted
  assets now counts as null, as it reads, in REST and GraphQL, on live and pinned snapshot reads.
- The starters' seed reads model files under `shapio/sites/<site>/` as well as `shapio/models/` and
  `shapio/components/`, so a project whose schema was pulled with `shapio schema pull` seeds a fresh instance
  again.

## [0.5.6] - 2026-10-11

### Changed

- **Any field can change to any type.** A saved field's type tiles are no longer grayed out where Shapio can't
  convert the stored values (Media to Number, Date to Media, Relation to Boolean). Picking one says, in red,
  that every stored value in the field will be dropped and old API clients will see it empty. The review counts
  the entries that lose their value and asks you to confirm a destructive change, then the field keeps its ID
  and API ID and starts empty, in one live change. A required field without a default can't be left empty:
  the review shows how many entries would fail, so untick Required or set a default in the same save. Old
  snapshots keep the old values in storage but show them as `null`. `shapio schema diff` marks the change
  "(values dropped)", and `schema apply` needs `--allow-destructive` for it.

## [0.5.5] - 2026-10-10

### Added

- **Document or form.** Each content type now chooses how its entries open, under **Display → Layout** in the
  model builder. **Document** is the default and works as before. **Form** puts every field on the page, the
  title included, with the title's value as the heading: the right fit for records such as a product, a
  redirect, or a job listing. A form's fields each take a width (**Full**, **Two thirds**, **Half**, or
  **Third**), fill rows in field order, and stack in a narrow window; a wireframe in the builder shows the rows
  as you change widths and order. Fields can be put in named **groups** from their settings, shown as sections
  of the form, and groups can be renamed or removed in Display. The settings drawer of a form keeps status,
  locales, history, and the danger zone. Schema managers can also switch the layout from any entry, under
  **Settings → Layout**, at once and with Undo. All of it is schema data (`display.layout`, a field's `width`,
  `display.groups`): live on save, carried by `schema pull` and `schema apply`, and shown as metadata changes in
  change sets. Switching back to Document restores the document's own settings.
- The **Entries · Structure · API** tabs now sit above each entry of a collection too, as they already did
  above a single type's document, for admins who see the type's structure. Entries goes back to the list.
- **Team and Network in the sidebar.** The Workspace group now links straight to the admins and editors
  (**Team**) and to the network view (**Network**) for anyone who can open it, so the site switcher is no longer
  the only way there. The App users page says where editors and admins live.
- **Importers check names against the target.** `shapio import strapi --plan` and `wordpress --plan` with
  `--url` and `--token` compare the planned API IDs with the instance and rename clashes (`seo` becomes
  `seoItem`), so the apply does not fail on a name the target already uses.

### Changed

- **Sidebar active item** is one quiet pill with the icon in the accent color; the bar and shadow are gone.
- **Entry top bar** never overlaps at laptop width with the settings drawer open: the breadcrumb stays readable,
  the save state drops its date while the drawer or preview is open, and the actions wrap when they must.
- **Changing a field's type** now reads as an answer: "You can change this.", then what happens to stored
  values (converted, checked, or kept as they are), then what API clients see.
- **Change set review** shows readable values: rich text as plain text, media by file name, relations by the
  entry's title, with the raw value one click away.

### Fixed

- **Deployments survive an unreadable secret.** When `SESSION_SECRET` changes, a deployment connection's stored
  secrets can no longer be decrypted. The list and the page now load with a warning on the connection, Deploy
  is disabled until it is repaired, and saving the connection with an empty secret mints a new one and shows it
  once. Before, the whole Deployments page failed.
- **Admin files are exempt from the API rate limit.** A busy admin session could hit the limit on its own
  scripts and stylesheets; file-like paths under the admin prefix are now allowed through, API calls still count.
- **Retention sweeps dead import bundles.** A `transfer.import` job that died before running left its bundle in
  media storage for good; the nightly retention job now removes bundles of dead jobs older than the retention
  period and keeps the job rows.
- **Astro starter: pages created after `astro dev` started** render without a restart; the dev integration tells
  Astro that content changed, at most once per window.

## [0.5.4] - 2026-10-07

### Added

- **Code fields.** A new `code` field type for content that is code: a script, an embed, a config file, a game's
  dialogue script. The value is a string Shapio never trims or rewrites. Each field has a language (plain, HTML,
  CSS, JavaScript, JSON, YAML or Markdown) that the API reports: OpenAPI marks the property with
  `x-shapio-language` and `contentMediaType`, GraphQL descriptions end with `Code: <language>`, and generated
  TypeScript types carry it in the field's comment. The admin edits it in a CodeMirror editor with line numbers
  and highlighting for the field's language; Tab moves on, Cmd/Ctrl-] and -[ indent. A JSON field can require
  valid JSON, checked in the admin before saving and refused by the server. Code fields cannot be unique,
  filterable or sortable, so changing a long text field to code is a breaking change (its filters go away);
  changing back is not. Values survive both ways.

### Fixed

- **Exporting one site from an instance with several sites.** Roles are shared by every site, so a site's
  bundle carried every role with grants on other sites' models, and importing it failed partway with
  `UNKNOWN_MODEL`. An export now keeps only each role's grants on the bundle's models. An import leaves out
  grants on models neither the bundle nor the target has (listed in the plan), so older bundles import too, and
  updating an existing role changes only its grants on the bundle's models: importing one site never changes
  what a role may read on another.
- **A failed import left files behind.** When an import failed before its job was queued, the stored bundle and
  the media files uploaded for it stayed in media storage. Both are now removed.
- **Admin: an entry's editable title no longer clips descenders** (g, j, p, q, y).
- **create-shapio** no longer says to edit `DATABASE_URL` when `--database-url` already set it.
- **README** rewritten, with screenshots and a three-line quick start; the npm package page matches it.

## [0.5.3] - 2026-10-07

### Fixed

- **Starters: `listAll` takes the caller's `seo` and `richText`.** The starters' list helper spread the caller's
  query before its defaults, so `seo=resolved` always won and a collection without SEO fields (a redirect type)
  was refused. The defaults now come first and `listAll` is exported, so such a collection is read with
  `{ seo: 'raw' }`.
- **Astro starter: `build:incremental` no longer crashes on models without a `slug` field.** It looks up slugs
  only for pages and articles.
- **Docs: `npx @shapio/cms` outside a Shapio project.** npm does not allow the unscoped name `shapio`, so a bare
  `npx shapio` only works where `@shapio/cms` is installed. Schema sync, importers, MCP setup and site export
  now show `npx @shapio/cms`.

## [0.5.2] - 2026-10-07

### Added

- **The Astro starter re-renders only the pages a publish changed.** Builds use Astro's
  `experimental.incrementalBuild`: every page and article carries a `cacheKey`, a digest of what it renders (its
  props, the site settings and SEO defaults its layout reads, drafts mode and the year), and Astro restores a page
  from the previous build while its key and its code are unchanged. The cache is `node_modules/.astro`; on
  Cloudflare Pages, turn on build caching so it survives between builds. `npm run check:incremental` checks it
  against a running Shapio, and runs in CI. `build:incremental` is documented as the local and CI tool it is, and
  never skips a build without a `dist/` to keep. ([Site starters](documentation/starters.md#incremental-rebuilds))

### Changed

- **Importers plan for the primary site by default.** `shapio import strapi|wordpress --plan` without `--site`
  used to plan models shared with all sites, which only a network admin token may create, so applying the plan
  with the ordinary site token the admin's token dialog makes failed with `FORBIDDEN_SCOPE`. `--plan` now takes
  `--site`, then `SHAPIO_SITE`, then the primary site; `--shared` plans shared models as before.
  ([Importers](documentation/importers.md))

### Fixed

- **Strapi importer: renamed content types and components are listed.** Definitions whose API ID changes on
  import (Strapi's `shared.media` becomes `mediaItem`) now appear in `--plan` alongside renamed fields.
- **Strapi importer: uploads keep their file extension** when the Strapi file name has none.

## [0.5.1] - 2026-10-05

### Added

- **Drafts mode: a site's development server renders saved drafts.** Drafts reach a site only when both
  safeguards agree: the server serves them only to a delivery token whose role grants the new **Read drafts**
  permission, and the site must ask for them (`?publicationState=draft`, GraphQL `publicationState: DRAFT`, or
  `drafts: true` on `@shapio/client` and `@shapio/local`), so a production token can never show a draft. Read
  drafts is a delivery-role permission that always covers every model the role reads; the admin's role sheet
  offers a delivery role only Read and Read drafts, and the tokens list marks such tokens with a **Drafts**
  chip. Draft responses carry `meta.publicationState: "draft"` and `Cache-Control: private, no-store`; a token
  without the grant gets 403 `DRAFTS_FORBIDDEN`, and anonymous callers and app users never read drafts.
  Published responses are unchanged. Under Next.js the client never caches or tags draft reads, and it refuses
  a pinned `snapshot` in drafts mode. The three starters turn it on with `SHAPIO_DRAFTS=true` (no snapshot,
  fresh reads, a **Drafts** badge on every page), and their seed creates a `<site> dev` role and token
  (`SHAPIO_DEV_DELIVERY_TOKEN`) for it. Publishing still rebuilds the live site; drafts mode is for your
  machine. ([Delivery API](documentation/delivery-api.md#drafts-in-development))

### Changed

- **GraphQL `publicationState: DRAFT` refusals** now use the code `DRAFTS_FORBIDDEN` (was `FORBIDDEN`), and are
  checked after the model's read permission, so a caller that may not read the model at all gets the usual
  401 or 403 first.

### Fixed

- **The site starters follow publishes in dev.** `astro dev`, `next dev` and `vite dev` showed the content of
  the snapshot they first read until restarted (and `next dev` needed `SHAPIO_SNAPSHOT` set to render at all).
  In dev the starters now read the current snapshot again once the last read is a second old and cache site
  settings and lists no longer than that, and the Astro starter's dynamic pages read their entry when they
  render (a 404 once it is unpublished), so a publish shows on reload. Builds are unchanged: one pinned
  snapshot, `SHAPIO_SNAPSHOT` and `/build.json` as before.

## [0.5.0] - 2026-10-05

### Added

- **Next.js cache tags in `@shapio/client`.** Under Next.js (`process.env.NEXT_RUNTIME`), every delivery read
  passes `next: { tags }` to `fetch`: lists and singletons `shapio:site:<key>` (or `shapio:site` when the client
  names no site) and `shapio:<routeKey>`, `delivery.get` also `shapio:<routeKey>:<id>`, `site.get()` the site
  tag; `shapioTags` builds them for `revalidateTag`. A new `next` option on `createClient` and on each read
  (`{ cache?: 'force-cache' | 'no-store', revalidate?: number | false }`, or `false` for none) sets the cache
  mode. There is no cache-mode default: under Next the reads are only tagged unless you ask, except that reads
  pinned to a snapshot are always `force-cache`. Outside Next, without the option, requests are unchanged.
  The Next.js starter sets no cache mode (its content reads are pinned, so cached regardless, and `site.get()`
  stays fresh on every build, since Next's data cache outlives `next build`); its `/api/revalidate/` route now also expires the
  tags of the models and entries in the snapshot diff (and the site tag on `site.updated` and schema changes)
  with `revalidateTag`, besides revalidating the pages; its answer lists them in `tags`.
- **In-process delivery runtime (library entry).** The delivery reads (`/api/content/*`, `/api/site`,
  `/api/snapshots/current` and `/changes`) can run as function calls in the reading process, on PostgreSQL or
  MySQL, with the server's permissions, shapes and errors. A call costs one state statement plus its read. A
  model change shows on the next call without a restart. Only delivery tokens or anonymous callers may read
  this way, and nothing on this path writes. The server now records its release (`system_versions.release`,
  a new migration) and a non-secret delivery descriptor (public URL, base path, media locations) at every
  start. A reader of another release is refused with `ShapioVersionSkewError` (503 `VERSION_SKEW`), or reads
  over HTTP with `onVersionSkew: 'http'`. It ships as `@shapio/local` (below).
- **`@shapio/local`**, a new package: `createLocalClient({ databaseUrl, token?, site? })` returns the
  `delivery`, `site` and `snapshots` groups of `@shapio/client`, answered in process, plus `close()`. It
  bundles the read path only (no Fastify, argon2, sharp or email); `mysql2` and the AWS SDK are optional peers,
  loaded only for MySQL or private S3 media. It refuses SQLite and the Edge runtime. `@shapio/local/next` checks
  the runtime and re-exports `shapioTags` for a documented `"use cache"` + `cacheTag` recipe: Next.js 16 only
  allows `cacheTag()` inside a `"use cache"` function with `cacheComponents` on, so the package cannot tag
  in-process reads for you.
- **The Next.js starter reads in process with `SHAPIO_MODE=in-process`** and `DATABASE_URL` (Shapio's database):
  one factory (`src/lib/shapioClient.ts`) picks `@shapio/client` over HTTP or `@shapio/local`, and
  `next.config.ts` lists `@shapio/local` in `serverExternalPackages`. CI builds and smoke-tests the starter in
  both modes and requires their rendered pages (public media URLs included) to be identical; the shared smoke
  gained `--save <dir>` for that. `create-shapio` pins `@shapio/local` to the exact release in scaffolded
  projects. Guide: `documentation/in-process.md` (trust boundary and a read-only database role, private media
  secrets, upgrade order, connection pools for serverless and `next build`, caching).
- **`createDeliveryClient(request)` in `@shapio/client`**: the client's read groups over any transport (a
  `RequestFn`); `createClient` builds on it.

### Fixed

- **Unknown permission conditions fail closed (security hardening).** A role grant whose row condition this
  build does not know (written by a newer Shapio on the same database) now grants nothing. It used to read as
  unconditional, which would have widened the grant to every row.

## [0.4.1] - 2026-10-05

### Added

- **Show any field in the document.** A field's settings have **Show in document**: on, the entry document
  shows the field under its name among the blocks (an excerpt, a date, the SEO fields) and the strip and
  Settings panel no longer list it; off on a rich text, zone or list, it moves to the Settings panel. It edits
  the model's `display.canvasFieldIds`, which now accepts any field but the title (it took block fields only),
  so it is pulled and applied like any display setting; files without it behave as before. A new block field
  joins a configured list. A document without block fields keeps its property grid under the fields placed in
  it.

### Changed

- **The entry's Settings panel is open by default on wide screens** (80rem and up, where it sits beside the
  document). Closing it is remembered in that browser; opening the preview closes it without changing that.
- **Summarize from body** accepts any string or text field but the title, wherever it is placed; the server no
  longer answers "it is not a property of this model" for a field in the document.
- **Filtering on a filterable or sortable field is faster on PostgreSQL.** Equality (`$eq`, `$in`, and their
  negations) on such a field now uses the field's own index instead of the JSON containment index, which had to
  re-read and decompress every candidate entry. A filtered delivery list of 20 out of 200 matching entries takes
  about half the time. Results are unchanged; fields that are neither filterable nor sortable compare as before.
- **Paginated lists count matches without joining entries** when no condition reads an entry column (owner row
  filters, the admin author filter and `createdAt` filters still join), so a filtered total is read from the
  field's index. Totals are unchanged.
- **Lists in the default newest-first order read an index in order and stop at the page.** Each entry's
  creation time is now stored with its content (`entry_heads.entry_created_at`, with an index), so a list no
  longer joins and sorts every matching entry to return one page. The upgrade backfills existing content; on
  PostgreSQL an instance with content builds the index in the background without blocking writes. On MySQL the
  limit of filterable or sortable fields per instance goes from 56 to 55 (the new index counts against the
  table's 64).
- **A live delivery list with relation fields no longer opens a transaction** (two fewer round trips). Which
  related entries it shows is checked against what is live when it answers, so an entry published a moment
  after `meta.snapshot` may already appear; unpublished entries never do. Reads pinned with `?snapshot=N`,
  previews and `populate` are unchanged.

### Fixed

- **Every field in the entry document shows its heading**, and an empty list shows "Nothing added yet" with an
  **Add** button (repeatable components and dynamic zones alike); a filled list ends with one. Before, a canvas
  field hid its heading once filled and an empty list rendered nothing, so a field like a tagline list was
  invisible on the page.
- **The SEO group is always a chip in the properties strip**, even while empty, so it can be found and opened
  without the Settings panel. Before, an empty optional SEO group hid behind "+1 more".

## [0.4.0] - 2026-10-05

### Added

- **The GraphQL playground is in the admin.** **Develop → GraphQL** opens GraphiQL on the current site's
  schema, in the admin's light or dark look; it was only reachable at `/api/graphql/playground` before. The API
  explorer's GraphQL tab now shows the request built on its REST tab as the same query (filters, sort, search,
  page, locale, snapshot and fields), to copy or **Open in playground**. GraphiQL's Docs panel describes every
  content type, component and field with its label and help text. The playground page takes `?query=` and
  `?theme=light|dark`. See [GraphQL: playground](documentation/graphql.md#playground).
- **SEO fields with per-site defaults (API).** A built-in, shared `seo` component (title, description, social
  image, canonical URL, noindex) with fixed stable IDs, created on first use through the change planner by
  `POST /api/admin/components/builtin/seo/ensure` (a network admin; it is refused with
  `SEO_COMPONENT_CONFLICT` while another definition holds the API ID `seo`, such as a Strapi import's). Each
  site has SEO defaults, `sites.seo_defaults` (site name, title template and description per locale; a public
  default image and the Twitter handle per site), edited with `GET`/`PUT /api/admin/site/seo` under the new site
  action `site.settings` (granted to every role that holds `publishing.manage`). A change writes a
  `site.updated` webhook event. Delivery and preview reads take `seo=raw|resolved`: `resolved` returns each SEO
  field with the defaults filled in, the title through the template (the entry's own title when the SEO title is
  empty); a pinned `snapshot` uses today's defaults. `GET /api/site` returns the site's key, name and defaults.
  `@shapio/client` adds `client.site.get()`, the `seo` read option, `SeoFields`, `SeoResolved` and
  `resolveSeo()` (also in the light `@shapio/schema/seo` entry). GraphQL has a `_site` root field with the same
  data (the name `_site` and the types `SiteInfo`, `SiteSeoDefaults` and `SiteSeoLocale` are now reserved).
  See [SEO fields](documentation/seo.md).
- **The site starters render SEO tags.** Article and Page have an `seo` field (the built-in component, which the
  seed applies shared with all sites); the seed fills it and sets each site's SEO defaults in English and French.
  Every page of the Astro, Next.js and SvelteKit starters has its title through the site's title template, the
  description, Open Graph and Twitter tags, `robots` for hidden entries, and a canonical URL when the new optional
  `SITE_URL` is set. The Next.js starter no longer applies its own title template, and its revalidation route
  refreshes every page on `site.updated` (which the seed's webhook now subscribes to). See
  [Site starters](documentation/starters.md).

### Changed

- **Admin themes are looks: pick one, nothing follows the OS.** Settings → Appearance and the account menu
  list six looks: **Shapio**, **Cobalt**, **Murdered out** and **Forest** (dark), **Snowed** and **Butter**
  (light). The color-mode setting (System, Light, Dark) and the light ⇄ dark button beside the account menu
  are gone. Classic is renamed **Cobalt** and keeps its original dark colors; Shapio is the plum dark look.
  Forest (deep green and lime) and Butter (butter yellow and ink) are new. Murdered out is all dark: gray
  actions, no white buttons. An extension theme with both variants is listed twice, as "Name Light" and "Name
  Dark". **Upgrading:** a saved Classic or pre-theme setting becomes Cobalt; Shapio light becomes Shapio; with
  nothing saved the admin opens in Shapio. The keys `forest` and `butter` are now built in, so an extension
  theme can no longer use them. See [First admin: appearance](documentation/first-admin.md#appearance).
- **One log line per request.** Fastify's "incoming request" and "request completed" lines, and the extra
  "request rejected" line on every 4xx, are replaced by one `info` line per response: `reqId`, `method`,
  `route` (the pattern), `path` (no query string), `status`, `ms`, and `site`, `principal` (its kind, never an
  id) and the error `code` when known. The request-start line (redacted URL, host, remote address) and the
  rejection line move to `debug`, and so do health and readiness probes. See `LOG_LEVEL` in the
  [environment reference](documentation/reference/environment.md).
- **Breaking: rich text is delivered as JSON only unless you ask for HTML.** Delivery and preview reads
  (`/api/content`, `/api/preview/content`) take `richText=json|html|both`. The default, `json`, returns the
  stored document `{ format, version, doc }` without `html`; `html` returns `{ format, version, html }`; `both`
  returns the document and `html`, as every delivery read did before. **What breaks:** a site that renders
  `body.html` without passing `richText` now gets no HTML. Sites generated by an earlier `create-shapio` do
  exactly that: add `richText=html` to their delivery and preview requests (`richText: 'html'` with
  `@shapio/client`, which now accepts it on `delivery.list`, `get` and `singleton`). The starters and examples
  ask for `html`. A page of 20 articles with an author shrinks from 78 KB to 52 KB. GraphQL is unchanged except that `RichText.html`
  is rendered only when selected. Generated TypeScript and OpenAPI types describe `doc` and `html` as optional.
- **One version check per request.** A request reads the schema version, the permissions version and its
  site once, in one statement, before any transaction (it used to read the versions again on every permission
  check and schema pin, and the primary site on every request). REST content requests evaluate each model's
  policy once, as GraphQL already did. Every instance still sees a schema or permission change from the next
  request: a permission revoked while a request runs applies from the next one.
- **Fewer statements per delivery read.** A delivery or preview read fetches its rows, the page total and the
  publication sequence (`meta.snapshot`) in one statement. A read that needs nothing more (no relation,
  populate or media follow-up) runs without a transaction; the rest still read one consistent moment inside a
  REPEATABLE READ transaction. Populate reuses the target entries the relation check already read, and field
  usage is recorded after the response is sent.

## [0.3.1] - 2026-10-04

### Added

- **Named admin themes.** Each person picks a theme and a color mode (System, Light or Dark) from the account
  menu, Settings → Appearance or the sign-in screen; the choice is saved in that browser and applied before
  first paint. Four are built in: **Shapio** (the new brand: plum, cream and acid yellow; light and dark, the
  default), **Classic** (the previous cobalt look, colors unchanged; light and dark), **Murdered out** (dark
  only) and **Snowed** (light only). A theme with one variant ignores the color mode. Every built-in theme is
  checked for WCAG 2.1 AA contrast. See [First admin: appearance](documentation/first-admin.md#appearance).
- **Extension themes.** `shapio.config` takes `themes: ThemeDefinition[]`: token values for a light and/or dark
  variant. Startup validates the keys, tokens and color values; `shapio extensions check` lists themes and warns
  about contrast below AA. The admin reads them from two public routes, `GET /api/admin/extensions/themes` and
  `GET /api/admin/extensions/themes.css`. The token list is exported from `@shapio/schema` (`THEME_TOKENS`).
  `examples/extension` adds a Sepia theme. See [Extensions: admin themes](documentation/extensions.md#admin-themes).

### Changed

- **New brand: acid yellow and plum.** The logo is an acid-yellow tile with a plum S; the letters are plum on
  light grounds and cream on dark. It is used in every theme, Classic included, and in the favicon and touch
  icon. The previous blue logo files stay in `brand/` as `classic-*`.
- **Upgrading:** anyone who had chosen System, Light or Dark keeps that color mode and moves to the **Classic**
  theme, so the admin looks as before (apart from the logo) until they pick another theme. People who never chose
  one, and new installs, get **Shapio** following the operating system. Settings → Theme is now Settings →
  Appearance.

### Fixed

- **Delivery reads no longer deadlock the connection pool under load.** A delivery read runs in one
  transaction; checking a relation target's read permission then read the permissions and schema versions
  through a second pooled connection. With as many concurrent reads as pool connections (10 by default) every
  connection waited for another and the server stopped answering until restarted (seen with
  `?populate=`; relation IDs alone could hit it too). The same nesting happened in GraphQL relation reads,
  admin reads with media, scheduled and change-set publishing, change-set shipping and scheduling, API token
  creation and role edits. Every check inside a transaction now reads through that transaction.
- **An exhausted pool fails fast instead of hanging.** A request that waits longer than
  `DATABASE_POOL_ACQUIRE_TIMEOUT_MS` (default 10000) for a database connection gets `503 DATABASE_BUSY` and
  the error is logged (PostgreSQL and MySQL; SQLite never waits for a pooled connection). On PostgreSQL, a new
  connection that cannot be opened within that time gives `503 DATABASE_UNAVAILABLE`. See
  [Environment variables](documentation/reference/environment.md).

## [0.3.0] - 2026-10-04

### Added

- **Content types per site.** Each site now owns its content types and components; any of them can be shared
  with every site instead. A definition created on a site belongs to that site unless created with
  `scope: "network"` (shared); upgrading makes every existing definition shared, so existing sites see no
  change. A site's view of the schema (its own definitions and the shared ones) is what its admin, REST,
  GraphQL, API docs, extensions, schema files, bundles and agents see: two sites can each have a `post` with
  different fields, and another site's content type is `404` there. A shared definition may only refer to
  shared ones, and its API ID cannot be one any site uses. `PUT /api/admin/models/:id/scope` (and
  `/components/:id/scope`) shares a definition with all sites or keeps a shared one on one site, refused with
  `SCOPE_IN_USE` while another site still has entries of it; a scope change is audited (`schema.scope`) and
  takes no snapshot. A role held on one site grants `schema.create` and `schemaManage` for that site's own
  definitions; shared ones, scope changes, locales and the read-only lock still need a role on every site.
  `me` reports `siteCount` and lists site-granted `schema.create` in `sitePermissions`. A change to a site's own
  content type notifies only that site's webhooks and deployment connections and numbers only its snapshots.
  A site that still owns content types cannot be deleted (`SITE_NOT_EMPTY` counts `definitions`). See
  [Sites](documentation/sites.md#content-types-per-site).

### Changed

- **GraphQL serves one schema per site.** `/api/graphql` answers with the request site's schema: its own
  content types and the shared ones, so two sites can each have a `post` with different fields, and a site's
  content types are absent from another site's schema and introspection. The endpoint now runs on graphql-js
  directly (mercurius removed); status codes and the error shape are unchanged (400 for parse and validation
  errors, 200 when there is data, 405 for a mutation over GET). POST bodies must be JSON:
  `Content-Type: application/graphql` is no longer accepted. The API docs page links the GraphQL endpoint,
  the playground and the OpenAPI document with `?site=`.
- **Schema files per site.** `shapio schema pull|diff|apply --site <key>` (or `SHAPIO_SITE`) works on one
  site's view: shared definitions stay in `models/` and `components/`, the site's own go to
  `sites/<key>/models/` and `sites/<key>/components/`. The lock file moves to format 2 (each entry's site, and
  the sites the tree covers); a format 1 lock still reads as all shared and is rewritten on the next pull. One
  tree can hold several sites: a site's pull and apply never send, rewrite, prune or delete another site's
  definitions. Apply refuses a file moved to another scope (`SCOPE_MISMATCH`), shared changes without
  permission on every site (`FORBIDDEN_SCOPE`, per item) and a tree pulled for other sites only
  (`LOCK_SITE_MISMATCH`); files without site folders (and older CLIs) still create shared definitions. New
  `shapio schema scope <apiKey> --shared | --site <key>` shares a content type with all sites or keeps a shared
  one on one site. The `GET /api/admin/schema/export` response names its `site` and each definition's site.
  GitHub write-back writes its connection's site view. See
  [Schema sync](documentation/schema-sync.md#several-sites).
- **Export and import carry scope.** A bundle holds its site's view of the schema with each definition's
  scope; importing creates the site's own content types on the target site and shared ones shared.
- **Importers, MCP and starters are site-aware.** `shapio import wordpress|strapi --plan --site <key>` plans the
  models as that site's own (without `--site` they are shared). The MCP server's schema tools list the site's
  view with each definition's scope, and `schema_draft` / `change_sets_add_schema_draft` take `shared: true`
  to create a definition shared with all sites. The starters' seed creates the models as the site's own
  (`SHAPIO_SITE`, else the token's site) and writes `SHAPIO_SITE` to `.env`; seeding one starter onto a second
  site is refused until its models are shared ([Site starters](documentation/starters.md#site-key)).
- **Admin: content types per site.** Creating a content type or component asks where it is available: this
  site (the default) or all sites (needs a role on every site); the choice shows only with more than one
  site. Shared types carry a small globe in the sidebar and the Components list, the builder's settings share
  a type with all sites or keep it on one, and the new Network → Content types page lists and creates shared
  ones. A schema role held on one site shows shared types' structure read-only, change set review marks shared
  schema items and names each breaking-field reader's site, and Locales now need a role on every site in the
  sidebar too ([Sites](documentation/sites.md#content-types-in-the-admin)).

### Fixed

- `shapio import --prune` no longer lists other sites' entries and media as candidates for deletion.

## [0.2.1] - 2026-10-04

0.2.0 was only partially published to npm (the server package was refused); 0.2.1 is the first complete
release of these changes.

### Added

- **MySQL 8.4 as a third database** (`DATABASE_URL=mysql://user:password@host:3306/shapio`), with several
  instances and a dedicated worker on one database, like PostgreSQL. Filterable and sortable fields are capped
  at 56 per instance (InnoDB's 64-index limit); with binary logging on, the first migration needs
  `log_bin_trust_function_creators = 1` or a user with SUPER. MariaDB is not supported. The integration suite
  and the admin e2e run on MySQL in CI; `docker-compose.mysql.yml` starts Shapio with MySQL. See
  [MySQL](documentation/mysql.md).
- **SQLite as a second database** (`DATABASE_URL=sqlite:./shapio.db`) for single-process installs, on Node's
  built-in `node:sqlite` with no native dependency; the same admin, APIs, live modeling and change sets.
  `shapio backup <file>` copies a running SQLite database (`VACUUM INTO`). `WORKER_MODE=dedicated` is refused
  on SQLite. The integration suite and the admin e2e run on SQLite in CI. See [SQLite](documentation/sqlite.md).
- **MCP server** (`@shapio/mcp`, `npx -y @shapio/mcp`): an agent in any MCP client can read and draft the
  schema, create and query entries, upload media, open change sets and read their review; `change_sets_ship`
  exists only with `--allow-ship` and still needs the `changes.ship` permission. `shapio mcp` prints the client
  configuration. See [MCP](documentation/mcp.md).
- **Site starters**: Astro, Next.js (App Router) and SvelteKit sites that render the same blog (pages with
  sections, articles, authors and a `siteSettings` singleton) in English and French, pinned to one publication
  snapshot per build, with `SHAPIO_SITE` for multi-site instances.
  `npx create-shapio my-site --site astro|next|sveltekit` writes one as a standalone project with the model
  files, a seed and a smoke check.
- **Next.js starter: on-demand revalidation.** A signed Shapio webhook calls `/api/revalidate/`, which
  refreshes only the pages changed since the site's snapshot; new articles and pages render without a rebuild.
  See [Site starters](documentation/starters.md#incremental-rebuilds).
- **Sites**: one instance runs many sites with a shared schema, admin users and roles, and per-site content,
  media, snapshots, change sets, app users, tokens, webhooks, deployments and field usage. Role assignments are
  per site or on all sites; network permissions (`schema.create`, `users.manage`, `roles.manage`, `audit.read`,
  `sites.manage`, `schemaManage`) need a role on all sites. Requests name their site with `?site=` or the
  `Shapio-Site` header (else the token's site, else the primary site). `shapio sites list|create`,
  `/api/admin/sites` and `/api/admin/sites/:id/app-roles` (per-site `public`/`authenticated` bindings, none on a
  new site); a `site` option in `@shapio/client`; `--site` for `shapio export|import` and `@shapio/mcp`;
  `services.site`, `services.forSite()` and `site` on hook contexts for extensions. See
  [Sites](documentation/sites.md).
- **Vercel and Netlify deployment connections**, next to Cloudflare Pages: Vercel builds start through a
  deploy hook and Netlify builds through its API, and both report real build status from the provider's API
  (with a link to the deployment or deploy log). `VERCEL_API_URL` and `NETLIFY_API_URL` set the API bases
  (defaults: the official APIs). See [Webhooks, deployments and preview](documentation/publishing.md).
- **Importers**: `shapio import wordpress` and `shapio import strapi` (Strapi 5) in two steps. `--plan` reads
  the export and writes schema files and an `import-map.json`, sending nothing; after `shapio schema apply`,
  `--map` uploads the media, creates drafts and opens change sets with the entries that were published at the
  source. Re-running `--map` resumes. See [Moving from WordPress or Strapi](documentation/importers.md).
- `@shapio/schema` now holds the rich-text spec, validator and renderer, and adds `@shapio/schema/html`
  (HTML → rich text).
- Docs: an [extension points catalog](documentation/extensions-catalog.md) covering server extensions,
  custom editors, webhooks, deployment providers, the client, CLI, export/import bundles and the MCP server.
- **Assist**: editor assists with your own model provider (`AI_PROVIDER` = `anthropic`, `openai`, or
  `openai-compatible` for Ollama, LM Studio and vLLM): alt text, summaries, translation, rewrites, content-type
  drafts from a description, and content-ops proposals for missing alt text and missing locales. Off by
  default; nothing is sent anywhere while it's off. Assist only proposes or writes drafts into a change set; it
  never publishes. `assist_runs` records who used which model and how many tokens (no prompt or answer text),
  pruned after `USAGE_RETENTION_DAYS`; audit events `assist.*`; settings `AI_MODEL`, `AI_API_KEY`,
  `AI_BASE_URL`, `AI_MAX_TOKENS`, `AI_TIMEOUT_MS`, `AI_RATE_LIMIT_MAX`. See [Assist](documentation/assist.md).
- **Preview and visual editing**: the entry document shows the site beside the document; clicking a field on the
  page focuses it, and saves re-render the page. New package `@shapio/visual` (`shapioAttr`,
  `initVisualEditing`). The admin's CSP frames exactly the preview sites' origins (never Shapio's own); preview
  URLs on Shapio's origin are refused. The Astro, Next.js and SvelteKit starters have `/preview/` with visual
  editing, and the seed creates a Preview connection. See [Visual editing](documentation/visual-editing.md).

### Changed

- The server package is published as `@shapio/cms`; the `shapio` command is unchanged. npm refuses the
  unscoped name. Project extensions import from `@shapio/cms/config`.
- Change sets can have `source: 'assist'`.
- Audit events have a write-order sequence (`audit_events.seq`), so events recorded in the same instant
  (common on SQLite and MySQL, which store milliseconds) list in the order they happened: the audit log, change
  set timelines, and other lists sorted by time now break ties by a stable key. The audit log is rewritten once
  on upgrade. Audit log page cursors issued before the upgrade are rejected (`400 INVALID_CURSOR`); start
  again from the first page.
- The example site moved from `apps/example-site` to `examples/astro` (package `example-astro`); its model
  files and seed moved to `examples/shared`, where all three starters share them. The seed applies the models
  through the schema apply API and also seeds the `siteSettings` singleton.
- **Upgrading to sites** moves everything to the primary site (key `default`); single-site instances behave as
  before, except:
  - app users' access tokens issued before the upgrade are rejected (`401 INVALID_TOKEN`) until the app
    refreshes; refresh tokens keep working;
  - model-wide preview tokens are deleted (preview tokens now always name an entry);
  - field indexes are rebuilt in the background by the `schema.fieldIndexLayout` job;
  - admin role assignments become "all sites", existing admin API tokens become network tokens and delivery
    tokens belong to the primary site;
  - new API tokens belong to the current site; a network admin token needs `"network": true` and
    `users.manage`;
  - webhook bodies gain `site`, and a network webhook (`"network": true`) receives every site's events;
  - the users and invitations APIs take `assignments` (`roleIds` is deprecated and means "on all sites");
  - rolling the migration back is refused while more than one site exists.

## [0.1.0] - 2026-10-03

The first release.

### Added

- **Live content modeling**: collections, single types, reusable components and dynamic zones, 21 field
  types with interchangeable editors, versioned in the database and changed while the server runs, through a
  change planner that validates, backfills, builds indexes and activates atomically, with no restart.
- **Schema sync**: `shapio schema pull | diff | apply` with canonical JSON files, a lock file and per-model
  three-way guards; optional read-only lock; optional GitHub write-back.
- **Content**: drafts with autosave, immutable revisions with restore, per-locale publishing, scheduling and
  atomic change sets; localization with shared and localized fields and fallback chains.
- **Media**: local and S3-compatible storage (R2, S3, B2, …) with direct browser uploads, private files with
  signed URLs, WebP variants, usage tracking and `shapio media migrate`.
- **Delivery**: a REST API with filters, sorting, pagination, populate, field selection, locales, publication
  snapshots and ETags; GraphQL with the same rules and a self-hosted playground; OpenAPI and TypeScript types
  generated from the active schema.
- **Accounts and permissions**: admin users with invitations, sessions and custom roles with field-level
  permissions; API tokens for admins and delivery; end-user accounts with email, Google and GitHub sign-in and
  own-entries permissions; an audit log.
- **Publishing**: signed webhooks with retries and delivery logs; deployment connections (generic signed build
  webhook, Cloudflare Pages, GitHub write-back) with honest run status; preview with scoped, expiring tokens.
- **Extensions**: lifecycle hooks, custom routes, services and jobs, and custom React field editors loaded at
  runtime, configured in `shapio.config.ts`.
- **Content export and import**: `shapio export` and `shapio import` with a dry-run plan, conflict refusal,
  ID-preserving and idempotent imports as resumable jobs, and media with checksums.
- **Distribution**: the `shapio` npm package and `create-shapio`, a Docker image and compose file, built-in
  HTTPS from your own certificate files (reloaded on renewal without a restart), sub-path hosting, a PM2 example and a systemd unit in the docs.
  `@shapio/client`, `@shapio/schema` and `@shapio/editor-sdk` are published for your own code.
- **Operations**: health and readiness endpoints, structured JSON logs with secrets redacted, graceful shutdown
  that drains requests and jobs, a one-line startup summary, and tested coordination of two instances on one
  database.
- **Example site**: an Astro site built from Shapio content, with pinned snapshots, preview and signed build
  callbacks.
- Documentation in `documentation/`.
- **Change sets**: schema drafts and entry publications reviewed together (diffs, planner checks, consumers) and shipped as one snapshot, now, scheduled or followed by a deploy.
- **Snapshot ledger and restore**: every snapshot records why, who and the schema version; restoring snapshot N creates a reviewable change set that ships as a new snapshot (schema is not rolled back).
- **Snapshot diff API**: `GET /api/snapshots/current`, `GET /api/snapshots/changes` and GraphQL `_snapshot`/`_changes` for incremental builds; the example site's `build:incremental` uses them.
- **Field usage**: per-token, per-field read counters from delivery traffic (counts only, kept on your server; `USAGE_TRACKING=false` turns them off), shown on Develop → Live and in change set reviews.
- **Editor experience**: entries open as documents (cover, title, properties strip, block canvas) with an Inbox, a command palette, presence, content-health findings and a publish pre-flight checklist.

### Known limits

- A schema change that converts or backfills stored values rewrites them inside the activation transaction,
  so writes to the affected models wait while it runs (reads continue): up to about 1.5 seconds for 6,000–7,000
  entries in our measurements. A staging table swapped in with one bulk update would shorten this for very large models;
  it is not built yet.

### Changed

- Collections have a plural API ID: delivery lists are `/api/content/articles` and GraphQL `articles`, single entries stay on the singular (`article`).
- Admin redesign: a new design system on the brand palette in light and dark, denser screens, Develop pages (Changes, Snapshots, Schema as code, API explorer, Live).
- No modals: creation, editing and picking happen in side sheets, inline panels and inline confirmations; dialogs remain only for irreversible acknowledgements.
- Releases are now change sets: `releases.manage` → `changes.manage`, `release.*` webhook events → `change_set.*`, the `release` deployment trigger → `change_set`, `/api/admin/releases` → `/api/admin/change-sets` (migrated automatically).
- A change set takes one snapshot number instead of one per entry, and schema conversions record `conversion` revisions so `?snapshot=N` serves converted values.
- First-run setup no longer needs a token by default: while no admin exists, the first person to open
  `/admin/` creates the owner account. Set `SETUP_REQUIRE_TOKEN=true` to require the one-time token logged at
  boot (for installs exposed before setup), or create the owner with `shapio admin create`.

### Removed

- Removed: automatic Let's Encrypt; bring your own certificate.
- Removed: Sentry integration (`SENTRY_DSN`); use an extension for error reporting.
