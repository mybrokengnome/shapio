# Install with Docker

The Shapio image runs the same `shapio` package the npm path installs, as a non-root user, with a health check
on `/api/ready`. `docker-compose.yml` in the repository runs it with PostgreSQL 18 and volumes for the
database, media and certificates.

## Requirements

Docker Engine with the Compose plugin (`docker compose version`).

## 1. Get the compose file

Either clone the repository (compose builds the image from source):

```sh
git clone https://github.com/mybrokengnome/shapio.git
cd shapio
```

or copy only `docker-compose.yml` into an empty directory and use the published image
(`ghcr.io/mybrokengnome/shapio`, tagged `latest`, `<major>.<minor>` and `<version>` on each release):

```sh
docker compose pull
```

## 2. Set the database password and your address

Compose reads a `.env` file next to `docker-compose.yml` for its own variables:

```sh
[ -f .env ] || printf 'POSTGRES_PASSWORD=%s\nPUBLIC_URL=http://localhost:4300\n' "$(openssl rand -hex 24)" > .env
```

If a `.env` already exists (in a clone you may have one from local development), add `POSTGRES_PASSWORD` and
`PUBLIC_URL` to it instead. The password is applied when the database volume is first created: if you already
started the stack with the default password, keep it, or remove the volume (`docker compose down -v`, which
deletes the data) before changing it.

| Variable            | Default                 | Meaning                                                                                        |
| ------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | `shapio`                | Password of the bundled PostgreSQL. Change it before the host is reachable from anywhere else. |
| `PUBLIC_URL`        | `http://localhost:4300` | The address people use to reach Shapio; every link it builds starts with it.                   |
| `SHAPIO_PORT`       | `4300`                  | Host port, bound to `127.0.0.1` only.                                                          |

Any other Shapio setting goes under `environment:` of the `shapio` service; the full list is the
[environment variable reference](reference/environment.md).

## 3. Start

```sh
docker compose up -d
docker compose logs shapio
```

The first boot migrates the database and logs where to create the owner account:

```text
No admin account yet. Open http://localhost:4300/admin/ to create the owner account.
```

Open the address and create the first owner ([First admin](first-admin.md)). The first person to complete
Setup becomes the owner; if the server is reachable by others before you get there, set
`SETUP_REQUIRE_TOKEN: "true"` under `environment:` (Setup then needs a one-time token from the log) or create
the owner with `shapio admin create` (below). `docker compose ps` shows the
container as `healthy` once `/api/ready` answers.

## Running `shapio` commands

The CLI is in the image:

```sh
docker compose exec shapio node node_modules/shapio/dist/cli.js help
docker compose exec -e SHAPIO_ADMIN_PASSWORD='a long password' shapio \
  node node_modules/shapio/dist/cli.js admin create --email you@example.com
```

Remote commands (`schema`, `export`, `import`, `types`) work from any machine with Node.js:
`npx shapio <command> --url https://cms.example.com --token <admin API token>`.

## HTTPS on ports 80 and 443

The container runs as an unprivileged user, so it listens on high ports and Docker maps the privileged ones.
Bring your own certificate and key (PEM files) and mount them read-only. In `docker-compose.yml`, set on the
`shapio` service:

```yaml
environment:
  PUBLIC_URL: https://cms.example.com
  TLS_CERT_FILE: /certs/fullchain.pem
  TLS_KEY_FILE: /certs/privkey.pem
  PORT: '8443'
  HTTP_PORT: '8080'
ports:
  - '443:8443'
  - '80:8080'
volumes:
  - media:/data/media
  - /etc/shapio/tls:/certs:ro
```

Shapio serves HTTPS on 443 and redirects HTTP on 80 to it. The key file must be readable by the container's
user (uid 1000). When you replace the files at renewal, Shapio applies them within a minute without a restart.
Where certificates come from (certbot, your host, a Cloudflare origin certificate): [Networking](networking.md#https-with-your-own-certificate).

## Data and backups

| Volume                  | Holds                          |
| ----------------------- | ------------------------------ |
| `postgres-data`         | the database                   |
| `media` (`/data/media`) | uploaded files (local storage) |

Back up the database and the media volume together: [Backup and restore](backup-restore.md).

## Updating

```sh
docker compose pull
docker compose up -d
```

(From a clone: `git pull` then `docker compose up -d --build`.) Migrations run on start. See
[Upgrades](upgrades.md).
