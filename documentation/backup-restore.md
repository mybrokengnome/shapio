# Backup and restore

A Shapio instance is two things: its **PostgreSQL database** (models, content and history, users, settings,
the job queue) and its **media files** (local `MEDIA_PATH`, or an S3/R2 bucket). Back up both, the database
first. Also keep your project files (`shapio.config.ts`, `extensions/`) in version control, back up `.env`
somewhere safe (never commit it: it holds `SESSION_SECRET` and the database password).

Keep `SESSION_SECRET` with the backup if you set one: webhook secrets, deploy hook URLs and provider tokens are
stored encrypted with a key derived from it, and app-user sessions and signed media URLs depend on it (without
`SESSION_SECRET`, the secret is generated once and kept in the database, so the database backup carries it).

## Back up

```sh
pg_dump --format=custom --file=shapio-$(date +%F).dump "$DATABASE_URL"
tar -czf media-$(date +%F).tar.gz -C /srv/my-cms media
```

Dump the database **before** copying media: an upload stores its file before the database row that refers to
it, so a media copy taken after the dump holds every file the dump refers to (and perhaps a few newer ones,
which are harmless). Neither step needs downtime: `pg_dump` reads one consistent moment.

With S3 or R2, turn on bucket versioning or copy the bucket on a schedule (`rclone sync`, `aws s3 sync`).

With Docker Compose:

```sh
docker compose exec -T postgres pg_dump -U shapio --format=custom shapio > shapio-$(date +%F).dump
docker compose run --rm --no-deps --user root -v "$PWD":/backup --entrypoint tar shapio \
  -czf /backup/media-$(date +%F).tar.gz -C /data media
```

(`--user root` lets `tar` write into your directory; the image otherwise runs as the unprivileged `node` user.)

## Restore

1. Stop Shapio.
2. Restore the database into an empty one owned by Shapio's database role (as a superuser: `createdb -O`),
   and the media files where `MEDIA_PATH` points:

   ```sh
   createdb -O shapio shapio_restored
   pg_restore --no-owner --dbname "postgres://shapio@localhost:5432/shapio_restored" shapio-2026-10-02.dump
   mkdir -p /srv/my-cms && tar -xzf media-2026-10-02.tar.gz -C /srv/my-cms
   ```

3. Point `DATABASE_URL` at it and start Shapio. If the backup is older than the Shapio version you run, its
   migrations run on start ([Upgrades](upgrades.md)).
4. Check: `npx shapio status`, sign in, open a few entries and media, read the delivery API.

With Docker Compose, restore into the compose volumes (this replaces their contents):

```sh
docker compose stop shapio
docker compose exec -T postgres dropdb -U shapio --if-exists shapio
docker compose exec -T postgres createdb -U shapio shapio
docker compose exec -T postgres pg_restore -U shapio --no-owner --dbname shapio < shapio-2026-10-02.dump
docker compose run --rm --no-deps --user root -v "$PWD":/backup --entrypoint sh shapio \
  -c 'rm -rf /data/media/* && tar -xzf /backup/media-2026-10-02.tar.gz -C /data && chown -R node:node /data/media'
docker compose start shapio
```

The test suite checks this procedure end to end (`apps/api/test/backupRestore.int.test.ts`): a dump and a
media archive restored into a fresh database serve the same content, media and signed URLs.

Restore into a scratch database from time to time; a backup you have not restored is a hope, not a backup.

## Content export and import

`shapio export` and `shapio import` move content between instances over HTTP, without database access: from
staging to production, into a fresh install, or as a portable backup. They need an owner or admin API token.

```sh
npx shapio export --url https://cms.example.com --token shp_… --with-media content.tar
npx shapio import --url https://new.example.com --token shp_… --dry-run content.tar
npx shapio import --url https://new.example.com --token shp_… content.tar
```

### What a bundle holds

An NDJSON file (one JSON record per line): the schema (every model and component, as `schema pull` writes them,
plus a lock), locales, app roles and custom delivery roles with their grants, media folders and media metadata with each file's key, size
and SHA-256, and every entry with its full revision history and its draft and published versions in every
locale. IDs and timestamps are kept, so an import into an empty instance answers the delivery API (REST and
GraphQL) exactly like the source.

