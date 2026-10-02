# Example custom field editor: star rating

A Shapio field editor for `integer` fields, built as its own small package, **outside** Shapio's admin bundle,
and loaded by the admin at runtime. Installing it is a file copy and a restart; Shapio is never rebuilt.

## Build

```sh
npm install
npm run build        # → dist/star-rating.js (one ES module)
```

`vite.config.ts` keeps `react`, `react/jsx-runtime`, `react-dom` and `@shapio/editor-sdk` as bare imports. The admin
publishes an import map that resolves them to its own copies, so the editor shares the admin's React.

## Install in a Shapio project (`npx create-shapio my-cms`)

1. Copy `dist/star-rating.js` to `my-cms/extensions/editors/star-rating.js`.
2. In `my-cms/shapio.config.ts`, list it in `defineConfig` (imported from `shapio/config`):
   `editors: ['star-rating.js']`.
3. Restart Shapio (`npm run start`, or restart the PM2/systemd service).
4. In the admin's model builder, set an integer field's editor to `acme.starRating`. The editor option `stars`
   sets how many stars it shows (default 5). Choosing the editor is a live modelling change.

## What it shows

- The contract from `@shapio/editor-sdk`: `value`/`onChange`, `onBlur`, validation messages, `readOnly`/`disabled`,
  field metadata (`field.options.stars`), `labelId`/`describedBy` for accessible labelling, and `context.translate`.
- Accessibility: radio-group semantics, arrow keys, a clear button, visible focus.
- Theming: inline styles that use the admin's CSS variables (`var(--primary)`, `var(--border)`…), so light and dark
  mode just work.
- Validation stays on the server: the field's own `min`/`max` are enforced whatever the editor offers. The admin's
  end-to-end suite installs this editor with 8 stars on a field whose maximum is 5 and checks that choosing 8 is
  refused by the server and shown inline.
