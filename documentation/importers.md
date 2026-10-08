# Moving from WordPress or Strapi

`shapio import wordpress` and `shapio import strapi` bring a site's content over from WordPress or Strapi 5:
content types become models, posts and documents become entries, uploads move into the media library. Nothing
goes live by itself. Every entry is created as a **draft**. The ones that were published in the old system are
collected into a [change set](change-sets.md) that you review and ship.

An import has two steps, with a schema apply between them:

1. **Plan** (`--plan <dir>`) reads the export and writes the models it proposes as ordinary
   [schema files](schema-sync.md) into `<dir>/schema` (the primary site's folder, `sites/default/`, unless you
   say otherwise: see below), plus `<dir>/import-map.json`. It runs offline: it needs no URL or token and sends
   nothing anywhere, unless you pass `--url` to check the planned names against your instance (see below).
2. **Review and apply** the files, like any schema change:
   `shapio schema apply --dir <dir>/schema --lock <dir>/schema-lock.json`. You can rename API IDs, labels and
   descriptions, or delete fields you don't want, before applying. Or copy the files into your project's
   `schema/` and apply them with the rest of your schema.
3. **Map** (`--map <dir>`) runs against the instance. It uploads the media, creates every entry as a draft
   (referenced entries first), then opens the change set(s) and prints their links.

```sh
npx @shapio/cms import wordpress export.xml --plan ./import
npx @shapio/cms schema apply --dir ./import/schema --lock ./import/schema-lock.json
npx @shapio/cms import wordpress --map ./import --url https://cms.example.com --token "$SHAPIO_TOKEN"
```

`schema apply` and `--map` take the usual remote-command options: `--url` (or `SHAPIO_URL`), `--token` (or
`SHAPIO_TOKEN`), and `--site <key>` (or `SHAPIO_SITE`). The token is an admin API token (Settings → API tokens)
with the admin or owner role: it creates the models, entries and media and manages change sets. Run the commands
from the folder that holds the export: `npx @shapio/cms` works anywhere (inside a project made by `create-shapio`,
`npx shapio` is the same command).

