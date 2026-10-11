# Modelling

A content model describes the shape of some content: a page, an article, a product. In Shapio models are
**data**, versioned in the database, not code. You create and change them in the admin (Models) or from schema
files with `shapio schema apply` ([Schema sync](schema-sync.md)), while the server runs. Shapio never generates
a route, a class or a table per model: one generic API serves every model, so a change is live as soon as it is
saved. No rebuild, no restart, no deploy.

## Kinds of definitions

| Kind            | What it is                                                               | API                                                                               |
| --------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **Collection**  | Many entries: articles, products, authors                                | `/api/content/<pluralApiKey>` lists, `/api/content/<pluralApiKey>/<id>` reads one |
| **Single type** | Exactly one entry: the home page, site settings                          | `/api/content/<apiKey>` reads it                                                  |
| **Component**   | A reusable group of fields embedded in models, never addressed by itself | inside the entries that use it                                                    |

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
attributes (`id`, `locale`, `status`, `version`, `createdAt`, `updatedAt`, `publishedAt`, …).
With several sites these checks run in each site's view (its own definitions and the shared ones): two sites
may each have a `post`, but a shared definition cannot take an API ID that any site uses.

## Field types

The stored **data type** and the **editor** that renders it are separate choices: you can switch a boolean from
a toggle to a checkbox, or a string to a colour picker, live, without touching data.

| Data type                  | Stored as                          | Editors                                         | Notes                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `string`                   | text                               | `textInput`, `textarea`, `color`                | min/max length, pattern                                                                                                                                                                                           |
| `text`                     | text                               | `textarea`                                      | long plain text                                                                                                                                                                                                   |
| `code`                     | text, exactly as written           | `codeEditor`                                    | head snippets, embed codes, JSON configs, template fragments; `language` (plain, html, css, javascript, json, yaml, markdown), min/max length, `validate` (JSON must parse); never unique, filterable or sortable |
| `richtext`                 | versioned JSON document            | `richText`                                      | headings, lists, links, quotes, code, images, tables; delivered as JSON, or sanitised HTML with `richText=html`                                                                                                   |
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
can still be granted those fields explicitly (Network → Roles).

## What a change does

Saving a model runs Shapio's change planner. It compares the new definition with the active one, classifies
every difference, shows you the impact before you confirm, runs any checks it needs, and only then activates the
new version, atomically. If a check fails, the old version stays active and content stays usable.

| You change                                                                                            | Effect                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label, description, help text, field order, form layout                                               | live at once                                                                                                                                             |
| An editor for a compatible one                                                                        | live at once; no content is converted                                                                                                                    |
| Add an optional field, a model or a component                                                         | live at once                                                                                                                                             |
| Make a field required, or add a required field                                                        | checks existing entries first; a `defaultValue` fills them, otherwise entries missing the value block activation (the plan lists them)                   |
| Tighten validation (shorter max length, fewer enum values, …)                                         | re-validates existing values before activation                                                                                                           |
| Make a field unique, or change the type of a unique field                                             | checks existing values for duplicates (under the new type's rules) first                                                                                 |
| Make a field filterable or sortable                                                                   | builds its index in the background (no table lock), then activates                                                                                       |
| Change a field's type                                                                                 | live when the stored form stays the same (`string` → `text`); otherwise an explicit conversion with validation, or refused when Shapio cannot convert it |
| Change an API ID or plural API ID, hide a field (`public` off, `deprecated`), delete a field or model | **breaking**: an API contract change you must acknowledge                                                                                                |
| Turn off `localized` on a field or model, or turn off drafts                                          | **destructive** conversion: you must acknowledge that values in other locales (or drafts) are dropped                                                    |

Deleting a field keeps its stored values (they are no longer returned); deleting a model hides its entries,
which come back if you restore it. Rolling a model back to an earlier version is a metadata change: it never
undoes a data conversion that already ran.

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

1. Models → New model: kind, label, API ID (and, for a collection, the plural API ID); add fields.
2. Save. The model is listed under Content at once.
3. Create an entry, Save, Publish.
4. Give your site's delivery role `read` on the model (Network → Roles), or grant the public app role read
   access if anonymous visitors should read it ([End users](end-users.md)).

Next: [Content](content.md), [Delivery API](delivery-api.md).
