# SQLite

Shapio runs on PostgreSQL or on SQLite. SQLite keeps the whole instance in one file next to your project. You
need no database server, backups are one command, and a small site or a local trial is running in a minute.
Everything works the same way on both: modelling live, drafts and publishing, snapshots, change sets, sites,
end users, REST and GraphQL.

The difference is scale. A SQLite instance is **one process** on one machine. Use PostgreSQL when you want
several instances behind a load balancer, a separate worker process, or many editors writing at the same time.
You can move from SQLite to PostgreSQL later (see below).

## Use it

Set `DATABASE_URL` to `sqlite:` followed by a file path, relative to the working directory or absolute:

```dotenv
DATABASE_URL=sqlite:./shapio.db
```

Shapio creates the file and runs its migrations on start (or with `shapio migrate`). Keep the file on a local
disk. Network file systems (NFS, SMB) do not lock SQLite files reliably.

The directory must be writable: next to `shapio.db`, SQLite keeps `shapio.db-wal` and `shapio.db-shm` while
Shapio runs. They are part of the database. Copy or delete the database only through `shapio backup` (below)
or with Shapio stopped.

`sqlite::memory:` starts an empty in-memory database that disappears when the process exits. It is useful for
quick experiments only.

### Docker

The image needs no change. Keep the database file in a volume:

```yaml
services:
  shapio:
    image: ghcr.io/mybrokengnome/shapio:latest
    environment:
      DATABASE_URL: sqlite:/data/shapio.db
      PUBLIC_URL: https://cms.example.com
    volumes:
      - shapio-data:/data
volumes:
  shapio-data:
```

A named volume at `/data` starts with the image's `/data` (owned by the container's `node` user, uid 1000), so
Shapio can write the database there, and media go to `/data/media` in the same volume. If you bind-mount a host
directory instead, make it writable by uid 1000. Drop the `postgres` service from `docker-compose.yml` when
you use SQLite.

This Docker setup has not been tested yet: CI builds the image, but no run starts it on SQLite.

## Limits

- **One process.** Run one Shapio process per database file. `WORKER_MODE=dedicated` is refused: the job
  worker runs inside the API process (`WORKER_MODE=inline`, the default). Two processes on one file would not
  share schema-change notifications, locks or the job queue's coordination. Short `shapio` commands that open
  the file while the server runs (`shapio migrate`, `shapio admin create`, `shapio backup`) are fine.
- **One writer at a time.** Writes are serialised inside the process, and reads run alongside them. Each SQL
  statement runs synchronously on Node's event loop, so a very large export or import makes other requests
  wait while it runs.
- **Timestamps have millisecond precision** (PostgreSQL keeps microseconds). They are stored as UTC text,
  `2026-10-03T12:34:56.789Z`, so text order is time order. Pagination cursors are only valid on the instance
  that issued them.
- **UUIDs are case-sensitive.** PostgreSQL compares UUIDs without regard to case. On SQLite they are text, and
  Shapio always writes them in lowercase. Send IDs as Shapio returned them; an uppercased ID finds nothing.
- **Case folding.** Case-insensitive matching (`$containsi`, email lookups) folds Unicode as JavaScript's
  `toLowerCase` does, the same on both databases. Shapio adds the functions its schema needs (`lower`, `upper`,
  `regexp`, `shapio_now`, …) to every connection. Open the file with another SQLite client to read it, not to
  write it.
- **Indexes.** Filterable and sortable fields get B-tree indexes as on PostgreSQL. Equality filters do not use
  PostgreSQL's JSON containment index, which SQLite does not have, so on a large model they use the field index
  when the field is filterable and scan otherwise.

## Back up

`shapio backup <file>` writes a consistent copy of the running database to a new file (SQLite's
`VACUUM INTO`). It does not stop Shapio, and writes wait only for the moment of the copy:

```sh
npx shapio backup backups/shapio-$(date +%F).db
tar -czf media-$(date +%F).tar.gz -C /srv/my-cms media
```

Back up the database before the media, as with PostgreSQL ([Backup and restore](backup-restore.md)). To
restore, stop Shapio, put the copy where `DATABASE_URL` points (delete any `-wal` and `-shm` files next to the
old file) and start Shapio again.

## Move to PostgreSQL

Move content with [`shapio export` and `shapio import`](backup-restore.md#content-export-and-import), which
work over HTTP and do not care which database either side uses:

1. Start a second Shapio on PostgreSQL (an empty database), create its owner and an admin API token.
2. Export every site from the SQLite instance, with media and history:
   `npx shapio export --url http://old:4300 --token shp_… --site <key> --with-media --include-users site.tar`
3. Import each bundle into the PostgreSQL instance:
   `npx shapio import --url http://new:4300 --token shp_… --site <key> site.tar`
4. Recreate what bundles leave out: admin accounts, API tokens and webhook and deployment secrets.
5. Point your sites at the new instance.

## For contributors

The SQLite driver, its value codec and the dialect rules are in `apps/api/src/db/` (ADR 0001, "Dialect
boundary"). The integration suite runs on SQLite with `TEST_DATABASE_URL=sqlite:` (temporary files) or
`sqlite:<directory>`. Tests that cannot run there are listed, each with its reason, in
`apps/api/test/helpers/dialect.ts`. Migrations follow the twin rule in [CONTRIBUTING.md](../CONTRIBUTING.md).

Shapio keeps SQLite's query planner statistics (`sqlite_stat1`) up to date itself. The writer connection runs
`PRAGMA optimize=0x10002` when it opens and after migrations, then `PRAGMA optimize` every 10 minutes between
write transactions (`db/sqlite/driver.ts`). Both are usually no-ops; they analyze a table only when it has
never been analyzed or its size changed a lot. Without statistics SQLite reads every head of a model to
serve a page of the default newest-first list, instead of reading the entries index in order. A connection
loads statistics only when it opens, so when they change the driver reopens its reader connections: idle
ones at once, ones inside a transaction when it ends.