**Names already on the instance.** With `--url` (and `--token`, or `SHAPIO_TOKEN`), `--plan` reads the models
and components the planned site can already see (the shared ones and the site's own) and checks every planned
API ID, plural API ID, and GraphQL name against them. A planned model or component that would clash gets the
`Item` suffix, numbered if that is taken too (`seoItem`, `seoItem2`), and `--plan` prints one line for each
rename, such as "Component seo is named seoItem (the target already has seo)." A renamed collection's plural API
ID is derived from its new API ID. Only `--url` turns the check on: `SHAPIO_URL` alone keeps the plan offline.
For a `--shared` plan, the names are checked against the primary site's view, and `--plan` notes that other
sites' own models and components were not checked. Without `--url`, `--plan` prints "Names were not checked
against a target: pass --url and --token to --plan, or rename clashes in the schema files before applying."

```sh
npx @shapio/cms import strapi my-export.tar.gz --plan ./import --url https://cms.example.com --token "$SHAPIO_TOKEN"
```

**Which site the models belong to.** The planned models belong to one [site](sites.md): the one `--site <key>`
(or `SHAPIO_SITE`) names, else the primary site (key `default`). On an instance with one site, that is the only
site, so the commands above need no `--site` and work with an ordinary admin token. The plan records the site,
so `--map` without `--site` imports into it, and a `--map --site` that names another site is refused.

- **Another site of a multi-site instance:** plan with `--site <key>`. The files go in
  `<dir>/schema/sites/<key>/` and `--plan` prints the apply and map commands with `--site <key>`.
- **Models shared with all sites:** plan with `--shared`. The files go in the shared folders
  (`<dir>/schema/models/` and `components/`), and applying them needs a **network** admin token (Settings → API
  tokens, _Works on_: _Every site (network token)_); a token of one site is refused with `FORBIDDEN_SCOPE` and
  nothing is applied.

## What happens to your edits and re-runs

- **Entries follow stable IDs, not names.** The plan gives every model and field a stable ID, and `--map` finds
  fields through those IDs in the live schema. Renaming an API ID before (or after) applying is fine. A field you
  deleted is not imported.
- **`--map` refuses until the models exist**, and says which ones are missing and what to run.
- **Re-running `--map` resumes.** Every upload, entry and change set item is recorded in `import-map.json` as
  soon as it is done. A re-run skips finished work and retries what failed, so run it again after fixing a
  problem (a missing locale, a file that would not download). A re-run must use the same `--site`. It refuses
  if the export file changed since it was planned.
- **One gap:** if `--map` is killed in the instant between creating an entry and recording it, a re-run
  creates that one entry again. Delete the duplicate draft if it happens.
- **`--plan` never overwrites an import that has started.** To start over, plan into a new directory.
  `--force` replaces an earlier plan whose map step never ran (with new IDs).

## Review: the change set

Entries that were **published** at the source become `publish` items of an open change set titled
"Import from WordPress" (or Strapi). Entries that were **drafts** there are created as drafts and left out of
the set; the summary counts them. Open the printed link (Develop → Changes) to review the import field by
field, then ship it: everything goes live as one snapshot.

A set holds at most 2,000 items. Larger imports open numbered sets ("Import from WordPress (1/3)", …) that
you ship one after another.

Every planned model has draft and publish on, even when the source model did not, so an import is always
reviewable (`--plan` says which models this changes).

## WordPress

Export from **Tools → Export → All content** in WordPress (a WXR `.xml` file).

```sh
npx @shapio/cms import wordpress export.xml --plan ./import
npx @shapio/cms import wordpress --map ./import [--media-dir ./wp-content/uploads]
```

| WordPress             | Shapio                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Posts                 | `post` (`posts`): title, slug, body (rich text), excerpt, date, cover (featured image), author, categories, tags |
| Pages                 | `page` (`pages`): title, slug, body, date, cover, parent (page)                                                  |
| Authors (`wp:author`) | `author` (`authors`): name, slug, email (not public: never served by the delivery API)                           |
| Categories            | `category` (`categories`): name, slug, description, parent (category)                                            |
| Tags                  | `tag` (`tags`): name, slug, description                                                                          |
| Attachments           | media library assets, with alt text and caption                                                                  |

- Models are only planned for what the export contains (no `page` model without pages).
- **Status:** `publish` → in the change set; `draft`, `pending`, `private` and `future` (scheduled) → drafts.
  Trash, auto-drafts, revisions, menu items and custom post types are skipped and listed by `--plan`.
- **Dates** use the post's GMT date. Slugs are converted to Shapio's form (lower-case ASCII words and hyphens,
  accents and percent-encoding decoded) and made unique per model.
- **Bodies** are converted from HTML to Shapio rich text. Classic-editor content gets paragraphs the way
  WordPress renders them. Block-editor content keeps its markup and its block comments are dropped.
  `[caption]` becomes an image followed by its caption. Other shortcodes (`[gallery]`, `[embed]`, plugin
  shortcodes) stay as literal text and are counted in the summary. Underline, strike-through, colours and
  inline styles are dropped (the text stays). Iframes, video and audio embeds are dropped and counted.
- **Images** in a body are matched to their attachment, including WordPress's resized copies
  (`photo-300x200.jpg` → `photo.jpg`). Images on other hosts are downloaded and imported too. An image that
  cannot be fetched is left out of the body and reported.
- **Media** are downloaded from the attachment URLs in the export. If the old site is offline, copy its
  `wp-content/uploads` directory and pass it as `--media-dir`: files are read from there by their path below
  `uploads/`. Downloads are kept in `<dir>/media`, so a re-run does not fetch them again.
- **Links** stay as they are, so links to the old site still point at it. Unsafe links (`javascript:`) and
  relative links that are not root-relative keep their text and lose the link.
- Not imported: comments, custom fields (post meta other than the featured image and alt text), menus, widgets,
  users' passwords, custom post types and taxonomies.

## Strapi 5

Export with `strapi export` in the Strapi project. An encrypted export needs the key it was made with:

```sh
npx strapi export --file my-export            # encrypted: prompts for a key
npx @shapio/cms import strapi my-export.tar.gz.enc --plan ./import --key "<the key>"
npx @shapio/cms import strapi --map ./import
```

Exports made with `--no-encrypt` (and `--no-compress`) need no key. `strapi export` adds the extensions itself:
`my-export.tar.gz.enc` by default, `my-export.tar.gz` with `--no-encrypt`, `my-export.tar` with both flags.
`--plan` unpacks the export into `<dir>/source`, which `--map` reads, so the key is only needed once. Keep the
export file where it was until the import is done: `--map` checks that it has not changed, and refuses if it
cannot read it.

Only **Strapi 5** exports are supported. A Strapi 4 export is refused: upgrade the project first
(`npx @strapi/upgrade major`), then export again.

| Strapi                             | Shapio                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Collection type / single type      | collection / single type (API ID from the singular name, plural kept)   |
| Component                          | component (API ID from its name; `category.name` when two names repeat) |
| Dynamic zone                       | dynamic zone                                                            |
| `string`, `text`, `email`          | `string`, `text`, `email`                                               |
| `uid`                              | `uid` (unique)                                                          |
| `integer`, `biginteger`, `decimal` | same type                                                               |
| `float`                            | `number`                                                                |
| `date`, `time`, `datetime`         | same type; `timestamp` → `datetime`                                     |
| `boolean`, `json`                  | same type                                                               |
| `enumeration`                      | `enum`; values that are not valid API names make it a `string` field    |
| `blocks`                           | rich text                                                               |
| `richtext` (Markdown)              | rich text (converted through HTML)                                      |
| `media`                            | `media` (single or multiple, allowed kinds kept)                        |
| `relation`                         | `relation` (`one` or `many`) on the owning side                         |
| Custom fields                      | their underlying type                                                   |

- **Documents and locales:** each document becomes one entry. A localized content type becomes a localized
  model: fields Strapi localizes (and relations and UIDs, as Strapi does) are localized, the rest are shared.
  Each locale takes the content of its draft. A locale published in Strapi goes into the change set, and
  draft-only locales stay drafts. The locales must exist on the instance (Settings → Locales): `--map` refuses
  and names any that are missing.
- **Relations:** the owning side of a two-way relation is imported, and the inverse side (`mappedBy`) is
  skipped. Shapio answers that direction with a filter on the owning field. Relations that form a cycle (an
  author's best article that points back at the author) are written in a second pass. Polymorphic relations
  and relations to Strapi's users or admin users are skipped.
- **Names:** an attribute whose name is reserved in Shapio (`status`, `version`, …) gets a suffix
  (`statusField`), and so does a content type or component (`shared.media` and `shared.rich-text` in Strapi's
  example project become `mediaItem` and `richTextItem`). `--plan` lists every rename.
- **Code:** Strapi has no code type. A long text field that holds a snippet or an embed code can become a
  `code` field: in its planned schema file, set `"type": "code"`, `"settings": { "language": "html" }` (or the
  language it holds) and `"editor": { "id": "codeEditor", "options": {} }`, and clear `filterable` and
  `sortable` if set, before applying. Its values import unchanged.
- **Validation** (required, min/max length and value, regex) is not carried over, because Strapi 5 drafts may
  not satisfy it. Add the rules you want to the schema files before or after applying.
- **Markdown** is converted through HTML. Constructs with no rich-text equivalent degrade to text: strike-through
  loses its mark, raw HTML is unwrapped, and footnotes and task lists become plain paragraphs and lists.
  **Blocks** map directly. Underline and strike-through lose their mark, and images resolve to the imported
  uploads.
- **Media:** every upload file in the export is imported from the archive, with its alternative text and
  caption. Generated formats (thumbnails) are not imported: Shapio makes its own variants.
- Not imported: passwords, users and roles (users-permissions or admin), API tokens, plugin content types,
  configuration, and review workflows.
- Strapi support is tested against real Strapi 5.56 exports: Strapi's blog example (components, dynamic
  zones, uploads) extended with two locales, blocks, Markdown, enumerations and a many-to-many relation, and a
  project of 1,050 documents. If an export of yours does not import correctly, please open an issue with the
  output of `--plan` (and, if you can, a small export that shows the problem).

## Limits

- The summary of `--map` lists everything that was not imported or was changed on the way: images that could
  not be fetched, embeds and shortcodes, references to skipped entries, and failures with their error. The exit
  code is non-zero while anything failed.
- A plan made without `--url` does not know the instance's names: an existing model or component with the same
  API ID as a planned one (say your instance already has `author`, or the shared `seo` component) makes
  `schema apply` refuse. Plan again with `--url` and `--token`, or rename the planned API ID in its file, then
  apply. A plan made with `--url` can still clash if someone adds a model with a planned name before you apply.
- A large import takes a while: every entry is one request, and the instance's rate limit is waited out
  automatically (about 1,000 entries in three minutes at the default `RATE_LIMIT_MAX` of 600 a minute). The
  limit counts per client address, so while `--map` runs, the admin opened from the same address can answer
  `RATE_LIMITED` for up to a minute. Wait for the import to finish, or raise `RATE_LIMIT_MAX` for its duration.
