# Snapshots and the changes API

Every publish moves its site's **publication snapshot** number forward. Each site has its own sequence
(snapshot 12 on one site says nothing about another), and the snapshot routes, `?snapshot=N` and GraphQL's
`_snapshot` and `_changes` answer for the request's site ([Delivery API](delivery-api.md#sites)). Delivery responses report the snapshot
they read in `meta.snapshot`, and `?snapshot=N` reads published content as it was at snapshot N
([Delivery API](delivery-api.md#snapshots-one-consistent-moment)). This page covers the parts built for site
builds: pinning a build to a snapshot, asking what changed between two snapshots, and refreshing only the
pages that changed.

## Pinning a build

Read the current snapshot once, when the build starts, and pass it with every request:

```sh
curl -H "Authorization: Bearer $SHAPIO_DELIVERY_TOKEN" "$SHAPIO_URL/api/snapshots/current"
# {"snapshot":42,"schemaVersion":17,"publishedAt":"2026-10-02T09:30:00.000Z"}

curl -H "Authorization: Bearer $SHAPIO_DELIVERY_TOKEN" "$SHAPIO_URL/api/content/articles?snapshot=42&fields=title,slug"
```

A publish in the middle of the build then cannot produce a site that mixes two moments. Deployment triggers
carry the snapshot to build, and the [example site](example-site.md) pins every build this way.

`schemaVersion` is the schema delivery serves now. Old snapshots are read through the **current** schema:
fields added since then are empty, removed fields are gone, and a value stored under an earlier field type
(text that has since become rich text, say) is returned as `null` (`[]` for list fields), never passed off
as the new type.

## What changed between two snapshots

```sh
curl -H "Authorization: Bearer $SHAPIO_DELIVERY_TOKEN" \
  "$SHAPIO_URL/api/snapshots/changes?from=38&to=42&limit=100"
```

```json
{
  "from": 38,
  "to": 42,
  "schemaVersions": { "from": 17, "to": 17 },
  "items": [
    {
      "id": "0b5d6f3e-2d55-4f6c-9b1a-5d2c8e9f1a01",
      "modelId": "5c1e0c9b-8f0e-4a51-b6a5-3e9a2f8d7c10",
      "modelKey": "article",
      "routeKey": "articles",
      "title": "Why builds pin a snapshot",
      "coverMediaId": "9a4e7c21-6b3d-4f0a-8e15-2c7d9b0f4e63",
      "locales": [
        { "locale": "en", "change": "updated", "revisionId": "c2f1…" },
        { "locale": "fr", "change": "published", "revisionId": "7d90…" }
      ]
    }
  ],
  "nextCursor": null
}
```

| Parameter | Meaning                                                            |
| --------- | ------------------------------------------------------------------ |
| `from`    | the snapshot your last build showed (required)                     |
| `to`      | the snapshot to compare with; the current one when omitted         |
| `limit`   | entries per page, 1–500 (default 100)                              |
| `after`   | `nextCursor` from the previous page; pages are ordered by entry ID |

An entry is listed with each locale whose live content differs between the two snapshots:

| Live at `from` | Live at `to`                             | `change`      |
| -------------- | ---------------------------------------- | ------------- |
| no             | yes                                      | `published`   |
| yes            | no (unpublished or deleted)              | `unpublished` |
| yes            | yes, a different revision                | `updated`     |
| yes            | yes, the same revision                   | not listed    |
| no             | no (published and taken down in between) | not listed    |

Things to know:

- **Only models your token may read** are reported. With a role whose read access has a row condition
  (owner-only), the condition is checked on the entry as it is now. Apart from `title` and `coverMediaId`
  (read from the revision live at `to`, or at `from` for an unpublished entry; `null` when your token can't
  read that field), the response names entries and locales, never values, so an entry whose only change is
  in a field your token cannot see still shows as `updated`. `revisionId` is the revision live at `to` (at
  `from` when unpublished).
- **Schema changes.** When `schemaVersions.from` and `schemaVersions.to` differ (or either is `null`, for
  snapshots from before Shapio recorded them), fields may have been added, converted or removed without any
  entry being republished. Rebuild the affected models (or everything) instead of trusting the list.
- **Deleting a locale** removes its history, so later diffs no longer mention it.
- `to` beyond the current snapshot is `400 SNAPSHOT_INVALID`; a token or signed-in user who may read no
  model (or an instance with no models yet) gets an empty list; anonymous callers get 401 unless the
  `public` role grants reading something.

The same is available in GraphQL:

```graphql
query Changes($from: Int!, $after: ID) {
  _changes(from: $from, after: $after, first: 100) {
    from
    to
    fromSchemaVersion
    toSchemaVersion
    nextCursor
    nodes {
      id
      modelKey
      routeKey
      locales {
        locale
        change
      }
    }
  }
  _snapshot {
    snapshot
    schemaVersion
    publishedAt
  }
}
```

With `@shapio/client`:

```ts
import { createClient } from '@shapio/client';

const shapio = createClient({ baseUrl: process.env.SHAPIO_URL!, token: process.env.SHAPIO_DELIVERY_TOKEN });
const { snapshot } = await shapio.snapshots.current();
const { items, schemaVersions } = await shapio.snapshots.allChanges({
  from: lastBuiltSnapshot,
  to: snapshot,
});
```

## Skipping builds that change nothing

The [Astro starter](example-site.md)'s `build:incremental` script reads the snapshot of the last build from `dist/build.json`
(or `SHAPIO_FROM_SNAPSHOT`), asks for the changes up to the current snapshot, prints the routes they touch, and
runs the build pinned to the new snapshot, or skips it when nothing this site reads changed:

```sh
pnpm --filter example-astro build:incremental            # build only if needed
pnpm --filter example-astro build:incremental --dry-run  # just print the routes
```

```text
Snapshots 38 → 42: 2 changed entries; routes to refresh:
  /en/articles/
  /en/articles/why-builds-pin-a-snapshot/
  /fr/articles/
  /fr/articles/why-builds-pin-a-snapshot/
```

## Refreshing only what changed (`revalidatePath`)

Server-rendered frameworks with on-demand revalidation can refresh just the changed pages. Point a Shapio
[webhook](publishing.md) for publish events at a route in your app, remember the snapshot you last handled,
and revalidate the routes of the changed entries. With Next.js:

```ts
// app/api/shapio-changed/route.ts
import { revalidatePath } from 'next/cache';
import { createClient, verifyWebhookSignature } from '@shapio/client';

const shapio = createClient({ baseUrl: process.env.SHAPIO_URL!, token: process.env.SHAPIO_DELIVERY_TOKEN });
let lastSnapshot = Number(process.env.SHAPIO_START_SNAPSHOT ?? 0);

export async function POST(request: Request) {
  const check = await verifyWebhookSignature({
    secret: process.env.SHAPIO_WEBHOOK_SECRET!,
    signature: request.headers.get('x-shapio-signature'),
    timestamp: request.headers.get('x-shapio-timestamp'),
    body: await request.text(),
  });
  if (!check.ok) {
    return new Response(check.reason, { status: 401 });
  }
  const { snapshot } = await shapio.snapshots.current();
  const diff = await shapio.snapshots.allChanges({ from: lastSnapshot, to: snapshot });
  if (diff.schemaVersions.from !== diff.schemaVersions.to) {
    revalidatePath('/', 'layout'); // the schema moved: refresh everything
  } else {
    for (const entry of diff.items) {
      if (entry.modelKey === 'article') {
        revalidatePath(`/articles/${entry.id}`);
      }
    }
    if (diff.items.some((entry) => entry.modelKey === 'article')) {
      revalidatePath('/articles');
    }
  }
  lastSnapshot = snapshot;
  return Response.json({ revalidated: diff.items.length, snapshot });
}
```

Keep `lastSnapshot` somewhere durable in production (a KV store or a file); after a restart, starting from an
older snapshot only refreshes a few pages twice.

## Field usage

Delivery reads are counted per token and field (counts only, kept in your database, `USAGE_TRACKING=false`
turns it off). Send `fields=` in your reads: a read without it counts every field as used ("reads the whole
model"), which hides which fields a site really depends on when you review a breaking schema change.
