# Webhooks, deployments and preview

Publishing makes content live in the delivery API. Getting it onto a website is a separate step that can fail
on its own, and Shapio shows both honestly: _published_ is not _deployed_. Everything here is set up under
**Publishing** in the admin; outbound requests go through Shapio's job queue, with retries and logs.

## Webhooks

Publishing → Webhooks → New webhook: a URL and the events to send (`entry.*`, `media.*`, `schema.*`,
`locale.*`, `change_set.*`, `deployment.*`, or single events such as `entry.published`). The signing secret is
shown once. The change set events (`change_set.scheduled`, `.shipping`, `.shipped`, `.failed`, `.discarded`) are
described in [Change sets](change-sets.md#webhooks).

Each event is a `POST` with a JSON body `{ "id", "type", "createdAt", "site", "data" }` and these headers:

| Header               | Value                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| `X-Shapio-Event`     | the event type, e.g. `entry.published`                                 |
| `X-Shapio-Delivery`  | the delivery's ID (the same on every retry: use it to drop duplicates) |
| `X-Shapio-Timestamp` | Unix seconds                                                           |
| `X-Shapio-Signature` | `v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`               |

Verify the signature over the raw body and reject timestamps older than a few minutes. With `@shapio/client`
(Node, edge runtimes and browsers alike):

```js
import { verifyWebhookSignature } from '@shapio/client';

const check = await verifyWebhookSignature({
  secret: process.env.SHAPIO_WEBHOOK_SECRET,
  signature: request.headers.get('x-shapio-signature'),
  timestamp: request.headers.get('x-shapio-timestamp'),
  body: rawBody, // the body exactly as received, not re-serialised JSON
});
if (!check.ok) return new Response(check.reason, { status: 401 });
```

Or by hand:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

const verify = (secret, rawBody, timestamp, signature) => {
  const expected = `v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
  return (
    fresh &&
    signature
      .split(',')
      .some(
        (candidate) =>
          candidate.trim().length === expected.length &&
          timingSafeEqual(Buffer.from(candidate.trim()), Buffer.from(expected)),
      )
  );
};
```

Delivery is at least once. Failures are retried with exponential backoff (up to the webhook's maximum
attempts) and every attempt is in the webhook's delivery log (status, response, timing), where you can also
redeliver and **send a test** event. Rotating the secret is one click.

### Outbound requests and private networks

Webhooks and deployment connections never call private, loopback or link-local addresses (`10.x`, `192.168.x`,
`127.0.0.1`, cloud metadata endpoints…), whatever the URL's host name resolves to, re-checked at connection
time. To reach a host on your own network, list its address in `OUTBOUND_PRIVATE_NETWORK_ALLOWLIST`
(CIDR, comma-separated) **and** turn on "Allow private network" on that webhook or connection.

### Sites

On an instance with several [sites](sites.md), a webhook belongs to the site it was created on and receives that
site's events (including changes to the site's own content types), plus network events such as locale changes
and changes to content types shared with all sites. A **network** webhook (`"network": true`
when creating it, which needs `webhooks.manage` on all sites) receives every site's events. `site` in the body
is the event's site (`{ "id", "key" }`), or `null` for a network event.

## Deployment connections

Publishing → Deployments → New connection. A connection says how to start a site build and when:

- **Triggers** (`triggerPolicy`): publishing an entry (`publish`), shipping a [change set](change-sets.md)
  (`change_set`), manually (`manual`), or (GitHub write-back) schema changes (`schema`). Bursts of publishes are
  coalesced (`debounce`), so ten publishes in a minute start one build. A change set can also name one
  connection to build right after it ships ([Ship with deploy](change-sets.md#ship-with-deploy)).
- Each build is a **run** tied to the publication snapshot it should show, with a timeline:
  `queued → triggered → building → deployed` or `failed`. Callbacks and provider status only move a run
  forward; a late "building" never hides "deployed", and an older run finishing late never looks current.
- Shapio never invents a status. A provider that cannot report completion leaves the run at _triggered_
  (completion unknown); one that stops answering shows _unknown_.
- Failed runs show the error and a link to the build log, and can be retried.
- Secrets can be entered as `${ENV:VARIABLE_NAME}`: Shapio then stores only the name and reads the value from
  its environment when it needs it (set it for the API and any dedicated worker). The variable must start with
  `SHAPIO_SECRET_` or be listed in `SECRET_ENV_ALLOWLIST` (comma-separated names or `PREFIX*` patterns);
  anything else is refused with `SECRET_ENV_NOT_ALLOWED`, so an admin can never point a connection at the
  server's own settings such as `SESSION_SECRET` or `SMTP_PASSWORD`.
- **Test connection** checks the settings without starting a build.
- Connections belong to a [site](sites.md): a site's publishes, change sets and changes to its own content types
  build its own connections, and a change to a content type shared with all sites builds every site's
  connections that build on schema changes.

### Generic signed build webhook

For any build system you can reach over HTTP (your CI, a small build server). Shapio `POST`s, signed like
webhooks (`X-Shapio-Event: deployment.trigger`, `X-Shapio-Delivery: <run id>`):

```json
{
  "type": "deployment.trigger",
  "runId": "7a1d…",
  "connectionId": "c41e…",
  "trigger": "publish",
  "snapshot": 42,
  "schemaVersion": 17,
  "triggeredAt": "2026-10-02T09:00:00.000Z",
  "callbackUrl": "https://cms.example.com/api/hooks/deployments/c41e…",
  "contentApiUrl": "https://cms.example.com/api/content"
}
```

Your receiver verifies the signature, then builds with `SHAPIO_SNAPSHOT=<snapshot>` so the site shows exactly
that moment, and reports progress to `callbackUrl`: a `POST` of `{ "runId", "status": "building" | "deployed"
| "failed", "siteUrl"?, "logUrl"?, "message"? }`, signed with the connection's secret in the same headers.
The [Astro starter](starters.md) includes the sender:

```sh
SHAPIO_CALLBACK_URL=… SHAPIO_RUN_ID=… SHAPIO_CALLBACK_SECRET=whsec_… \
  npm run report-status -- deployed "Built snapshot 42"
```

Without callbacks a generic run stays at _triggered_: Shapio knows the trigger was accepted, not how the build
went.

### Cloudflare Pages

Shapio starts the build through a Pages **deploy hook** and reads its real progress from the Cloudflare API
(queued, building, deploying, success or failure, with a link to the build log). Setup for a Pages project that
builds from your Git repository:

1. In Cloudflare: **Workers & Pages → your Pages project → Settings → Builds → Deploy hooks → Add deploy hook**
   (any name, the production branch). Copy the URL.
2. **My Profile → API Tokens → Create Token → Custom token**, permission _Account → Cloudflare Pages → Read_,
   limited to your account. Copy the token.
3. Note your **account ID** (Workers & Pages overview, right-hand column, or the 32-character hex string in the
   dashboard URL) and the **project name**.
4. In Shapio: Publishing → Deployments → New connection → **Cloudflare Pages**: account ID, project name, the
   deploy hook URL and the API token (for example as `${ENV:SHAPIO_SECRET_CF_PAGES_TOKEN}`), and the triggers you want.
   **Test connection** checks the token can read the project.

If a build is already queued for the branch (a git push usually got there first), Cloudflare answers the deploy
hook with HTTP 304 and starts nothing new; the run then follows that queued build and reports its result.

A deploy hook cannot pass parameters, so a Pages build pins the snapshot that is current when it starts (a
generic webhook can pin the run's exact snapshot). The step-by-step for the example site, including the build
settings, is in [Example site](example-site.md#5-deploy-to-cloudflare-pages).

### Vercel

Shapio starts the build through a Vercel **deploy hook** and reads its real progress from the Vercel API
(queued, building, ready, error or canceled, with a link to the deployment's inspector page). Setup for a Vercel
project that builds from your Git repository:

1. In Vercel: **your project → Settings → Git → Deploy Hooks**: any name, the production branch. Copy the URL.
2. **Account Settings → Tokens → Create**, scoped to the team that owns the project. Copy the token.
3. Note the **project ID** (project → Settings → General, `prj_…`) and, for a team project, the **team ID**
   (team → Settings → General, `team_…`). Leave the team ID empty for a project in your personal account.
4. In Shapio: Publishing → Deployments → New connection → **Vercel**: project ID, team ID, the deploy hook URL
   and the API token (for example as `${ENV:SHAPIO_SECRET_VERCEL_TOKEN}`), and the triggers you want.
   **Test connection** checks the token can read the project.

The deploy hook answers with a build job, not the deployment, so Shapio finds the run's deployment in the
project's deployment list: the newest one created after the trigger that carries this hook's ID (or, when
Vercel does not record the hook, the newest one that names no hook). As with Cloudflare, a deploy hook cannot
pass parameters, so the build pins the snapshot that is current when it starts.

### Netlify

Shapio starts the build through the Netlify API and follows the deploy it produces (enqueued, building,
processing, published, error, or skipped, with a link to the deploy log). There is no deploy hook to copy:

1. In Netlify: **User settings → Applications → Personal access tokens → New access token**. Copy the token.
   Netlify tokens cannot be limited to one site; a token from an account with access to only this site's team
   keeps the reach small.
2. Note the **site ID** (site → Site configuration → General → Site details → Site ID, a UUID).
3. In Shapio: Publishing → Deployments → New connection → **Netlify**: site ID and the API token (for example as
   `${ENV:SHAPIO_SECRET_NETLIFY_TOKEN}`), and the triggers you want. **Test connection** checks the token can
   read the site.

A build Netlify skips (for example through an ignore command) or cancels did not update the site, so its run
fails with that reason. The build pins the snapshot that is current when it starts.

Both adapters send the API token only to `VERCEL_API_URL` or `NETLIFY_API_URL` (the official APIs unless you
change them). If the answer to a trigger is lost after the provider started the build, the retry takes over
that build instead of starting a second one.

## Preview

Editors preview drafts on the real site before publishing.

1. On the deployment connection, set a **preview URL template**, for example
   `https://www.example.com/preview/?model={modelKey}&id={entryId}&locale={locale}#token={token}`.
   Variables: `{token}`, `{modelKey}`, `{entryId}`, `{locale}`, and `{path}` (`modelKey/entryId`).
   `{modelKey}` is the model's route key, as in the delivery and preview APIs: the plural API ID of a collection
   (`articles`), the API ID of a single type (`homepage`).
2. The entry document's **Preview** opens that URL beside the document with a fresh **preview token**: scoped to
   the entry, its locale and its [site](sites.md), expiring after an hour (the admin replaces it before then),
   never an admin credential. Putting it after `#` keeps it out of server logs and Referer
   headers.
3. Your preview page reads the draft from the preview API, sending the token as a bearer token (never in the
   query string):

   ```sh
   curl -H "Authorization: Bearer shpv_…" "$SHAPIO_URL/api/preview/content/articles/<entry id>?locale=fr&populate=author"
   ```

   The answer has the delivery shape, with the draft's values, under the same field rules as delivery. Drafts
   are sent with `Cache-Control: private, no-store`.

Preview tokens are listed per entry and can be revoked. A page that calls the preview API from the browser
needs its origin in `CORS_ORIGINS`. The [example site's](example-site.md) `/preview/` page is a working
implementation.

With `@shapio/visual` on the preview page, clicking a part of the page focuses its field in the document and
saves re-render the page: see [Visual editing](visual-editing.md), which also covers the
`frame-ancestors` header the site sends and the admin's `frame-src`. A preview URL on Shapio's own origin is
refused.
