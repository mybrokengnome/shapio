# Contributing to Shapio

Thanks for helping. This page covers how the code is organised, the rules every change follows, how tests run
and how to add a migration. Setting up a development environment: [local development](documentation/local-development.md).

## The rules that matter most

These are why Shapio exists; a change that breaks one is wrong however clean it looks.

1. **Content models change live.** Creating or changing a model never writes source files, generates code,
   alters tables with locks, or needs a rebuild, restart or deploy. (Upgrading Shapio and installing executable
   extensions are the only things that may need a restart.)
2. **Models are data, not code.** Routes are generic (`/api/content/:modelKey`) and resolve the model through
   the registry at request time. Never add a route, controller, class or table per model.
3. **Schema sync is git-like, with a version guard, never a lock.** Every schema change is a new version;
   `schema apply` goes through the same planner as the admin.
4. **Stable IDs everywhere**, separate from labels and API keys. API keys are valid GraphQL names.
5. **The server is the enforcement layer**: validation, permissions and schema consistency live in the backend.
6. **Public delivery never leaks** drafts, private media or unreadable fields.
7. **No mandatory telemetry or hosted account.** Anything that sends data off the server is opt-in.

## Code organisation

```text
apps/api/src
  routes/        Fastify plugins: URLs, JSON schemas (TypeBox), hooks. Nothing else.
  controllers/   read the request, call a service, shape the reply. No business logic or queries.
  services/      business logic. No request/reply objects.
  repositories/  data access to Shapio's own tables (Kysely). No business logic.
  content/       content storage: validator, query compiler, revisions, transfer (export/import)
  schema/        registry, planner, codegen (OpenAPI, TypeScript, GraphQL)
  permissions/ jobs/ media/ deployments/ webhooks/ publishing/ appAuth/ email/ tls/ extensions/ plugins/
  reference/ helpers/ constants/ db/
```

Each layer only calls the one below it. Services take an optional Kysely executor so writes compose in one
transaction; writes that must be atomic with an event (a publish and its outbox row, an activation and its
audit row) happen in **one** transaction.

- TypeScript everywhere, strict. Named exports only (configuration files that tools require excepted).
- Every route declares schemas for `params`, `querystring`, `body` and `response`; every mutating route declares
  `config.audit` (startup fails otherwise).
- Errors: services throw `AppError` (status, code, message); the central handler renders
  `{ error: { code, message, details? } }`. Never swallow an error; log with context through `request.log`
  or the app logger, never `console`.
- SQL: through Kysely's portable API. Database-specific SQL lives only in `apps/api/src/db/` (migrations, locks,
  notifications and the named primitives in `db/sql/`) and `content/compiler`, with `sql` tags, never
  interpolated identifiers or values. Everywhere else, use a `db/sql` primitive (add one there, with its
  PostgreSQL, SQLite and MySQL forms and the contract every dialect keeps) instead of writing SQL;
  `db/dialectBoundary.test.ts` enforces this. On SQLite a selected computed column (an aggregate, a `coalesce`)
  has no type, so wrap it in a `db/sql/typed.ts` marker (`asTimestamp`, `asJson`, …); the SQLite test run fails
  on a timestamp or JSON column that needs one. MySQL computes comparisons as integers: mark a selected boolean
  expression with `asBoolean`. MySQL has no `RETURNING` and no `ON CONFLICT`: write them as on PostgreSQL;
  `db/mysql/` plans them for Shapio's tables (listed in `db/mysql/tables.ts`). User content values are JSONB keyed by stable field IDs and queried through the compiler's
  allowlist.
- Configuration: environment variables, declared once in `apps/api/src/config/schema.ts` and validated at
  start; never read `process.env` elsewhere. Run `pnpm docs:reference` after changing it.
- Absolute URLs only through `helpers/publicUrl.ts` (`PUBLIC_URL` + `BASE_PATH`).
- A function past about 100 lines wants splitting; the third copy of something wants one shared function.

