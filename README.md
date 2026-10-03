# Shapio

Shapio is an open-source, self-hosted headless CMS and API platform. You model content (pages, articles,
products, anything) in its admin **while it runs in production**: models are versioned data, not code, so adding
a field or a model never needs a rebuild, a restart or a deploy. Editors get finished field controls, rich text,
media, localization, revisions and scheduling; your sites and apps read published content over REST and
GraphQL, and your own users can sign up and write content under the permissions you set.

Models also live in git when you want them to: `shapio schema pull` and `apply` sync them with JSON files,
live, with a per-model version guard instead of a lock.

**Version control for content.** Every publish is a numbered snapshot that stays readable, so a site build pins
one moment and asks what changed since its last build. Schema edits and entry drafts go into **change sets**,
reviewed like a pull request (field-level diffs, the planner's checks, and which API tokens actually read the
fields a breaking change touches) and shipped as one snapshot, with an optional deploy after. Restoring an older
snapshot is a change set too: reviewed, shipped as a new snapshot, nothing deleted.

**Many sites, one instance.** One Shapio can run a fleet of sites with one schema and one login: each site has
its own content, media, snapshots, tokens and end users, and a role can be granted on one site or on all of them.

**Visual editing.** Editors see the site beside the document while they write: clicking a part of the page
focuses its field, and every save re-renders the preview.

**Assist, if you want it.** Connect your own model provider, hosted or running on your own machine, for alt
text, summaries, translations, rewrites and content-type drafts. It is off by default and only ever proposes or
writes drafts into a change set; it never publishes.

Publishing connects to your site's builds with signed webhooks and Cloudflare Pages, Vercel and Netlify
adapters that report real build status. It runs as one Node.js process with PostgreSQL, from npm or Docker,
with HTTPS built in and no reverse proxy, and sends nothing anywhere unless you configure it.

## Quick start

With npm (Node.js 24+ and a PostgreSQL 16+ database):

```sh
npx create-shapio@latest my-cms --database-url postgres://user:password@localhost:5432/shapio
cd my-cms
npm run start
```

With Docker:

```sh
git clone https://github.com/mybrokengnome/shapio.git && cd shapio
docker compose up -d
docker compose logs shapio
```

Either way, open the address in the log (`http://localhost:4300/admin/`) and create the owner account: the
first person to complete Setup becomes the owner. For an install reachable by others before setup, set
`SETUP_REQUIRE_TOKEN=true` (Setup then needs a one-time token from the log) or run `shapio admin create`
first ([First admin](documentation/first-admin.md)).

Shapio 0.1.0 is not on npm or GHCR yet. Until it is, use the Docker steps (they build the image from this
repository) or [develop Shapio](#develop-shapio) from a clone.

## Documentation

- [Documentation index](documentation/README.md)
- Install: [npm, PM2, systemd](documentation/install-npm.md) · [Docker](documentation/install-docker.md) ·
  [networking and HTTPS](documentation/networking.md)
- Use: [modelling](documentation/modelling.md) · [schema sync](documentation/schema-sync.md) ·
  [delivery API](documentation/delivery-api.md) · [GraphQL](documentation/graphql.md) ·
  [change sets, snapshots and restore](documentation/change-sets.md) ·
  [publishing and deployments](documentation/publishing.md) · [sites](documentation/sites.md) · [site starters](documentation/starters.md) ·
  [example site](documentation/example-site.md)
- Run: [backup and restore](documentation/backup-restore.md) · [upgrades](documentation/upgrades.md) ·
  [security](documentation/security.md)
- Reference: [environment variables](documentation/reference/environment.md) ·
  [CLI](documentation/reference/cli.md) · [REST API](documentation/reference/rest-api.md)

## Develop Shapio

```sh
corepack enable             # provides the pinned pnpm version
cp .env.example .env        # set DATABASE_URL and TEST_DATABASE_URL
createdb shapio_dev         # the database DATABASE_URL names must exist
pnpm install
pnpm db:migrate
pnpm dev                    # API on http://localhost:4300, admin dev server on http://localhost:5173/admin/
```

In development, open the admin (and the setup link from the log) on the dev server, `http://localhost:5173/admin/`.

See [local development](documentation/local-development.md) and [CONTRIBUTING.md](CONTRIBUTING.md).
Security issues: [SECURITY.md](SECURITY.md). Changes: [CHANGELOG.md](CHANGELOG.md).

## License

[Apache License 2.0](LICENSE).