| Option            | Effect                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `--with-media`    | writes a tar archive with the bundle and every media file, checked against its checksum                       |
| `--heads-only`    | only the current draft and published versions, not the whole history                                          |
| `--include-users` | also app users (end users) with their role assignments and OAuth links; passwords only as their argon2 hashes |

Never in a bundle: admin accounts, sessions, API tokens (create new delivery and admin tokens on the
target; the imported delivery roles are there to bind them to), webhook and deployment secrets. Webhooks and
deployment connections are exported without their secrets (only `${ENV:…}` references travel) and are imported
**disabled**: enter their secrets and enable them. Imported webhooks get a new signing secret, which import
prints once.

> **An import never changes an existing model.** If the target has a model or component in another form
> than the bundle, the import is refused, with that model listed as a conflict. Reconcile the schema first,
> then import again:
>
> 1. `shapio schema pull --url <target> --token <token>` into a git working copy of your schema files;
> 2. bring the bundle's model definitions in (export the source's with `shapio schema pull` too, and merge
>    with `git diff`/`git merge`), or decide to keep the target's;
> 3. `shapio schema apply --url <target> --token <token>` (live, through the planner);
> 4. `shapio import` again.
>
> Content is then validated against the target's models as they are.

### How an import decides

`import` first asks the target for a **plan** (that is all `--dry-run` does) and prints it:

```text
Locales: 1 added (fr), 0 changed, 1 unchanged
Models and components: 8 added (article, hero, page, feature, gallery, callToAction, featureGrid, author), 0 unchanged, 0 conflicting
App roles: 0 added, 0 updated, 2 unchanged
Delivery roles: 1 added, 0 updated, 0 unchanged, 0 conflicting (tokens are never imported: create new ones)
App users: 0 added, 0 unchanged, 0 conflicting
Webhooks: 0 added (disabled, new secrets), 0 unchanged
Deployment connections: 0 added (disabled; enter their secrets), 0 unchanged
Media: 0 folders and 7 assets added, 0 unchanged, 0 conflicting
Entries: 6 added, 0 updated, 0 unchanged, 0 conflicting
  article: 3 added, 0 updated, 0 unchanged, 0 conflicting
  page: 2 added, 0 updated, 0 unchanged, 0 conflicting
  author: 1 added, 0 updated, 0 unchanged, 0 conflicting
No conflicts.
```

Everything is matched by stable ID:

- **Models**: missing ones are created with their IDs (live, through the same planner as the admin); identical
  ones are skipped. A model the target has in a different form is a **conflict**: an import never changes an
  existing model. Reconcile the schemas first with [`shapio schema pull`/`apply`](schema-sync.md).
- **Entries**: missing ones are _added_. One whose draft and published versions are all versions the bundle
  knows (in its history, without newer autosaved edits) is _updated_ to the bundle's state. One the target has
  edited since, that belongs to another model, or that was deleted on the target is a **conflict**.
- **Delivery roles**: matched by key; missing ones are created and changed ones updated to the bundle's
  grants. A key the target uses for an admin role is a conflict.
- **Media**: missing assets are added after their file is checked against the manifest's checksum and size; an
  asset the target replaced or deleted is a conflict.
- **App users** (with `--include-users`): missing accounts are added; an email another account already uses is
  a conflict.

**Any conflict refuses the whole import before anything is written**, like a rejected `schema apply`; the
plan lists each one. Importing the same bundle again finds everything unchanged and does nothing.

`--prune` also deletes the target's entries (of the models in the bundle) that the bundle does not have.
Entries other entries still point at are kept and reported.

### Running it

The instance-wide part (locales, models, roles, publishing settings, folders) is applied by the request; the
content then imports as a **job**: resumable from its last checkpoint after a restart, idempotent, with its
progress (phase and counts) is reported by the CLI. `shapio import` follows it to the end (`--no-wait` returns
at once) and exits non-zero if any item could not be imported, listing why.

Media files:

- From a `--with-media` archive, `import` uploads each file the target lacks before the job starts; the server
  verifies each against its checksum and size.
- From a plain bundle, the files must already be in the target's storage under the same keys (the same
  bucket, or a copy of `MEDIA_PATH`); the job checks each one and reports any that are missing.

Image variants are rendered again on the target. Imports do not run lifecycle hooks or send webhooks; trigger a
deployment afterwards if a site should rebuild. Imported revisions keep their content and dates; their author
shows as the import.

A bundle is plain JSON lines: you can inspect it, and keep it as a portable backup next to your database dumps.
