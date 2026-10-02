# Networking without a reverse proxy

Shapio serves its API, admin and media itself, over HTTP or HTTPS, on any port and under any path. nginx,
Caddy or Apache are optional. All of this is configuration; the full list is the
[environment variable reference](reference/environment.md).

## Address: `HOST`, `PORT`, `PUBLIC_URL`, `BASE_PATH`

| Setting      | Default                  | Meaning                                                                      |
| ------------ | ------------------------ | ---------------------------------------------------------------------------- |
| `HOST`       | `127.0.0.1`              | Interface to listen on. `0.0.0.0` to accept connections from other machines. |
| `PORT`       | `4300`                   | Port of the API and admin.                                                   |
| `PUBLIC_URL` | (required in production) | The origin people use, e.g. `https://cms.example.com`. Origin only: no path. |
| `BASE_PATH`  | `/`                      | A sub-path, e.g. `/cms`, when Shapio shares a domain.                        |

`PUBLIC_URL` plus `BASE_PATH` is the only source of absolute URLs: media links, preview links, OAuth
callbacks, links in emails, the OpenAPI `servers` entry. If links point at the wrong host, this is the
setting to fix.

With `BASE_PATH=/cms` every route moves under it: the API at `/cms/api/...`, the admin at `/cms/admin/`, and
`/cms/` redirects to the admin. Remote CLI commands then take `--url https://example.com/cms`.

```sh
BASE_PATH=/cms npx shapio start
curl http://localhost:4300/cms/api/ready
```

## HTTPS with your own certificate

Shapio serves HTTPS itself from a certificate and key in PEM files. It does not obtain certificates: bring
one from wherever suits you (examples below).

```dotenv
PUBLIC_URL=https://cms.example.com
HOST=0.0.0.0
PORT=443
TLS_CERT_FILE=/etc/shapio/tls/fullchain.pem
TLS_KEY_FILE=/etc/shapio/tls/privkey.pem
# Optional: also answer plain HTTP on port 80 and redirect it to PUBLIC_URL.
HTTP_PORT=80
```

- `TLS_CERT_FILE` is the certificate followed by its intermediates (a "full chain"); `TLS_KEY_FILE` is the
  matching private key. Startup fails with a clear message if either is missing, unreadable, or they do not
  match.
- `HOST=0.0.0.0` makes Shapio reachable from other machines; the scaffold's default, `127.0.0.1`, only
  answers on the machine itself.
- **Renewals need no restart.** Shapio re-reads both files every minute (`TLS_RELOAD_INTERVAL_MS`) and, when
  they changed, serves the new certificate to new connections. It logs
  `TLS certificate files changed; new certificate applied without restart`. A pair caught half-written (new
  certificate, old key) is logged and retried; the previous certificate keeps serving until both match.
- The user Shapio runs as must be able to read the key file. Keep it mode `0600` and owned by that user.
- With several instances, give each the same files; each reloads them on its own.

### certbot with a DNS challenge (works alongside the port-80 redirect)

The DNS challenge never touches ports 80 or 443, so Shapio can keep both. With a certbot DNS plugin for your
provider (here Cloudflare):

```sh
sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  -d cms.example.com \
  --deploy-hook 'install -m 0600 -o shapio -g shapio "$RENEWED_LINEAGE/fullchain.pem" "$RENEWED_LINEAGE/privkey.pem" /etc/shapio/tls/'
```

certbot's timer renews it; the deploy hook copies the renewed files where the `shapio` user can read them, and
Shapio picks them up within a minute. Run the hook once by hand (or `sudo certbot renew --force-renewal`) to
place the first copy.

### certbot standalone (HTTP challenge)

certbot's standalone mode answers the challenge on port 80 itself, so port 80 must be free while it runs.
Leave `HTTP_PORT` unset (no redirect), and use the same `--deploy-hook` as above:

