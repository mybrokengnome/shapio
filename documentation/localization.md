# Localization

Shapio stores content in several languages (locales) natively: no plugin, no duplicated models.

## Locales

Settings → Locales lists them: a code (`en`, `fr`, `pt-BR`), a label, one **default** locale, and for each
locale an optional **fallback chain** (`fr-CA` → `fr` → `en`). A new instance has `en` as the default.

- Adding a locale is live.
- Changing the default changes what the API serves when no locale is asked for, so it is a contract change you
  confirm.
- Deleting a locale removes its content (in a background job), so it is destructive and you confirm it. The
  default locale cannot be deleted.

## Localized models and fields

A model is **localized** or not. In a localized model each field is either:

- **localized**: its value differs per locale (titles, body text), or
- **shared**: one value for every locale (a slug, a price, a cover image, a relation to the author).

Any field type can be localized, media and relations included. Fields of a model that is not localized are
always shared.

Each locale of an entry is a complete document. When an editor saves a shared field in one locale, Shapio
writes the new value into the draft of every other locale of that entry in the same transaction, so all locales
agree. The entry form marks shared and localized fields, and can copy the default locale's values into a new
locale.

## Publishing is per locale

Publishing French never changes the live English version. Because a shared value changed in French is already
in the English **draft**, the admin then tells you that _N other published locales have newer shared values_
and offers to publish them too, in one action. Change set items and scheduled publications are per locale as well
([Content](content.md)).

## Reading localized content

REST: `GET /api/content/articles?locale=fr`. When an entry has no French version, Shapio follows the fallback
chain and serves the first locale that has one. The response says what happened:

```json
{
  "data": [{ "id": "…", "locale": "en", "title": "Hello" }],
  "meta": {
    "locale": "fr",
    "snapshot": 42,
    "pagination": { "page": 1, "pageSize": 25, "total": 1, "pageCount": 1 }
  }
}
```

`meta.locale` is the locale you asked for; each entry's `locale` is the one that served it. Without `?locale=`
the default locale is used.

GraphQL takes `locale` on every query, `fallback: false` to get only entries that exist in that locale, and
exposes `localizations` on each entry ([GraphQL](graphql.md)).

## Uniqueness across locales

A unique localized field must be unique within each locale; a unique shared field across all locales.
