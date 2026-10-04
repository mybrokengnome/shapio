# Visual editing

Editors see the draft on the real site beside the document they are writing, and clicking a part of the page
takes them to the field it shows. Saves re-render the page. The three [site starters](starters.md) come with
it set up; any other site needs a preview page, a few attributes and one script.

How it fits together:

1. A deployment connection has a **preview URL template** ([Preview](publishing.md#preview)).
2. **Preview** in the entry document mints a one-hour preview token for the entry and its locale, and opens the
   template's URL with `?shapio-visual=1` added, in a pane beside the document.
3. The site's preview page reads the draft with the token and renders it. Elements that show a field carry
   `data-shapio-*` attributes (`shapioAttr`).
4. `@shapio/visual`, running in that page, outlines those elements on hover and tells the admin which field was
   clicked. The admin scrolls to that field and focuses it. After each save the admin asks the page to
   re-render the draft.

## In the admin

- **Preview** in the document's top bar opens the pane. It is disabled, with a hint, until the site has an
  enabled deployment connection with a preview URL. With several, a menu in the pane picks one.
- On wide screens (lg and up) the site fills the right half of the screen under the top bar. On smaller screens
  it fills the screen: **Document** slides the document back in, and **Preview** returns to the site. The frame
  stays loaded either way.
- A click on a field in the page focuses it: the title, a canvas field (rich text, sections, galleries), an item
  inside a dynamic zone or list (by its path), or a property. A property that isn't on the page opens in the
  settings drawer. A click on something that belongs to another entry (a populated author) or another locale
  shows a short notice instead.
- After autosave, Save or Publish, the page re-renders the draft (once per burst of saves). A site without
  `@shapio/visual` is reloaded instead.
- The token is replaced five minutes before its hour is up and revoked when it is replaced, when the pane
  closes and when the entry, locale or connection changes.
- **Reload the preview** re-renders it now; **Open in a new tab** opens the same draft outside the admin.
- If the page doesn't announce `@shapio/visual` within a few seconds, the pane says so, with a link here. The
  preview still works; clicks just don't find fields.
- If the site was connected after the admin was loaded, the browser blocks the frame (see
  [Content Security Policy](#content-security-policy)) and the pane offers **Reload the admin**.

## Set up a site

### 1. A connection with a preview URL

Publishing → Deployments → a connection's **Preview URL**, for example
`https://www.example.com/preview/?model={modelKey}&id={entryId}&locale={locale}#token={token}`. Put the token
after `#`: it then never reaches a server log or a Referer header. The starters' seed creates a connection named
**Preview** that points at the starter's `/preview/` page and triggers no builds.

The template's host must be fixed: a template like `https://{locale}.example.com/…` can't be framed (its
origin isn't known in advance) and opens in a new tab. A template on Shapio's own origin is refused.

### 2. Let the browser read drafts

A preview page that reads the draft in the browser needs its origin in Shapio's `CORS_ORIGINS`, for example
`CORS_ORIGINS=http://localhost:4321,https://www.example.com`. Restart Shapio after changing it.

### 3. Mark the fields

```sh
npm install @shapio/visual
```

`shapioAttr(entry, path, locale?)` returns the attributes for the element that shows `path` of `entry`, as an
object to spread:

```tsx
import { shapioAttr } from '@shapio/visual';

<h1 {...shapioAttr(article, 'title')}>{article.title}</h1>
<img src={cover.url} alt={cover.alt} {...shapioAttr(article, 'cover')} />
{/* body read with richText=html */}
<div className="prose" {...shapioAttr(article, 'body')} dangerouslySetInnerHTML={{ __html: article.body.html }} />
<h2 {...shapioAttr(page, `sections/${index}/heading`)}>{section.heading}</h2>
```

```html
<!-- The same attributes, written out -->
<h1 data-shapio-entry="3f1c2b9a-…" data-shapio-path="title" data-shapio-locale="en">…</h1>
```

- `entry` is a delivery item (`{ id, locale }`) or an entry ID. The locale defaults to the item's.
- `path` uses API IDs, with list positions and nested fields after slashes: `title`, `body`,
  `sections/2/heading`, `gallery/0`. It is the path the admin uses for the field.
- The attributes hold only entry IDs and API IDs, which delivery already returns, so published pages can carry
  them too. The script only runs in the preview frame.

### 4. Run the script on the preview page

```ts
import { initVisualEditing } from '@shapio/visual';

const stop = initVisualEditing({
  origin: 'https://cms.example.com', // Shapio's URL; only its admin is heard, and only it is told
  onRefresh: () => renderDraft(), // re-read and re-render the draft with the token you kept
});
```

It does nothing unless the page is in a frame **and** its URL has `?shapio-visual=1`, so it is safe to call on
every preview load. Without `onRefresh` the page reloads after each save. That works for a page that reads its
token from the URL on every load, but not for one that removes the token from the address bar, as the starters
do. `initVisualEditing` returns a function that turns it off.

Without a bundler, use the plain-script build. With `data-shapio-origin` it starts by itself, and the page
reloads on refresh:

```html
<script src="/vendor/shapio-visual.iife.js" data-shapio-origin="https://cms.example.com"></script>
```

The file is `@shapio/visual/global` (`node_modules/@shapio/visual/dist/visual.iife.js`); copy it into your
site's assets. It also exposes `window.ShapioVisual.initVisualEditing` and `shapioAttr`.

### 5. Allow Shapio to frame the site

Send `Content-Security-Policy: frame-ancestors 'self' https://cms.example.com` with the site's pages, so only
the site itself and Shapio can frame them. Browsers ignore `frame-ancestors` in a `<meta>` tag: it has to be a
response header. The starters set it for their dev and preview servers and write a `_headers` file (read by
Cloudflare Pages and Netlify) into the build. On another host, set the same header in its configuration.

## The starters

All three use the template
`<site>/preview/?model={modelKey}&id={entryId}&locale={locale}#token={token}`, read the draft in the browser with
the token (which they then remove from the address bar), render it with the same components as the published
pages, and mark the title, body, cover, a page's title and a hero's heading.

| Starter   | Preview page                                        | Shapio URL in the browser                   | `frame-ancestors`                              |
| --------- | --------------------------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| Astro     | `src/pages/preview.astro`, `src/scripts/preview.ts` | `PUBLIC_SHAPIO_URL`, else `SHAPIO_URL`      | `astro.config.mjs` (servers + `dist/_headers`) |
| Next.js   | `src/app/preview/`, `src/components/Preview/`       | `NEXT_PUBLIC_SHAPIO_URL`, else `SHAPIO_URL` | `next.config.ts` (`headers()`)                 |
| SvelteKit | `src/routes/preview/`                               | `PUBLIC_SHAPIO_URL`, else `SHAPIO_URL`      | `vite.config.ts` (servers + `build/_headers`)  |

The seed points the **Preview** connection at the starter's local server (`http://localhost:4321` for Astro,
`:3000` for Next.js, `:5173` for SvelteKit's `npm run dev`). Set `SITE_URL` when you run the seed to point it at
another address, or edit the connection. Add that origin to Shapio's `CORS_ORIGINS`.

## Content Security Policy

- The admin page's `frame-src` lists exactly the origins of the enabled connections' preview URLs, on every site,
  and the GraphQL playground's own URL. Nothing else can be framed. The list is read when the admin page loads
  (reused for up to 10 seconds), so a site connected later needs a reload of the admin.
- Shapio's own origin is never framed for a preview: a page there could script the admin. Such templates are
  refused when saved and left out of the policy.
- The admin itself keeps `frame-ancestors 'self'`: only the admin may frame Shapio's pages (the GraphQL
  playground).

## Security model

- **Messages.** The page posts to the configured Shapio origin only (`postMessage` with that origin as the
  target) and accepts messages only from its parent window on that origin. The admin accepts messages only from
  the frame's own window (`event.source`) on the preview URL's origin, and posts only to that origin. Malformed
  messages are ignored on both sides. The messages carry an entry ID, a field path and a locale (to the admin)
  or a refresh request (to the site); they never carry content or credentials.
- **Frame.** The frame is sandboxed (`allow-scripts allow-same-origin allow-forms allow-popups`) and sends no
  Referer. `allow-same-origin` gives the site its own origin back, which its requests to Shapio need. Since the
  site is never on the admin's origin, it can't reach the admin.
- **Tokens.** The only credential in the frame is the preview token: read-only, one entry and locale, one hour,
  revoked when the pane is done with it. It reads with its creator's current permissions and, like delivery,
  shows public fields only (or the fields of the connection's delivery role) ([Preview](publishing.md#preview)).
  Admin cookies are never sent to the site.
- **Server.** The admin is a convenience; the API enforces what a preview token may read, and nothing in visual
  editing writes content.

## Limits

- Clicks select fields; keyboard selection inside the site's page isn't supported. The admin's own controls are
  keyboard reachable.
- A click selects the innermost marked element. Unmarked parts of the page do nothing.
- Paths must match the model's API IDs. A path the model doesn't have shows a notice.
- One entry per preview. Related entries shown on the page (a populated author) can't be edited from it.
- Templates whose host depends on a variable open in a new tab only.