Admin (`apps/admin`): React function components, one per file (`ComponentName/index.tsx`), props types declared
above the component, logic in hooks (`hooks/useX.ts`) and helpers. Tailwind only, with the semantic tokens
(`bg-background`, `text-muted-foreground`), never raw colours; `cn()` for conditional classes; every screen
works in light and dark mode. Every user-facing string goes through react-i18next; only
`src/locales/en/translation.json` is edited by hand. TanStack Query for server state, Zustand for client
state. Field editors need keyboard support, visible focus, labels, inline errors and loading/empty states.

## Features and refactors are separate pull requests

A pull request either adds or changes behaviour, or restructures code without changing behaviour. Not both:
each is easier to review, test and revert on its own.

## Tests

- `pnpm test` runs the unit tests (packages, API helpers, the admin).
- `pnpm test:integration` runs the API against a **real PostgreSQL** (`TEST_DATABASE_URL`, a maintenance
  database such as `postgres`). A template database is migrated once; each test file gets its own copy. Do not
  mock the database: transactions, locks and concurrency are what these tests prove.
- `TEST_DATABASE_URL=sqlite: pnpm test:integration` runs the same suite on SQLite (temporary files), and
  `TEST_DATABASE_URL=mysql://root@127.0.0.1:3306/` on MySQL 8.4 (databases created beside it; add
  `TEST_POSTGRES_URL` to compare the MySQL baseline with PostgreSQL). A test that cannot run on one of them goes
  in the skip list in `apps/api/test/helpers/dialect.ts`, with its reason; raw SQL in tests uses that file's
  helpers.
- `pnpm --filter @shapio/admin e2e` drives the built admin with Playwright (see `apps/admin/README.md`).
- `pnpm smoke:npm` packs and installs the npm packages and starts them.
- The site starters (`examples/astro`, `examples/next`, `examples/sveltekit`) have their own check: build the
  packages (`pnpm build`), seed a local Shapio once (`pnpm --filter example-astro seed`, then copy its `.env`
  to the other two), then build each starter and run its `smoke` against the built site
  ([Site starters](documentation/starters.md)).

Add tests with every change: unit tests next to the code (`*.test.ts`), integration tests in
`apps/api/test/*.int.test.ts`. Before opening a pull request:

```sh
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm test:integration
```

CI runs lint, format, typecheck and the unit tests on Node 24, the integration tests on Node 24 and 26 against
PostgreSQL 16 and 18 and on Node 24 against SQLite, and also the admin end-to-end suite (on PostgreSQL and on
SQLite), the Docker build, the npm smoke test and the
site starters.

## Adding a migration

Migrations are for Shapio's own tables only, never for user content models.

1. Add `apps/api/src/db/migrations/<YYYYMMDDHHMMSS>_<description>.ts` exporting `up` and a working `down`.
   The timestamp orders migrations; take the current time (it is adjusted when the change merges if another
   migration landed first).
2. Register it in `apps/api/src/db/migrations/index.ts` (a static list, so the bundled server finds it).
3. `pnpm db:migrate`, then `pnpm db:codegen` to regenerate `apps/api/src/db/types.ts`, and commit both. Never
   edit `types.ts` by hand, and never edit a migration that has run anywhere: add a new one.
4. Check that it rolls back: `pnpm db:rollback && pnpm db:migrate`.
5. Twin it for SQLite (`apps/api/src/db/migrations/sqlite/index.ts`) and MySQL
   (`apps/api/src/db/migrations/mysql/index.ts`), under the same name. A migration that only uses Kysely's
   portable schema builder exports `dialectNeutral = true` and is listed there as the same module; any other
   gets its own file in each folder. `migrations/twins.test.ts` fails until the lists match, and
   `test/sqliteBaseline.int.test.ts` and `test/mysqlBaseline.int.test.ts` compare the schemas. A new MySQL table
   also goes in `db/mysql/tables.ts` (the baseline test checks it).

Indexes on large tables are built `CONCURRENTLY` by jobs, not in migrations that hold locks.

## Dependencies

Versions are pinned in the pnpm catalog (`pnpm-workspace.yaml`). A new dependency needs a reason, a
permissive licence compatible with redistribution, and, if it runs install scripts, review and an entry in
`allowBuilds`.

## Documentation

User-facing changes update `documentation/`. Commands in the docs must work as written; the reference pages in
`documentation/reference/` are generated (`pnpm docs:reference`) and a test fails when they drift.
