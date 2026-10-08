# Security

How Shapio protects its admin, its APIs and your content, and what you configure. To report a vulnerability,
see [SECURITY.md](../SECURITY.md).

## Admin accounts and sessions

- No default account or password. The first owner is created on the Setup screen by whoever completes it
  first while no admin exists, or with `shapio admin create`. Installs reachable by others before setup set
  `SETUP_REQUIRE_TOKEN=true`, so Setup also needs a one-time token from the server log
  ([First admin](first-admin.md)).
- Passwords: at least 12 characters, hashed with argon2id. Sign-in answers the same way, in the same time, for
  unknown emails.
- Sessions are server-side: an opaque token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` when
  `PUBLIC_URL` is https), stored only as a hash. They expire after 12 hours without activity and 7 days after
  sign-in, rotate on sign-in and when privileges change, and can be listed and revoked (Settings → Sessions;
  user managers can sign anyone out from Users).
- Every state-changing request authenticated by the session cookie needs the `X-CSRF-Token` header, GraphQL
  included. Bearer-token requests do not use cookies and need none.
- Sign-in, password reset and invitation endpoints are rate limited per IP (20 a minute). Failed sign-ins are
  also limited per account and client IP (5 per 15 minutes), so someone guessing from elsewhere can never lock
  the real owner out; reset requests are limited per email (5 per 15 minutes). Invitation links last 7 days,
  reset links one hour, and work once.

## API tokens

- `shp_…` tokens are shown once and stored as SHA-256 hashes; each has a role, an optional expiry and a last-used
  time, and can be revoked at once.
- A token bound to a **delivery** role can only read, whatever the role says.
- App users (end users) get short-lived JWT access tokens (15 minutes) and rotating refresh tokens; reusing a
  refresh token revokes that login ([End users](end-users.md)).
- Preview tokens are scoped to one entry, a locale and its site, expire, and are sent as bearer tokens, never in
  query strings.
- API tokens belong to the [site](sites.md) they are created on. A network admin token (every site, and network
  permissions) is only created on explicit request (`"network": true`) by an admin with `users.manage`.
- Site tokens, app-user tokens and preview tokens act on their own [site](sites.md) only; naming another site is
  refused (`403 SITE_MISMATCH`), never redirected.

## Permissions

- Deny by default, for every kind of caller: roles grant actions per model and per field; anonymous delivery
  gets nothing until the `public` role is granted something.
- The server enforces everything (validation, permissions, schema consistency); the admin UI is never the only
  check.
- [Sites](sites.md) are a tenancy boundary in every query: another site's entries, assets, change sets and tokens
  read as not found, and relations and media never cross sites. A role held on one site never grants network
  permissions (schema, users, roles, audit, sites).
- Delivery never returns drafts, unpublished relation targets, private media without a signed URL, or fields
  the caller may not read. Filtering, sorting or searching on a field you may not read is refused, so queries
  cannot be used to guess hidden values.

## Content and files

- Rich text is stored as a validated JSON document, never HTML; the HTML in delivery responses is rendered
  from it with an allow-list sanitiser (only `http`, `https`, `mailto`, `tel` and relative links).
- Uploads are limited in size and type, and the type is checked from the file's bytes. Files Shapio serves carry
  `X-Content-Type-Options: nosniff` and a sandboxing `Content-Security-Policy`, so an uploaded SVG or HTML file
  cannot run scripts on the admin's origin.
- Private media is only reachable through signed URLs that expire after one hour.

## Outbound requests

Webhooks, deploy hooks and provider APIs never reach private, loopback or link-local addresses (cloud metadata
endpoints included): the host name is resolved, every address checked, and the request sent to the address
that was checked, so DNS tricks cannot redirect it. The only exception is an address listed in
`OUTBOUND_PRIVATE_NETWORK_ALLOWLIST` **and** the webhook or connection allows private networks. Requests time
out after `OUTBOUND_TIMEOUT_MS`.

## Secrets

- `SESSION_SECRET` (at least 32 characters) is Shapio's signing secret. It signs preview tokens, private-media
  URLs and upload grants, derives the keys of app users' access tokens, OAuth state and refresh-token rotation,
  and derives the key that encrypts stored secrets (webhook signing secrets, deploy hook URLs, provider tokens;
  AES-256-GCM). Admin sessions and CSRF do not use it, and each webhook and deployment connection signs with
  its own secret. If you leave it unset, Shapio generates one and keeps it in the database. Changing it signs
  every app user out, invalidates outstanding signed media URLs and preview links, and means re-entering
  stored secrets.
- Deployment secrets can be `${ENV:VARIABLE_NAME}` references, so only the variable's name is stored. Only
  variables starting with `SHAPIO_SECRET_` or listed in `SECRET_ENV_ALLOWLIST` can be referenced.
- Secrets are redacted from API responses, the jobs view and logs; passwords, tokens and cookies never reach the
  log.

## HTTP

- Security headers (helmet) on every response; a strict Content Security Policy on the admin (no inline
  scripts); HSTS when `PUBLIC_URL` is https.
- CORS is off unless you list your own origins in `CORS_ORIGINS`.
- A global rate limit per client IP (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`). Requests for the admin's own
  files under the admin prefix (its scripts and styles, `theme-init.js`, fonts, and favicons) are not counted, so
  reloading the admin cannot lock it out; the admin page itself and every API route are. Behind a proxy set
  `TRUST_PROXY` so the client IP is right ([Networking](networking.md#behind-cloudflare-a-load-balancer-or-a-proxy)).

## Audit log

Network → Audit log records who did what, from where and when: setup, sign-ins and sign-outs, session
revocations, password changes and resets, invitations, users, roles, API tokens and app-user accounts, schema
changes and schema settings, publishing, unpublishing, scheduling and change sets (created, edited, scheduled, shipped, discarded), deletions, media uploads,
replacements and removals, webhooks, deployment connections and runs, preview tokens, exports and imports, and
refresh-token reuse. Content edits are recorded as revisions instead.

## No telemetry

Shapio sends nothing anywhere unless you configure it. No error-reporting service is built in; if you want one,
wire it up yourself through an extension (see [Extensions](extensions.md)). The example site turns off Astro's
anonymous telemetry in its scripts.

## Checklist for production

- [ ] `PUBLIC_URL` is `https://…` (`TLS_CERT_FILE`/`TLS_KEY_FILE`, or HTTPS terminated in front), and `NODE_ENV=production`.
- [ ] Shapio runs as an unprivileged user (setcap or port mapping for 80/443).
- [ ] The owner account was created before the server was reachable by others, or `SETUP_REQUIRE_TOKEN=true` was set.
- [ ] PostgreSQL is not reachable from the internet; its password is strong.
- [ ] `TRUST_PROXY` matches what is really in front of Shapio.
- [ ] Backups of the database and media run, and a restore was tried.
- [ ] SMTP is configured, so invitations and resets reach people instead of the log.
- [ ] Delivery tokens use delivery roles with only the models your site needs.
- [ ] `CORS_ORIGINS` lists only your own sites.
