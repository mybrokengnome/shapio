# Modeling

A content model describes the shape of some content: a page, an article, a product. In Shapio models are
**data**, versioned in the database, not code. You create and change them in the admin (Models) or from schema
files with `shapio schema apply` ([Schema sync](schema-sync.md)), while the server runs. Shapio never generates
a route, a class or a table per model: one generic API serves every model, so a change is live as soon as it is
saved. No rebuild, no restart, no deploy.

## Kinds of definitions

| Shape           | What it is                                                               | API                                                                               |
| --------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **Collection**  | Many entries: articles, products, authors                                | `/api/content/<pluralApiKey>` lists, `/api/content/<pluralApiKey>/<id>` reads one |
| **Single type** | Exactly one entry: the home page, site settings                          | `/api/content/<apiKey>` reads it                                                  |
| **Component**   | A reusable group of fields embedded in models, never addressed by itself | inside the entries that use it                                                    |
| **Interface**   | Fields that unrelated types share; it stores nothing                     | `/api/content/<pluralApiKey>` lists every member's entries                        |

On an instance with several [sites](sites.md), each definition belongs to the site it was created on, or is
shared with all sites ([Content types per site](sites.md#content-types-per-site)). A site's own definitions may use
shared ones; shared ones may only use shared ones.

A **dynamic zone** is a field that holds an ordered list of components chosen from an allowed set: the
sections of a page (hero, feature grid, gallery, call to action) are the usual example. Each item carries the
component's API ID in `__component`.

Each definition has a **stable ID** (a UUID) that never changes, a **label** shown in the admin and an
**API ID** used by the APIs (the `apiKey` property in schema files). Fields have the same three. Content is stored keyed by field ID, so renaming a
label never touches data, and an API ID can change without losing anything (it is still a contract change
for your API clients; see below).

A collection also has a **plural API ID** (`pluralApiKey` in schema files). The singular names one entry and
the plural names the list, as REST and GraphQL conventions expect:

|                             | Collection `article` / `articles`                     | Single type `homepage`        |
| --------------------------- | ----------------------------------------------------- | ----------------------------- |
| REST                        | `/api/content/articles`, `/api/content/articles/<id>` | `/api/content/homepage`       |
| GraphQL                     | `article(id)`, `articles(…)`                          | `homepage`                    |
| GraphQL types and mutations | `Article`, `ArticleFilter`, `createArticle`…          | `Homepage`, `updateHomepage`… |

The admin suggests the plural as you type the API ID (`category` → `categories`; `news`, which has no distinct
plural, → `newsItems`) until you edit it yourself. It is stored on the model: nothing pluralises at request
time. Single types and components have no plural. The admin content API (`/api/admin/content/<apiKey>`),
roles, webhooks, extensions and transfer files all keep using the singular API ID.

**API IDs** are valid GraphQL names: letters, digits and `_`, not starting with a digit or `__`, at most 64
characters. The same rules apply to the plural API ID, which must differ from the singular. Shapio rejects,
when you save the model, IDs that would collide in GraphQL (`Query`, `String`, `Media`…, a model called
`pageFilter` next to a model `page`, a model `posts` next to a collection whose plural API ID is `posts`) and
field IDs that clash with system
attributes (`id`, `locale`, `status`, `version`, `createdAt`, `updatedAt`, `publishedAt`, …). The names of
Shapio's generated types are reserved too, compared ignoring case: a model can't be called `entry`,
`entryState`, `node`, `anyEntry`, `interfaceMember`, `kind`, `pagination`, or `error` (`API_KEY_RESERVED`). A
field may still be called `kind`.
With several sites these checks run in each site's view (its own definitions and the shared ones): two sites
may each have a `post`, but a shared definition cannot take an API ID that any site uses.

## Field types

The stored **data type** and the **editor** that renders it are separate choices: you can switch a boolean from
a toggle to a checkbox, or a string to a color picker, live, without touching data.

| Data type                  | Stored as                          | Editors                                         | Notes                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `string`                   | text                               | `textInput`, `textarea`, `color`                | min/max length, pattern                                                                                                                                                                                           |
| `text`                     | text                               | `textarea`                                      | long plain text                                                                                                                                                                                                   |
| `code`                     | text, exactly as written           | `codeEditor`                                    | head snippets, embed codes, JSON configs, template fragments; `language` (plain, html, css, javascript, json, yaml, markdown), min/max length, `validate` (JSON must parse); never unique, filterable or sortable |
| `richtext`                 | versioned JSON document            | `richText`                                      | headings, lists, links, quotes, code, images, tables; delivered as JSON, or sanitized HTML with `richText=html`                                                                                                   |
| `number`, `integer`        | JSON number                        | `numberInput`                                   | min/max                                                                                                                                                                                                           |
| `decimal`, `biginteger`    | string (exact)                     | `numberInput`                                   | precision/scale; no floating-point loss                                                                                                                                                                           |
| `boolean`                  | true/false                         | `toggle`, `checkbox`, `segmented`               |                                                                                                                                                                                                                   |
| `date`, `datetime`, `time` | ISO 8601 text (UTC)                | `datePicker`, `dateTimePicker`, `timePicker`    | min/max                                                                                                                                                                                                           |
| `enum`                     | one value or a list                | `select`, `radio`, `segmented`, `checkboxGroup` | `multiple` for lists                                                                                                                                                                                              |
| `slug`                     | text                               | `slugInput`                                     | generated from a source field                                                                                                                                                                                     |
| `email`, `url`, `uid`      | text                               | `textInput`                                     | validated formats                                                                                                                                                                                                 |
| `json`                     | any JSON                           | `jsonEditor`                                    | not filterable                                                                                                                                                                                                    |
| `media`                    | asset ID(s)                        | `mediaPicker`                                   | allowed kinds (image, video, audio, document), `multiple`                                                                                                                                                         |
| `relation`                 | entry ID(s)                        | `relationPicker`                                | target model, `one` or `many`                                                                                                                                                                                     |
| `component`                | an object (a list when repeatable) | `componentEditor`                               | min/max items                                                                                                                                                                                                     |
| `dynamiczone`              | a list of components               | `dynamicZoneEditor`                             | allowed components, min/max                                                                                                                                                                                       |

Field options:

| Option                   | Meaning                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `required`               | must have a value to save (autosave and drafts in progress may lack it)                                |
| `localized`              | its value differs per locale; otherwise it is shared by every locale ([Localization](localization.md)) |
| `public`                 | readable by delivery tokens and your app users (default **on**); off hides it unless a role grants it  |
| `unique`                 | no two entries hold the same value (among drafts and among published entries)                          |
| `filterable`, `sortable` | builds an index so the API can filter by range or sort on the field                                    |
| `defaultValue`           | used for new entries, and to fill existing ones when the field becomes required                        |
| `deprecated`             | hidden from editors and the API; stored values are kept until you remove the field                     |
| `width`                  | in a form, how much of a row the field takes: `full` (default), `two-thirds`, `half`, or `third`       |

Custom editors from your project can be chosen for any compatible field ([Extensions](extensions.md#custom-field-editors)).
Display settings choose the layout (document or form, below), the title field (labels in lists and pickers),
the list columns, the default sort, and the groups shown as sections of the entry form.

**Document or form.** Each content type chooses how its entries open, under **Display → Layout**. A
**document** (the default) is a page to write in: the title as its heading, the blocks in the body, and the
other fields as properties. A **form** puts every field on the page, the title included, with the title's
value as the page heading. Pick a width for each field of a form in its settings (**Full**, **Two thirds**,
**Half**, or **Third**): rows fill in field order and wrap, so two halves or three thirds sit side by side,
and in a narrow window every field takes the whole row. Put fields in a **Group** from their settings to show
them together under its name, as a section of the form; a group sits where its first field is, so field order
arranges groups too. Rename or remove groups under **Display → Groups**. Rich text, dynamic zones, components,
and media work in a form like any other field. A form has no Summarize button, which lives on the document's
property strip. In schema files the layout is the model's `display.layout` (`document` or `form`, unset means
`document`), a field's width is its `width` (unset means `full`; a component's fields have none), and groups
are `display.groups`. Changing any of them is live, like any display setting, and switching back to Document
restores the document's own settings. Whoever manages the type's schema can also switch the layout from any
entry, under **Settings → Layout**: it changes the type at once, and the message that confirms it offers
**Undo**.

**Document or property.** In a document type, an entry opens as a document: the title, then its blocks (rich
text, sections, repeatable components, galleries), with every other field as a property in the strip under the
title and the Settings panel. Turn on **Show in document** in a field's settings to write any field but the
title in the document instead, under its name among the blocks: an excerpt, a date, the SEO fields. Turn it
off on a block field to move it to the Settings panel. In schema files this is the model's
`display.canvasFieldIds`, the document's fields in order; without it the automatic rule above applies.
Changing it is live, like any display setting.

**SEO fields** are one click away: **Add field → SEO fields** adds the built-in, shared SEO component (title,
description, social image, canonical URL, noindex), with per-site defaults and a resolved form in the delivery
API ([SEO fields](seo.md)).

## New fields are live, and public by default

A new field appears in the admin form, the REST and GraphQL APIs, the OpenAPI document and the generated
TypeScript types as soon as you save. Because `public` defaults to on, a site's delivery token sees it at once.
Turn `public` off for fields only editors should see (internal notes, prices before launch); a delivery role
can still be granted those fields explicitly (Network → Roles). A hidden field is also left out of the GraphQL
schema delivery callers see. On a component's field, off always hides it
from delivery tokens, app users, anonymous callers, and previews, because roles grant a model's fields, never a
component's.

## Types that extend a type

A collection can extend another collection. Products holds what every product has (name, price, images), and
Digital and Physical extend it with their own fields (a download link, a weight). Digital and Physical are
**kinds** of product, and Products with all its kinds is a **family**. A kind can have kinds of its own
(Products, then Physical, then Apparel), up to 8 levels.

Pick the parent under **Extends** when you create the type, or set `extends` in its schema file to the
parent's stable ID ([Schema sync](schema-sync.md#types-that-extend-a-type)). The parent is a full type of its
own: a plain Product sits next to the Digital and Physical ones.

**What a kind inherits.** Every field of its parent (and of the parent's parent) comes first, in the parent's
order, followed by the kind's own fields. Inherited fields are the parent's fields, not copies, and they keep
the parent's field IDs. So a field you add to Products is on every kind at once, live, and the checks a new
field needs (a required value, a unique value, an index) run over the entries of every kind. Display settings
(layout, title field, list columns, default sort, cover) carry over until the kind sets its own, and the
parent's groups come before the kind's.

**What is locked.** A kind can't change, hide, or replace a field it inherits: edit it on the type that
declares it. The builder shows inherited fields in a locked block above the kind's own, with a link to the
parent. A kind's own fields can't reuse the API ID of an inherited field (compared ignoring case).

**The rules.**

- Only collections. A single type or a component can neither extend nor be extended, and a type with kinds
  can't become a single type.
- A kind has the same **Localized** and **Draft & publish** settings as its parent. The admin fills them in
  from the parent and locks them.
- A kind is available where its parent is: both shared with all sites, or both on the same site. Sharing a
  root type, or keeping it on one site, moves its whole family with it; a kind can't move on its own.
- A relation to Products accepts an entry of any kind of product. A relation to Digital accepts Digital
  entries only.

**Routes and `__model`.** A kind is read under its parent's plural API ID. With Post (`posts`) and its kind
Guide (`guides`), `/api/content/posts` lists posts of every kind, `/api/content/posts/guides` lists guides, and
`/api/content/posts/guides/<id>` reads one. The kind's **route key** is its ancestors' plural API IDs and its
own plural API ID, joined by `/` (`posts/guides`).
Every entry the delivery API returns names its own type in `__model` (the singular API ID), so a site can
render each row of a mixed list in its own shape. A parent's list filters, sorts, and searches on the fields
every kind shares ([Delivery API](delivery-api.md#types-that-extend-a-type)).

**GraphQL.** A type with kinds gets an interface, `PostInterface`, that it and every kind implement. The
`posts` query returns the interface, and you ask for a kind's own fields with a fragment
(`... on Guide { timeToComplete }`). See [GraphQL](graphql.md#types-that-extend-a-type).

**Permissions.** A grant on a parent covers its kinds: `read` on Products reads Digital and Physical too. A
kind can have grants of its own, which only ever add to what the parent's grants allow. You can't allow a
parent and refuse one of its kinds ([End users](end-users.md#access-is-denied-until-you-allow-it),
[Security](security.md#permissions)).

**Change kind.** An entry can move to another kind in its family: a Post becomes a Guide, or a Digital
product becomes a plain Product. See [Content](content.md#changing-an-entrys-kind).

**Moving a type under another parent** (or giving it a parent, or taking its parent away) is a contract
change, like changing an API ID. Its route moves and it gains the new parent's fields, so the review asks you
to acknowledge a **breaking** change. If it loses fields that hold values, their values are dropped, a
**destructive** change you acknowledge too.

**What Shapio refuses, and why.**

| Refusal                     | Why                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `UNKNOWN_PARENT`            | `extends` names a type that doesn't exist                                                                    |
| `INVALID_PARENT`            | the type or its parent is not a collection, a type extends itself, or the two are not available in one place |
| `INHERITANCE_CYCLE`         | types extend each other in a loop                                                                            |
| `INHERITANCE_TOO_DEEP`      | the family would be more than 8 levels deep                                                                  |
| `INHERITED_FLAG_MISMATCH`   | Localized or Draft & publish differs from the parent's; the message names the value to set                   |
| `INHERITED_FIELD_COLLISION` | a kind's own field has the API ID of a field it inherits                                                     |
| `HAS_CHILDREN`              | you deleted a type that others extend: delete its kinds, or move them under another type, first              |

A relation to a type points at that type and its kinds. To point at unrelated types (a link that can be a
Post, a Roadmap item, or the About page), make them implement an [interface](#interfaces) and target it, or
target [any entry](#relations-to-an-interface-or-to-any-entry).

## Interfaces

Extending a type gives kinds of one thing. An **interface** is for unrelated types that play one role: a blog
post, a roadmap item, and a guide can all be **featured** on a homepage, with a title, a summary, and an image,
but they are not kinds of each other. Make an interface, Featurable, with those three fields, and have each
type **implement** it. Featurable is then something you can list, filter, sort, and relate to, across all of
its types.

An interface stores nothing. It has a label, an API ID (`featurable`), a plural API ID (`featurables`), and a
**contract**: the fields every type that implements it must have. The types that implement it are its
**members**. Each member keeps its own fields and its own entries; the interface only says which fields they
share.

Create one under **Develop → Interfaces**, or as a file in `interfaces/`
([Schema sync](schema-sync.md#interfaces)). A type implements it from **Implements** in its builder (next to
Extends), or with `implements` in its schema file: the stable IDs of its interfaces. A type can implement any
number of interfaces, whatever it extends.

**The contract.** A member satisfies a contract field when it has a field with the same API ID (exactly, case
included) and a compatible definition:

- the same data type;
- for an `enum`, every value the contract lists (it may have more), and the same `multiple`;
- for `media`, allowed kinds within the contract's (a contract field with no allowed kinds takes any), and the
  same `multiple`;
- for a `relation`, the same target and the same `one` or `many`;
- every flag the contract field sets among `required`, `public`, `filterable`, and `sortable`. A member may set
  flags the contract leaves off.

Other settings (lengths, ranges, precision) are not compared. A contract field can be any data type except
`component` and `dynamiczone`. It can't be `unique` (uniqueness never spans types), and a contract `slug` can't
name a source field. `localized` is accepted on a contract field and imposes nothing: each member decides what
it localizes. The member's field keeps its own field ID: BlogPost's `title` and Guide's `title` are different
fields that both satisfy Featurable's `title`. A deprecated field does not satisfy a contract.

An interface's display settings pick the **title field** (what its list searches with `q` and what the
relation picker shows) and the **default sort**, both among its contract fields.

**What is locked.** While a type implements Featurable, a change that would break the contract (renaming,
deleting, or changing the type of its `title`, or turning off a flag the contract needs) is refused, and the
refusal names Featurable. The builder badges each field that satisfies a contract ("Required by Featurable").
Removing Featurable from **Implements** in the same change unblocks it.

**Adding a contract field.** When you add a field to Featurable that some members lack, the review names those
members and offers to **add it to them** in the same change set: the interface change plus one new field per
member, a copy of the contract field with its own ID. Ship the change set and every member has the field,
live. A member on another site is listed with "add it on site B first": a change set belongs to one site, so
add the field on that site yourself, then come back.

**Kinds and single types.**

- A kind implements what its parent implements: if Products implements Featurable, Digital and Physical are
  Featurable too. A kind may implement more interfaces of its own.
- A single type can be a member: the About page can be featured.
- A component can't implement an interface, and an interface can't implement or extend anything.

**Sites.** An interface is shared with all sites or belongs to one site, like a type
([Sites](sites.md#interfaces-across-sites)). A site's type may implement a shared interface or one on its own
site; a shared type may implement shared interfaces only. An interface on one site may only have members on
that site. An interface's list is always one site's view: the members on that site.

**In the APIs.** `GET /api/content/featurables` lists every member's entries in one page, each row in its own
shape with `__model`, filterable and sortable on the contract fields
([Delivery API](delivery-api.md#interfaces)). In GraphQL, Featurable is a GraphQL interface that every member
implements ([GraphQL](graphql.md#interfaces)). Generated TypeScript types get `Featurable` (the contract) and
`FeaturableAny` (the union of its members).

**Permissions.** An interface has no grants of its own. Reading it is reading its members: each member's
grants decide whether its entries are in the list and which of their fields you see.

### Relations to an interface or to any entry

A relation field's target can be a type, an interface, or **Any entry**:

| Target       | Accepts                                                                              | In schema files           |
| ------------ | ------------------------------------------------------------------------------------ | ------------------------- |
| A type       | an entry of that type or of one of its kinds                                         | the type's stable ID      |
| An interface | an entry of any member, kinds of members included (`featured`: many Featurable)      | the interface's stable ID |
| Any entry    | an entry of any collection or single type on the site (`spotlight`: one of anything) | `*`                       |

Populated, each target comes in its own shape with its own `__model`, so a site renders a BlogPost, a Guide,
and the About page side by side. In the admin, the picker searches across the member types, with a filter by
type and the type shown on each result.

Widening a relation's target keeps its values: from a type to an interface the type implements, from an
interface to a wider one, or from anything to Any entry. It is still a **breaking** change, because the API
returns a different shape. Narrowing a target (Featurable back to BlogPost) clears the field's values, a
**destructive** change you acknowledge.

**Leaving an interface never drops values.** While a relation to Featurable holds an entry of RoadmapItem,
removing Featurable from RoadmapItem's **Implements**, or deleting RoadmapItem, is refused with the number of
references (`RELATION_VALUES_EXIST`). Remove those references first (or keep the interface), then apply.

**What Shapio refuses, and why.**

| Refusal                    | Why                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNKNOWN_INTERFACE`        | `implements` names an interface that doesn't exist                                                                                                    |
| `INVALID_INTERFACE`        | `implements` names something that is not an interface, a component or an interface implements one, or a site's interface has a member on another site |
| `INTERFACE_FIELD_MISSING`  | a member lacks a contract field; the message names the field and the interface (`"title" is required by Featurable`)                                  |
| `INTERFACE_FIELD_MISMATCH` | a member's field doesn't match the contract field; the message says what differs                                                                      |
| `INVALID_INTERFACE_FIELD`  | a contract field is a component or a dynamic zone, is unique, or is a slug that names a source field                                                  |
| `HAS_MEMBERS`              | you deleted an interface that types still implement: remove it from their **Implements** first                                                        |
| `RELATION_VALUES_EXIST`    | a type would leave an interface (or be deleted) while a relation to the interface holds its entries; the message counts them                          |

An interface that a relation targets can't be deleted either: point the relation somewhere else first.

## What a change does

Saving a model runs Shapio's change planner. It compares the new definition with the active one, classifies
every difference, shows you the impact before you confirm, runs any checks it needs, and only then activates the
new version, atomically. If a check fails, the old version stays active and content stays usable.

| You change                                                                                            | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label, description, help text, field order, form layout                                               | live at once                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| An editor for a compatible one                                                                        | live at once; no content is converted                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Add an optional field, a model or a component                                                         | live at once                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Make a field required, or add a required field                                                        | checks existing entries first; a `defaultValue` fills them, otherwise entries missing the value block activation (the plan lists them)                                                                                                                                                                                                                                                                                                                                      |
| Tighten validation (shorter max length, fewer enum values, …)                                         | re-validates existing values before activation                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Make a field unique, or change the type of a unique field                                             | checks existing values for duplicates (under the new type's rules) first                                                                                                                                                                                                                                                                                                                                                                                                    |
| Make a field filterable or sortable                                                                   | builds its index in the background (no table lock), then activates                                                                                                                                                                                                                                                                                                                                                                                                          |
| Change a field's type                                                                                 | live when the stored form stays the same (`string` → `text`); otherwise an explicit conversion with validation; when Shapio can't convert, the values are dropped: a **destructive** change you acknowledge, and old snapshots keep the old values in storage but show them as `null`. A multi-value `enum` stores a list, so changing it to any other type drops its values, and text changed to a multi-value `enum` becomes a one-value list checked against the choices |
| Change an API ID or plural API ID, hide a field (`public` off, `deprecated`), delete a field or model | **breaking**: an API contract change you must acknowledge                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Turn off `localized` on a field or model, or turn off drafts                                          | **destructive** conversion: you must acknowledge that values in other locales (or drafts) are dropped                                                                                                                                                                                                                                                                                                                                                                       |
| Add or change a field on a type with kinds                                                            | applies to every kind: checks run over every kind's entries, and indexes are built for each kind                                                                                                                                                                                                                                                                                                                                                                            |
| Give a type a parent, move it under another one, or take its parent away                              | **breaking**, like an API ID change; fields it loses that hold values are dropped (**destructive**)                                                                                                                                                                                                                                                                                                                                                                         |
| Implement an interface                                                                                | live at once: the type joins the interface's list and GraphQL interface                                                                                                                                                                                                                                                                                                                                                                                                     |
| Stop implementing an interface                                                                        | **breaking**: clients reading the interface lose the type; refused while a relation to the interface holds its entries                                                                                                                                                                                                                                                                                                                                                      |
| Add a field to an interface, or turn on one of its flags                                              | accepted only when every member complies; the review offers to add a missing field to the members                                                                                                                                                                                                                                                                                                                                                                           |

Deleting a field keeps its stored values (they are no longer returned); deleting a model hides its entries,
which come back if you restore it. Rolling a model back to an earlier version is a metadata change: it never
undoes a data conversion that already ran.

A model's history (`GET /api/admin/models/{id}/revisions`, and `/api/admin/components/{id}/revisions`) lists
every version with `status`, the outcome of the change that wrote it (`activated`, `pending`, `running`,
`failed` or `canceled`), and `active`, true for the version in use. A `failed` or `canceled` version never
went live, so rolling back to it would repeat a change that already failed its checks.

Checks never touch stored content: they run on the values as they would be, and the conversion or backfill is
written only when the new version activates, in the same transaction. Writes to the model wait for that rewrite
(up to about 1.5 seconds for 7,000 entries); reads continue.

Two people editing the same model cannot overwrite each other: every save carries the version you started
from, and a stale save is refused with a conflict (reload, reapply, save).

All of this also applies to `shapio schema apply`, which goes through the same planner.

## How many filterable and sortable fields

Every field marked `filterable` or `sortable` gets its own index on Shapio's content table. The index only covers
its own model's entries, but PostgreSQL still checks every one of these indexes whenever any entry is saved,
so each indexed field adds a little to every save, whichever model is being saved. Measured with PostgreSQL 18 on
a laptop (Apple M-series), adding 50 models with 5 indexed fields each (250 field indexes):

| Field indexes | Saving one entry's draft in the database | Creating an entry through the API (median) |
| ------------- | ---------------------------------------- | ------------------------------------------ |
| none          | 0.09 ms                                  | 3.5 ms                                     |
| 50            | 0.19 ms                                  | 3.6 ms                                     |
| 250           | 0.61 ms                                  | 4.0 ms                                     |

So each indexed field costs about 2 µs per save. With a few hundred you will not notice it; beyond about 500,
measure your own write load before adding more. Reads are unaffected: a query only uses the indexes of the
model it reads. A new model's indexes are built in the background, one at a time, right after it is saved
(about 0.1 s per model on an empty model). Mark only the fields your sites actually filter or sort on.

## Content from a new model

1. Models → New model: shape (collection or single type), label, API ID (and, for a collection, the plural
   API ID); add fields.
2. Save. The model is listed under Content at once.
3. Create an entry, Save, Publish.
4. Give your site's delivery role `read` on the model (Network → Roles), or grant the public app role read
   access if anonymous visitors should read it ([End users](end-users.md)).

Next: [Content](content.md), [Delivery API](delivery-api.md).
