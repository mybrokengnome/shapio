# Local development

How to work on Shapio itself. To build a site or app _with_ Shapio, install it ([npm](install-npm.md) or
[Docker](install-docker.md)) instead.

## Requirements

- Node.js 24 or later, and pnpm through Corepack: `corepack enable`.
- PostgreSQL 16 or later running locally. On macOS with Homebrew: `brew services start postgresql@18`.

## Set up

```sh
git clone https://github.com/mybrokengnome/shapio.git
cd shapio
cp .env.example .env
```

In `.env`, point `DATABASE_URL` at a database for development and `TEST_DATABASE_URL` at a maintenance
database on the same server (the tests create and drop their own databases beside it):

```dotenv
DATABASE_URL=postgres://you@localhost:5432/shapio_dev
TEST_DATABASE_URL=postgres://you@localhost:5432/postgres
```

To work on SQLite instead, use `DATABASE_URL=sqlite:./shapio-dev.db` and run the integration suite with
`TEST_DATABASE_URL=sqlite:` ([SQLite](sqlite.md#for-contributors)). For MySQL 8.4, use a `mysql://` URL and
`TEST_DATABASE_URL=mysql://root@127.0.0.1:3306/` ([MySQL](mysql.md#for-contributors)).

```sh
createdb shapio_dev
pnpm install
pnpm db:migrate
pnpm dev
```

`pnpm dev` runs the API from source on <http://localhost:4300> (restarting on changes) and the admin's Vite
dev server on <http://localhost:5173/admin/>, which proxies `/api` to the API. The API logs where to create
the first admin ([First admin](first-admin.md)). Its link points at port 4300, which serves the admin only
after `pnpm build`; in development open <http://localhost:5173/admin/> instead.

## Everyday commands

| Command                                      | Does                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm dev`                                   | API and admin with reload                                                   |
| `pnpm lint`, `pnpm format`, `pnpm typecheck` | ESLint, Prettier, TypeScript (every package)                                |
| `pnpm test`                                  | unit tests (packages, API, admin)                                           |
| `pnpm test:integration`                      | API tests against real PostgreSQL (`TEST_DATABASE_URL`)                     |
| `pnpm build`                                 | every package and the admin bundle (not the site starters)                  |
| `pnpm db:migrate`, `pnpm db:rollback`        | run or undo every migration on `DATABASE_URL`                               |
| `pnpm db:codegen`                            | regenerate `apps/api/src/db/types.ts` from the database (after a migration) |
| `pnpm docs:reference`                        | regenerate the [reference pages](reference/environment.md)                  |
| `pnpm smoke:npm`                             | pack the npm packages, install them in a temporary directory and start them |

The [site starters](starters.md) in `examples/` read `@shapio/client` and `@shapio/visual` from their builds, as a project installed
from npm does: run `pnpm build` (or just `pnpm --filter "@shapio/client..." --filter "@shapio/visual" build`) before building one.

Running the CLI from source: `cd apps/api && node --conditions=@shapio/source --import tsx src/cli.ts <command>`
(it reads `.env` from the working directory, so export the repository's `.env` values first, e.g.
`set -a; . ../../.env; set +a`).

## The repository

```text
apps/api            the server and the `shapio` command (published as `shapio`)
apps/admin          the admin single-page app (built into the `shapio` package)
packages/schema     @shapio/schema: model definitions, validators, diff, schema file format
packages/client     @shapio/client: typed HTTP client for every API
packages/cli        the remote commands (schema, export/import, types), bundled into `shapio`
packages/editor-sdk @shapio/editor-sdk: the custom field editor contract
packages/visual     @shapio/visual: visual editing for sites (field attributes, the preview-frame script)
packages/create-shapio  the project scaffolder (CMS projects, and the site starters packed from examples/)
examples/astro      site starter: Astro (see the example site walkthrough)
examples/next       site starter: Next.js App Router
examples/sveltekit  site starter: SvelteKit
examples/shared     what the starters share: model files, seed, HTTP smoke check
documentation       these pages
```

## VS Code

The repository recommends extensions (ESLint, Prettier, Tailwind CSS, Vitest, EditorConfig) and ships launch
configurations: **API: dev**, **Admin: dev**, **Full stack: dev** (both), **Vitest: current file** and
**Vitest: all**, plus tasks for `dev`, `build`, `lint` and `typecheck`. Formatting on save uses the
repository's Prettier and ESLint settings.

Conventions for changes (code style, migrations, tests) are in [CONTRIBUTING.md](../CONTRIBUTING.md).