```sh
sudo certbot certonly --standalone -d cms.example.com \
  --deploy-hook 'install -m 0600 -o shapio -g shapio "$RENEWED_LINEAGE/fullchain.pem" "$RENEWED_LINEAGE/privkey.pem" /etc/shapio/tls/'
```

If you want both the HTTP redirect and an HTTP challenge, use the DNS challenge instead.

### A certificate from your host or a certificate authority

Many hosts and registrars issue certificates you can download, and commercial CAs send a certificate plus a
CA bundle. Concatenate the certificate and then the bundle into `fullchain.pem`, save the key as
`privkey.pem`, and point `TLS_CERT_FILE`/`TLS_KEY_FILE` at them. When you replace the files at renewal, Shapio
applies them without a restart.

### Cloudflare origin certificate

With Cloudflare's proxy on, Cloudflare serves visitors its own certificate and only needs to trust yours. Create
an **Origin Certificate** in the Cloudflare dashboard (SSL/TLS → Origin Server; valid up to 15 years), save the
certificate as `fullchain.pem` and the key as `privkey.pem`, point `TLS_CERT_FILE`/`TLS_KEY_FILE` at them,
and set Cloudflare's SSL mode to **Full (strict)**. Also set `TRUST_PROXY=1` (see
[Behind Cloudflare](#behind-cloudflare-a-load-balancer-or-a-proxy)). An origin certificate is only trusted by
Cloudflare, so the site must stay proxied (orange cloud).

### Ports 80 and 443 as a normal user

Linux only lets root bind ports below 1024. Do not run Shapio as root; instead:

- **Bare metal:** allow Node to bind low ports, once per Node installation (again after upgrading Node):

  ```sh
  sudo setcap cap_net_bind_service=+ep "$(readlink -f "$(command -v node)")"
  ```

  or, under systemd, add `AmbientCapabilities=CAP_NET_BIND_SERVICE` to the unit
  ([Install with npm](install-npm.md#or-with-systemd)).

- **Docker:** listen on high ports inside the container and map them: `PORT=8443`, `HTTP_PORT=8080`,
  `ports: ['443:8443', '80:8080']` ([Install with Docker](install-docker.md#https-on-ports-80-and-443)).

## Behind Cloudflare, a load balancer or a proxy

When something sits in front of Shapio, tell it how many hops to trust so client IPs (rate limiting, audit
log) and the original scheme come from `X-Forwarded-For` and `X-Forwarded-Proto`:

```dotenv
TRUST_PROXY=1
```

Use the number of proxies in front of Shapio (Cloudflare alone is 1). Never set `TRUST_PROXY=true` on a server
the internet can reach directly: anyone could then choose their own IP address.

With Cloudflare's proxy on, Cloudflare terminates TLS for visitors. For the connection to Shapio, set
Cloudflare's SSL mode to **Full (strict)** and give Shapio a
[Cloudflare origin certificate](#cloudflare-origin-certificate).

## Security headers and CORS

- HSTS and `upgrade-insecure-requests` are sent only when `PUBLIC_URL` is `https://`, so a plain-HTTP install
  on a LAN keeps working.
- The admin and the API share one origin; the admin needs no CORS. `CORS_ORIGINS` is for **your** sites and
  apps that call the API from the browser (client-side fetches, app-user sign-in, previews), comma-separated:
  `CORS_ORIGINS=https://www.example.com,https://preview.example.com`. Those origins may send `GET`, `POST`,
  `PUT`, `PATCH` and `DELETE` with a bearer token; cookies are never allowed cross-origin, so a script on a
  listed site can never act with an editor's admin session.

## Health checks

- `GET /api/health`: the process is up.
- `GET /api/ready`: the database answers and migrations are current (use this for load balancers). While the
  database is unreachable it answers 503 `NOT_READY` and the process keeps running; it recovers by itself when
  the database is back, without a restart.
- `npx shapio healthcheck` probes `/api/ready` over loopback with the right scheme, port and `BASE_PATH`
  (the Docker image's `HEALTHCHECK` uses it).
