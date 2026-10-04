# MySQL

Shapio runs on PostgreSQL, MySQL or SQLite. On MySQL everything works as on PostgreSQL: modelling live, drafts
and publishing, snapshots, change sets, sites, end users, REST and GraphQL. You can run several Shapio
instances on one MySQL database, and a separate worker process (`WORKER_MODE=dedicated`).

**Supported:** MySQL 8.4 LTS, which CI tests. MySQL 8.0.23 and later should work but are untested (8.0 reached
end of life in April 2026). MariaDB is not supported: it lacks the collation, column and JSON features
Shapio's SQL uses, and Shapio refuses to start on it.

## Use it

Create a database and a user for Shapio, then point `DATABASE_URL` at it:

```sql
create database shapio character set utf8mb4 collate utf8mb4_0900_bin;
create user 'shapio'@'%' identified by 'a-long-random-password';
grant all privileges on shapio.* to 'shapio'@'%';
```

```dotenv
DATABASE_URL=mysql://shapio:a-long-random-password@localhost:3306/shapio
```

Shapio runs its migrations on start (or with `shapio migrate`). Every table declares its own character set and
collation, so the database default does not matter, but the one above keeps tools that create tables by hand
consistent.

### Binary logging and triggers

MySQL turns binary logging on by default. With it on, MySQL only lets a user with the SUPER privilege create
triggers, unless `log_bin_trust_function_creators` is 1. Shapio's first migration creates three triggers
(content history is immutable; deleting a media folder clears it from its assets). If the migration stops with
"MySQL refused to create a trigger because binary logging is on", either:

- set `log_bin_trust_function_creators = 1` (on Amazon RDS, Azure or Google Cloud SQL: in the instance's
  parameter group or flags), then run `shapio migrate` again, or
- run `shapio migrate` once as a user with SUPER, then start Shapio with its own user.

MySQL creates tables outside transactions, so a migration that fails part-way leaves the tables it already
created. On a new database, drop its tables (or the database) before you retry.

### Docker

`docker compose -f docker-compose.mysql.yml up -d` starts Shapio with a MySQL 8.4 container (set
`MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD` in `.env` first). For your own MySQL server, set `DATABASE_URL`
and drop the `mysql` service. This setup has not been tested yet: CI runs the integration suite on MySQL, but
no run starts the image with this file.

## How MySQL differs

These differences are deliberate; ADR 0001 ("MySQL") explains each.

- **Filterable and sortable fields: at most 56 per instance.** MySQL allows 64 indexes on a table and has no
  partial indexes, so every filterable or sortable field of every model is one index on the same content
  table. The cap counts the models of every [site](sites.md) together, shared and site-owned: with several
  sites, one site's filterable fields use up room the others then lack. Shapio refuses a model change that would
  need more, with a message naming the field. Clear "filterable" or "sortable" on fields that do not need them.
- **Text filters and sorts use the first 255 characters.** Equality with a longer value still compares the
  whole text. Two values that share their first 255 characters sort in an arbitrary order.
- **Numbers compare as double precision**, exact to about 15 significant digits. Decimal and big integer
  fields (stored as text in JSON) compare as `DECIMAL(65,30)`: exact up to 35 digits before the point and 30
  after it.
- **Text is case-sensitive and sorts by code point** (`utf8mb4_0900_bin`): "Zebra" sorts before "apple". Case
  insensitive matching (`$containsi`, search, email addresses) uses MySQL's Unicode `LOWER()`.
- **Sorting on a field** reads the matching rows and sorts them (MySQL puts missing values first; Shapio keeps
  PostgreSQL's order, missing values last ascending), instead of reading an index in order. Filters still use
  the field's index.
- **Field index builds do not block writes** (`ALGORITHM=INPLACE, LOCK=NONE`), but each one waits for a moment
  when no transaction is using the content table. It waits at most 10 seconds, so a long-running transaction
  cannot stall the table behind it; the build job then retries.
- **Schema-change notifications between instances** arrive within a quarter of a second: MySQL has no
  LISTEN/NOTIFY, so each instance polls a small table. Instances notice changes they make themselves at once.

## Back up

Use `mysqldump` (`shapio backup` only copies SQLite databases):

```sh
mysqldump --single-transaction --routines --triggers --set-gtid-purged=OFF \
  -h db -u shapio -p shapio > shapio-$(date +%F).sql
```

`--single-transaction` takes a consistent snapshot without locking tables. Back up the database before the
media, as described in [Backup and restore](backup-restore.md). To restore, load the dump into an empty
database with `mysql shapio < shapio-….sql` (the triggers need the privilege described above).

## Move between databases

[`shapio export` and `shapio import`](backup-restore.md#content-export-and-import) work over HTTP and do not
care which database either side uses. The steps in [SQLite](sqlite.md#move-to-postgresql) apply to MySQL too.

## For contributors

The MySQL driver, its plugin and statement plans are in `apps/api/src/db/mysql/` (ADR 0001, "MySQL"), the
content dialect in `apps/api/src/content/compiler/dialect/mysql.ts`. Run the integration suite on MySQL with
`TEST_DATABASE_URL=mysql://root@127.0.0.1:3306/` (test databases are created beside it); set
`TEST_POSTGRES_URL` too to compare the MySQL baseline with the PostgreSQL migrations. Tests that cannot run on
MySQL are listed, each with its reason, in `apps/api/test/helpers/dialect.ts`. Migrations follow the twin rule
in [CONTRIBUTING.md](../CONTRIBUTING.md).
