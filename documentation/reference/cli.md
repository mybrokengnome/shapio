# CLI reference

<!-- Generated from the `shapio` command definitions by `pnpm docs:reference`. Do not edit by hand. -->

One command, `shapio`, ships with the `@shapio/cms` npm package (and the Docker image). Run it with `npx shapio`
in a project made by `create-shapio`, or `docker compose exec shapio node node_modules/@shapio/cms/dist/cli.js` in
the container. `shapio help` lists the commands.

- **Server commands** run on the machine that runs Shapio: they read its environment variables (and a `.env`
  in the working directory) and talk to its database directly.
- **Remote commands** talk to a running instance over HTTP, never to its database. They take `--url` (default
  `$SHAPIO_URL`, else `http://localhost:4300`, including any `BASE_PATH`) and `--token` (default
  `$SHAPIO_TOKEN`): an admin API token from Settings → API tokens. They work from a laptop or CI.

Variables only the CLI reads:

| Variable | Used by | Meaning |
| --- | --- | --- |
| `SHAPIO_URL` | remote commands | The instance to talk to. |
| `SHAPIO_TOKEN` | remote commands | An admin API token. |
| `SHAPIO_ADMIN_PASSWORD` | `shapio admin create` | The new admin’s password; without it one is generated and printed once. |

## Server commands

### shapio start

Run the API server (and the inline worker unless WORKER_MODE=dedicated).

```text
shapio start
```

### shapio worker

Run the job worker as its own process (for WORKER_MODE=dedicated).

```text
shapio worker
```

### shapio migrate

Apply pending database migrations, then exit.

```text
shapio migrate
```

### shapio backup

Copy a SQLite database to a new file while Shapio runs (backup <file>; PostgreSQL uses pg_dump, MySQL mysqldump).

```text
shapio backup <file>
```

### shapio healthcheck

Exit 0 if this host's Shapio answers /api/ready (for Docker HEALTHCHECK and process monitors).

```text
shapio healthcheck
```

### shapio version

Print the Shapio version.

```text
shapio version
```

### shapio admin

Create an admin account directly in the database (admin create --email ...).

```text
shapio admin create --email <email> [--name <name>] [--role <role key, default owner>]
  The password is read from SHAPIO_ADMIN_PASSWORD; without it a strong one is generated and printed once.
```

### shapio media

Move stored media between local disk and S3 (media migrate --from local --to s3).

```text
shapio media migrate --from <local|s3> --to <local|s3> [--delete-source]
  Copies every asset and its variants to the other storage, verifies checksums and switches each asset
  over in its own transaction, while the server keeps running. Safe to interrupt and re-run.
  Needs MEDIA_PATH and the STORAGE_S3_* settings. Afterwards set STORAGE_DRIVER to the new driver.
```

### shapio mcp

Print the configuration that connects Claude Code, Cursor, Claude Desktop or any MCP client through @shapio/mcp.

```text
shapio mcp [--url <Shapio URL>] [--client claude-code|cursor|claude-desktop|generic] [--allow-ship] [--site <key>]
  Prints the MCP client configuration for @shapio/mcp. The URL defaults to SHAPIO_URL, then
  PUBLIC_URL + BASE_PATH. --site sets SHAPIO_SITE (multi-site instances; default: the token's site, else
  the primary site). --client generic prints the stdio server definition any MCP client takes.
  Create an admin API token whose role has no "changes.ship" and paste it in place
  of the placeholder: agents prepare change sets, people ship them.
```

### shapio sites

List or create sites directly in the database (sites list | sites create --key ... --name ...).

```text
shapio sites list
shapio sites create --key <key> --name <name>
  Lists or creates sites directly in the database (sites share the schema, admins and roles; each has its
  own content, media, tokens and snapshots). Keys are lower case and fixed once created.
```

### shapio extensions

Validate shapio.config and list its hooks, routes, services, jobs and editors (extensions check).

```text
shapio extensions check
  Loads shapio.config (SHAPIO_CONFIG_PATH, else the working directory), validates it and lists its hooks,
  routes, services, jobs and editors. Exits 1 on any problem. Needs no database.
```

## Remote commands

### shapio status

Check that a Shapio instance is ready and show its version.

```text
shapio status [--url <origin>]   (defaults to $SHAPIO_URL or http://localhost:4300)
```

### shapio schema

Sync models and components with schema files: pull | diff | apply.

```text
shapio schema <pull|diff|apply> [options]
```

```text
Usage:
  shapio schema pull [--url <origin>] [--token <admin token>] [--dir schema] [--lock .shapio/schema-lock.json] [--force]
      Write the instance’s models and components to schema files and the lock file
  shapio schema diff [--url <origin>] [--token <admin token>] [--dir schema] [--lock .shapio/schema-lock.json] [--prune]
      Show what `shapio schema apply` would change on the instance (dry run)
  shapio schema apply [--url <origin>] [--token <admin token>] [--dir schema] [--lock .shapio/schema-lock.json] [--prune] [--allow-breaking] [--allow-destructive] [--no-wait] [--wait-timeout <s>]
      Apply local schema files to the instance live (three-way, per model; refuses on conflicts)
```

### shapio types

Generate TypeScript types from the active schema: generate.

```text
shapio types generate [options]
```

```text
Usage:
  shapio types generate [--url <origin>] [--token <admin token>] [--out shapio-types.ts]
      Write TypeScript types for the instance’s models and components
```

### shapio export

Export schema, locales, roles, content and media metadata to a bundle file (--with-media: tar with files).

```text
shapio export [--url <origin>] [--token <admin token>] [--site <key>] [--with-media] [--heads-only] [--include-users] <file>
  Exports one site's content (--site or SHAPIO_SITE; default: the token's site, else the primary site).
```

### shapio import

Import a bundle, or a WordPress or Strapi export (import wordpress|strapi).

```text
shapio import [--url <origin>] [--token <admin token>] [--site <key>] [--dry-run] [--prune] [--no-wait] <file>
  Plans the import (--dry-run stops there) and refuses it, writing nothing, on any conflict.
  An import never changes an existing model: a model the target has in another form is a conflict.
  Reconcile the schema first: `shapio schema pull` from the target, merge the bundle's models into the
  files (git diff), `shapio schema apply`, then import again.
  --site (or SHAPIO_SITE) names the site the bundle goes to; default: the token's site, else the primary.

shapio import wordpress <export.xml> --plan <dir> [--force]
       shapio import wordpress --map <dir> [--url <origin>] [--token <admin token>] [--site <key>] [--media-dir <uploads dir>]
  --plan reads the export and writes the planned models (<dir>/schema) and <dir>/import-map.json; it sends nothing.
  Apply the models with `shapio schema apply --dir <dir>/schema --lock <dir>/schema-lock.json`, then run --map:
  it uploads the media (downloaded from the site, or read from --media-dir, a copy of wp-content/uploads),
  creates every post and page as a draft, and opens change sets with the published ones. Re-run --map to resume.

shapio import strapi <export.tar.gz[.enc]> --plan <dir> [--key <encryption key>] [--force]
       shapio import strapi --map <dir> [--url <origin>] [--token <admin token>] [--site <key>]
  --plan unpacks the export into <dir>/source (--key for an encrypted export) and writes the planned models
  and components (<dir>/schema) and <dir>/import-map.json; it sends nothing. Apply the schema with
  `shapio schema apply --dir <dir>/schema --lock <dir>/schema-lock.json`, then run --map: it uploads the
  media, creates every document as a draft and opens change sets with the published ones. Strapi 5 only.
```
