# SEO fields

Shapio has a built-in SEO field group, which any content type can add in one click. Each site has its own SEO
defaults, and the delivery API can return each entry's effective values with the defaults already filled in.
The group is an ordinary shared component, so it is schema data like any other: a schema version, visible in
Schema as code, pulled by `shapio schema pull` as `components/seo.json`. Nothing about it needs a restart.

## The SEO component

| Field                    | API ID        | Type                  | Notes                                                     |
| ------------------------ | ------------- | --------------------- | --------------------------------------------------------- |
| Title                    | `title`       | short text            | The admin counts characters up to 70; nothing enforces it |
| Description              | `description` | long text             | Counted up to 160 characters                              |
| Social image             | `image`       | media, one image      | `og:image` and `twitter:image`                            |
| Canonical URL            | `canonical`   | URL (`https`, `http`) | Only when the page's canonical URL is not its own         |
| Hide from search engines | `noindex`     | boolean               | `<meta name="robots" content="noindex">`                  |

Shapio recognises the component by its fixed stable ID (`SEO_COMPONENT_ID` in `@shapio/client`), never by its
API ID. You can relabel it, rename its API IDs or add fields of your own: the resolved values still find
the five fields by their stable IDs, and fields you add pass through untouched. The component is always
**shared with all sites**: one shared copy serves every site's content types.

## Add SEO fields to a content type

In the content type's **Structure**, open the menu beside **Add field** and choose **SEO fields**. The
builder adds a field `seo` (or `seo2`, … when that API ID is taken) that holds the SEO component, then you
review and ship the change as usual. On a localized content type the field is localized too (every locale has
its own title and description); you can switch that off on the field.

The first time, the SEO component itself does not exist yet. Creating it changes every site's schema, so it
needs `schema.create` on every site (a network admin): they confirm **Enable SEO**, and the component is
created as its own schema version before the field is added. A site admin sees the action disabled with "Ask
a network admin to enable SEO" until then; once the component exists, anyone who can change the content type
can add the field. The API behind it is `POST /api/admin/components/builtin/seo/ensure` (201 when it created
the component, 200 when it was already there).

**An existing `seo` component blocks it.** If another definition already uses the API ID `seo`, for example
the one a [Strapi import](importers.md) makes from Strapi's `shared.seo`, enabling SEO is refused with
`SEO_COMPONENT_CONFLICT`, naming that definition and its site. Rename its API ID (or delete it), then enable
SEO again; the imported component and its content are not converted.

In the entry document, the SEO field shows the character counts and a search-result preview built from the
site's title template and defaults.

## SEO defaults per site

**Settings → SEO** holds the current site's defaults:

- per locale: the **site name**, the **title template** (`%s · Acme`: `%s` is replaced by the page's title;
  it must contain `%s` exactly once) and the **default description**. A locale without its own value uses its
  [fallback locales](localization.md), then the default locale;
- for the whole site: the **default social image** (a public image of this site's media library; a private
  image is refused, and one made private later is never shown) and the **Twitter handle** (`@name`).

Reading the defaults needs read access to some content of the site (editors see them in the entry preview);
changing them needs the site action `site.settings`, which roles that hold `publishing.manage` have. A change
sends a `site.updated` [webhook](publishing.md) event: a site that renders the defaults rebuilds or
revalidates on it. The API is `GET` and `PUT /api/admin/site/seo` (with the `Shapio-Site` header), the `PUT`
taking `{ expectedVersion, seo }` and refusing a stale version with 409.

## Reading resolved SEO

Delivery and preview reads take `seo=raw|resolved`. `raw` (the default) returns SEO fields as stored;
`resolved` returns each SEO field the response carries with the site's defaults filled in, in the entry's
locale:

- `title`: the entry's SEO title, else its own title (its title field, when your token may read it), through
  the title template. With neither, the bare site name (not templated);
- `description`: the entry's, else the default description;
- `image`: the entry's, else the default social image (in the same shape as any media field);
- `canonical`: the entry's value or `null`. Shapio does not know your page URLs, so your site builds its own
  canonical URL from its address and the path;
- `noindex`: `true` or `false`, never `null`.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://cms.example.com/api/content/articles/<id>?seo=resolved&locale=fr"
```

```json
{
  "data": {
    "title": "Pourquoi nos builds figent un instantané",
    "seo": {
      "title": "Pourquoi nos builds figent un instantané · Studio Northwind",
      "description": "Un build qui lit du contenu pendant deux minutes…",
      "image": {
        "id": "…",
        "url": "https://cms.example.com/api/media/f/public/…",
        "width": 1600,
        "height": 900
      },
      "canonical": null,
      "noindex": false
    }
  }
}
```

`seo=resolved` on a content type without a readable SEO field is refused with 400. Populated entries are
resolved too. The defaults are not part of a publication snapshot: `?snapshot=N&seo=resolved` merges the
pinned content with **today's** defaults.

With `@shapio/client`: `client.delivery.get('articles', id, { seo: 'resolved' })`; the types are `SeoFields`
(raw) and `SeoResolved`.

## The site and its defaults

`GET /api/site` returns the request's site (the token's, or `?site=`) with its defaults, for pages that have no
entry (listings, a 404) and for clients that merge SEO themselves:

```json
{
  "key": "default",
  "name": "Default site",
  "seo": {
    "locales": { "en": { "siteName": "Acme", "titleTemplate": "%s · Acme", "description": "…" } },
    "twitterHandle": "@acme",
    "image": { "id": "…", "url": "…" }
  }
}
```

It needs the same access as the site's content (a caller that reads nothing on the site gets 401 or 403). In
`@shapio/client` it is `client.site.get()`.

## GraphQL

GraphQL returns SEO fields as stored (there is no resolved argument) and has a `_site` root field with the
same data as `GET /api/site`:

```graphql
{
  _site {
    key
    name
    seo {
      twitterHandle
      image {
        url
        width
        height
        alt
      }
      locales {
        locale
        siteName
        titleTemplate
        description
      }
    }
  }
}
```

Merge them with `resolveSeo()` from `@shapio/client` (also in the dependency-free `@shapio/schema/seo` entry),
the same function the server uses:

```ts
import { resolveSeo, seoDefaultsForLocale } from '@shapio/client';

const defaults = seoDefaultsForLocale(site.seo, ['fr', 'en']);
const seo = resolveSeo(article.seo, { defaults, image: site.seo.image, fallbackTitle: article.title });
```

## In the starters

The [site starters](starters.md) add the SEO field to Article and Page, set each site's defaults from the
seed, read entries with `seo=resolved` and render the title, description, Open Graph and Twitter tags,
`robots` and, with `SITE_URL` set, the canonical URL. Their seed applies `components/seo.json` shared with all
sites, whatever site it seeds.
