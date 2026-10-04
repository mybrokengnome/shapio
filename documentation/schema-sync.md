# Schema sync

Models live in the database of each instance, and every environment can be edited live in the admin,
production included. To keep environments in step and review changes in git, Shapio syncs models with JSON
files the way git syncs commits: **pull**, edit, **apply**, and a rejected apply when the target moved under
you. Nothing is ever locked by default.

All the `shapio schema` commands talk to an instance over HTTP with an admin API token (Settings → API tokens), never to its
database. Give them `--url` and `--token`, or set `SHAPIO_URL` and `SHAPIO_TOKEN`.

## Pull

```sh
export SHAPIO_URL=https://cms.example.com SHAPIO_TOKEN=shp_…
npx shapio schema pull
```

```text
Pulled 8 definition(s) of site "default" at schema version 12 into schema
```

This writes one canonical JSON file per model and component (sorted keys, stable IDs, every default spelled
out, so diffs are clean): the ones shared with all sites in `schema/models/<apiKey>.json` and
`schema/components/<apiKey>.json`, the site's own in `schema/sites/<siteKey>/models/` and
`schema/sites/<siteKey>/components/` (see [Several sites](#several-sites)). It also writes
`.shapio/schema-lock.json`, which records the version, hash and site of every definition as pulled. Commit
both.
`--dir` and `--lock` change the paths. Pull refuses to overwrite files you edited and have not applied, unless
you pass `--force`.

## Edit

Change the files (or change a local instance in its admin and pull from it). A new file may leave out IDs; the
instance assigns them on apply and rewrites the file in canonical form.

## Diff and apply

```sh
npx shapio schema diff     # what apply would do; changes nothing
npx shapio schema apply
```

```text
model article: update
    + field subtitle
Applied 1 definition(s) at schema version 13.
```

Apply goes through the same change planner as the admin ([Modelling](modelling.md#what-a-change-does)): checks,
background index builds, atomic activation, no restart. It waits for planned changes to activate
(`--no-wait` to return at once, `--wait-timeout <seconds>`, default 600), then updates the lock file and the
files it applied.

### Three-way, per model

For each model, apply compares three versions: the **base** (the lock file), your **file**, and the
**target**'s active definition.

| Your file vs base   | Target vs base | Apply                                                                              |
| ------------------- | -------------- | ---------------------------------------------------------------------------------- |
| unchanged           | anything       | skips it. A change made in production since your pull is **kept**, never reverted. |
| changed             | unchanged      | applies it, guarded by the target's current version                                |
| changed             | changed        | **refuses** and shows both sides, like a rejected push                             |
| identical to target |                | already applied: skips it                                                          |

Any conflict refuses the whole apply and writes nothing:

```text
SCHEMA_SYNC_CONFLICT: The target schema changed since your last pull for some definitions you also changed. Pull, reconcile and apply again.
model article: conflict: changed locally AND on the target since your last pull
    ~ label: "Article" → "Journal article"
    ~ description: "Changed in production" → (unset)
Commit your files, run `shapio schema pull --force`, reconcile with git, then apply again.
```

Commit your files, `shapio schema pull --force` (it overwrites them with the target's definitions and records
the new base), use `git diff` to bring your change back on top of the target's, commit, and apply again.

### Breaking, destructive and deletions

- Changes that break API clients (an API ID or plural API ID change, hiding a field, deleting a field) need
  `--allow-breaking`; destructive conversions need `--allow-destructive`.
- Deleting a file does nothing on the target unless you pass `--prune`. With `--prune`, a model whose file you
  deleted is deleted on the target (guarded the same way: refused if the target changed it since your pull).

### Pull again after upgrading

A newer Shapio can add a property to model definitions and fill it on existing models when it reads them (for
example the plural API ID of collections, `pluralApiKey`). The definitions your instance serves then differ from
the files you pulled with the older version, so their hashes no longer match your lock file, and an apply of
files you also edited is refused as a conflict. After upgrading, run `shapio schema pull` (with `--force` if
you have local edits: commit them first and bring them back with `git diff`), commit, and apply from there.
Applying an older file that only lacks the new property is not a change: it gets the same filled value.

## Several sites

Each site owns its content types; a content type can also be shared with all sites
([Sites](sites.md)). The schema commands work on one site's view at a time: its own definitions and the shared
ones. `--site <key>` (or `SHAPIO_SITE`) names the site; without it they use the token's site, else the primary
site.

```text
schema/
  models/                 shared with all sites
  components/
  sites/
    blog/models/          the blog site's own
    shop/models/          the shop site's own
.shapio/schema-lock.json  every definition's version, hash and site, and the sites the tree covers
```

- `shapio schema pull --site blog` writes the shared folders and `sites/blog/`. It replaces only the lock entries
  of those, and removes stale files only there, so pulling `blog` and then `shop` into one tree keeps both.
- `shapio schema apply --site blog` sends the shared files and `sites/blog/`, never another site's, and its base
  holds only those definitions: `--prune` cannot delete another site's content types. A tree pulled for other
  sites only is refused (`LOCK_SITE_MISMATCH`): pull the site into it first.
- A file's folder decides where a **new** definition is created. Sync never moves an existing one: a file whose
  folder disagrees with the instance (it was shared or kept on one site in the admin meanwhile, or you moved
  the file) is refused with `SCOPE_MISMATCH`. Pull to get the instance's layout.
- Changing a shared definition needs schema permission on every site. A token of one site that applies a tree
  with changed shared files is refused, with each refused definition listed (`FORBIDDEN_SCOPE`), and nothing
  is applied.

To share a site's content type with all sites, or keep a shared one on one site, use `shapio schema scope`,
then pull to move its file:

```sh
npx shapio schema scope post --shared --site blog   # share blog's post with all sites
npx shapio schema scope post --site blog            # keep the shared post on blog only
```

Keeping a shared type on one site is refused while other sites have entries of it (`SCOPE_IN_USE`, with the
number of entries) or while something shared or on another site refers to it. `--version <n>` guards the change
with the version you saw (default: the version the command reads first).

A lock written before per-site schemas (format 1) still works: all its definitions are shared, and it applies
to every site. The next pull rewrites it in format 2. An old `shapio` CLI, or a tree without `sites/`, creates
new definitions shared, as before.

## A typical flow

1. Model in a local or staging instance, or edit the JSON.
2. `shapio schema pull` from it, commit, open a pull request.
3. On merge, CI runs `shapio schema apply` against production:

   ```yaml
   # .github/workflows/schema.yml
   on:
     push:
       branches: [main]
       paths: ['schema/**', '.shapio/schema-lock.json']
   jobs:
     apply:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v5
         - uses: actions/setup-node@v5
           with: { node-version: 24 }
         - run: npx --yes shapio schema apply
           env:
             SHAPIO_URL: ${{ vars.SHAPIO_URL }}
             SHAPIO_TOKEN: ${{ secrets.SHAPIO_TOKEN }}
   ```

4. An editor changes a model directly in production? Equally valid: CI's next apply skips that model (unchanged
   in git), or refuses if git changed it too, until someone pulls and reconciles.

## Apply, the admin and change sets

`shapio schema apply` activates each changed definition directly, through the change planner, as soon as its
checks pass. It does not create a [change set](change-sets.md).

In the admin, every schema edit goes through a change set. The builder's **Review in a change set** and the
**Schema as code** page (Develop → Schema) save your edits as drafts of an open change set; they go live when the
set ships, in the same snapshot as the entries it publishes. The builder's **Ship now** ships the edit at once
as a one-item change set. The Schema-as-code page reads and writes the same canonical files and makes the same
three-way check against the instance as `apply` (refusing when a definition changed on both sides), so files
edited there and files pulled with the CLI round-trip.

## Git as a mirror (GitHub write-back)

To get production's live changes into git automatically, add a **GitHub** connection under Publishing →
Deployments: owner, repository, branch, `commit` or `pull_request` mode, the directory (`schema` by default)
and a token that can write contents (and pull requests). After each schema change Shapio commits the same files
`schema pull` writes, plus the lock file, to that branch, or opens a pull request from `shapio/schema-sync`.
Bursts of changes coalesce into one commit. Git mirrors production; it never locks it.

## Optional: a read-only lock

Teams that want production changed only through `apply` can turn on the lock. The admin then shows models but
refuses changes to them (`423 SCHEMA_READ_ONLY`); `shapio schema apply` keeps working. It is off by default and
needs the `schema.create` permission:

```sh
curl -X PUT "$SHAPIO_URL/api/admin/schema/settings" \
  -H "Authorization: Bearer $SHAPIO_TOKEN" -H 'Content-Type: application/json' \
  -d '{"readOnly": true, "readOnlyReason": "Change models through git"}'
```

Send `{"readOnly": false}` to lift it.

## Content, too

Schema sync moves models only. To move or back up content, use [`shapio export` and `shapio import`](backup-restore.md#content-export-and-import).
