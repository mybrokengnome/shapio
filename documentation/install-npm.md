# Install with npm

Shapio is one npm package, `shapio`: the server, the prebuilt admin and the `shapio` command. `create-shapio`
sets up a project around it. You run it with Node.js, under PM2 or systemd, against your PostgreSQL. No
reverse proxy is needed (see [Networking](networking.md)).

## Requirements

- Node.js 24 or later (`node --version`).
- PostgreSQL 16 or later, with a database Shapio owns.
- A Linux or macOS host. Shapio runs as one process (the API with its job worker inside); see
  [a separate worker](#a-separate-worker-process) to split them.

## 1. Create a database

As a PostgreSQL superuser:

```sh
psql -d postgres -c "create role shapio login password 'change-me'"
createdb -O shapio shapio
```

Shapio creates and migrates its own tables on start. Your content models never get tables of their own, so
modelling never runs a migration.

## 2. Create the project

```sh
npx create-shapio@latest my-cms --database-url postgres://shapio:change-me@localhost:5432/shapio
cd my-cms
```

This writes:

| File                                      | What it is                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `package.json`                            | depends on `shapio`; scripts `start`, `migrate`, `worker`, `status`                             |
| `.env`                                    | the configuration (every setting is an environment variable), with a generated `SESSION_SECRET` |
| `shapio.config.ts`                        | code extensions: hooks, routes, services, jobs, custom editors ([Extensions](extensions.md))    |
| `extensions/`, `media/`                   | extension code, and uploaded files (local storage)                                              |
| `ecosystem.config.cjs`                    | a PM2 process file                                                                              |
| `.env.example`, `.gitignore`, `README.md` | a commented copy of the settings, git ignores for `.env` and `media/`, and next steps           |

Without `--database-url`, edit `DATABASE_URL` in `.env`. Before you put it on the internet, set `PUBLIC_URL`
to the address people will use, for example `https://cms.example.com`, and `HOST=0.0.0.0` so other machines
can reach it (the default, `127.0.0.1`, answers on this machine only). Every link Shapio builds (media,
previews, emails, OAuth callbacks) starts with it. All settings: [environment variables](reference/environment.md).

## 3. Start it

```sh
npm run start
```

Shapio migrates the database, then logs where to create the owner account. Logs are JSON lines in
production; look for this `msg`:

```text
No admin account yet. Open http://localhost:4300/admin/ to create the owner account.
```

The last startup line summarises the instance, e.g. `Shapio 0.1.0 running at http://localhost:4300/ (mode
production, storage local, worker inline, tls off)`.

Open that address and create the first owner ([First admin](first-admin.md)). The first person to complete
Setup becomes the owner; if the server is reachable by others before you get there, set
`SETUP_REQUIRE_TOKEN=true` (Setup then needs a one-time token from the log) or run `npx shapio admin create`
first. Check the
instance from another terminal:

```sh
npx shapio status
```

```text
http://localhost:4300: ready (shapio <version>, node v24.19.0)
```

## 4. Keep it running with PM2

```sh
npm install --global pm2
pm2 start ecosystem.config.cjs
pm2 logs my-cms
pm2 save
pm2 startup
```

The process file runs one instance in fork mode; a commented cluster variant runs two (see
[Several instances](#several-instances)). `pm2 startup` prints the command that starts PM2 at boot.

To apply a configuration change or install a new extension: `pm2 restart my-cms`. Modelling never needs it.

## Or with systemd

Create `/etc/systemd/system/shapio.service` (adjust the user and the directory):

```ini
[Unit]
Description=Shapio
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=shapio
WorkingDirectory=/srv/my-cms
ExecStart=/usr/bin/node node_modules/shapio/dist/cli.js start
Restart=on-failure
# Shapio drains requests and jobs on SIGTERM (SHUTDOWN_TIMEOUT_MS, 10 s by default).
TimeoutStopSec=30
# Uncomment to listen on ports 80/443 directly (HTTPS without a proxy) without running as root.
# AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now shapio
journalctl -u shapio -f
```

`shapio` reads `.env` from its working directory; variables set in the unit (`Environment=`) win over it.

## A separate worker process

Jobs (scheduled publishing, webhooks, deployments, image variants, imports) run inside the API process by
default. To run them in their own process, set `WORKER_MODE=dedicated` in `.env` and start a second process
with the same `.env` and project files:

```sh
npm run worker
```

With PM2, add a second app to `ecosystem.config.cjs` with `args: 'worker'`.

## Next

- [Networking](networking.md): your domain and HTTPS without nginx.
- [Modelling](modelling.md): your first model.
- [Backup and restore](backup-restore.md) and [Upgrades](upgrades.md).

## Several instances

Any number of Shapio processes can share one database, on one machine (PM2 cluster mode) or several behind a
load balancer. They coordinate through PostgreSQL: migrations run once, schema changes and permission changes
apply on every instance's next request (even without notifications, `SCHEMA_LISTEN=false`), jobs such as
scheduled publishes and image variants run exactly once, and GraphQL is rebuilt on each instance after a
change. The test suite runs two server processes against one database to prove it.

- **Workers:** either keep `WORKER_MODE=inline` on every instance, or set `WORKER_MODE=dedicated` everywhere
  and run one or more `shapio worker` processes. Both are fine.
- **HTTPS:** terminate it at the load balancer, or give every instance the same
  `TLS_CERT_FILE`/`TLS_KEY_FILE`; each reloads renewed files on its own.
- **Rate limits are counted per process**, so N instances allow up to N times `RATE_LIMIT_MAX` in total. For
  strict limits, put a shared limiter (your load balancer, or Cloudflare) in front.
- **Media:** with the local driver every instance needs the same `MEDIA_PATH` (a shared volume); S3-compatible
  storage needs nothing extra.
- Set the same `SESSION_SECRET` on every instance (or leave it unset everywhere: the generated one is stored
  in the database and shared).
