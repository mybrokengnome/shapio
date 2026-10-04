# @shapio/admin

The Shapio admin: a Vite + React 19 SPA, built once and served by the API at `{BASE_PATH}/admin/`. Private
package; `apps/api`'s `prepack` copies `dist/` into the published `@shapio/cms` package.

## Develop

```sh
pnpm --filter @shapio/cms dev      # API on http://127.0.0.1:4300
pnpm --filter @shapio/admin dev   # admin on http://127.0.0.1:5173/admin/ (proxies /api to the API)
```

`pnpm dev` at the root runs both. The dev server mounts the admin at `/admin/`, like production, and injects
`<base href="/admin/">` (the API injects `<base href="{BASE_PATH}/admin/">` in production), so the router's
basename and the API URL are both derived from `document.baseURI` the same way in both.

## Stack and layout

| Concern      | Choice                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Styling      | Tailwind CSS 4 (`@tailwindcss/vite`), tokens in `src/styles/index.css`                                                                    |
| Components   | shadcn/ui (Radix) in `src/components/ui` (kebab-case, CLI-generated, owned by us); Shapio components in `src/components/<Name>/index.tsx` |
| Server state | TanStack Query; hooks over `@shapio/client` in `src/api/`                                                                                 |
| Client state | Zustand: `src/stores/theme.ts`, `session.ts` (CSRF token), `ui.ts` (sidebar)                                                              |
| Routing      | TanStack Router, code-based route tree in `src/app/router.tsx`                                                                            |
| Forms        | react-hook-form + zod; field components in `src/components/Form*`                                                                         |
| Strings      | react-i18next; `src/locales/en/translation.json` is the only hand-edited file                                                             |
| Font         | Manrope variable (latin + latin-ext), self-hosted from `public/fonts` (SIL OFL 1.1, `public/fonts/OFL.txt`)                               |

**Why TanStack Router** (over React Router): search params are validated and typed per route (the audit log
keeps its filters and cursor in the URL), `beforeLoad` guards share the TanStack Query cache (`ensureQueryData`
for the session), `useBlocker` gives dirty-state protection, and `to` paths are type-checked. It is used
code-based, so there is no route-generation step.

Initialising shadcn: `shadcn init` is interactive, so `components.json` was written by hand (style `new-york`,
Tailwind 4 CSS-variable theme, `utils` alias `@/helpers/cn`) and components added with
`pnpm dlx shadcn@4 add <name>`. Review what the CLI adds to `package.json`: it tried to add `next-themes` and
an unrelated npm package called `cn`, both removed. Local edits to generated files are marked `Shapio:`.

## Theming

- Brand colours (`cobalt`, `periwinkle`, `ink`, `ivory`) and the semantic shadcn tokens (`background`,
  `primary`, `muted-foreground`, `link`, `success`...) are defined once in `src/styles/index.css`, each with a
  light value (`:root`) and a dark value (`.dark`). Components use the tokens, never hex values.
- Dark mode is the `dark` class on `<html>`. The preference (`system` | `light` | `dark`) lives in the theme
  store, persisted to `localStorage` (`shapio.theme`, wrapped in try/catch). `public/theme-init.js` applies it
  before first paint; it is an external script because the CSP forbids inline scripts.

## Runtime editors and the import map

Custom field editors are ES modules loaded at runtime (ADR 0009); installing one must never require rebuilding
this bundle. They import React and the SDK as bare specifiers, and the page resolves those through an import
map to the admin's own instances, so hooks and context work across the boundary (one React per page):

```html
<script type="importmap">
  {
    "imports": {
      "react": "./assets/shared-react-<hash>.js",
      "react/jsx-runtime": "./assets/shared-react-jsx-runtime-<hash>.js",
      "react-dom": "./assets/shared-react-dom-<hash>.js",
      "react-dom/client": "./assets/shared-react-dom-client-<hash>.js",
      "@shapio/editor-sdk": "./assets/shared-shapio-editor-sdk-<hash>.js"
    }
  }
</script>
```

How the build produces it (`build/sharedModules.ts`):

1. Each shared specifier becomes an extra Rollup/Rolldown entry, a virtual module that re-exports the package
   the admin itself imports. React's packages are CommonJS, so their export names are listed explicitly
   (read from the installed package at build time); `@shapio/editor-sdk` is ESM and uses `export *`.
2. `preserveEntrySignatures: 'exports-only'` keeps those exports. Because the entries and the app import the
   same module, the bundler puts it in one shared chunk: the app and every runtime editor get the same
   React instance. There is exactly one copy of React in `dist/`.
3. `transformIndexHtml` writes the import map with the hashed chunk names, before any module script. The
   URLs are relative and resolve against the injected `<base href>`, so one build works under any `BASE_PATH`,
   and the hashed files are cached forever like every other asset.
4. In development the map points at Vite's virtual-module URLs (`/admin/@id/__x00__shapio-shared:react`),
   which import the same pre-bundled dependency the app uses.

The map is an inline script, which the API's CSP (`script-src 'self'`) would block. The API hashes the import
map in `index.html` at startup and adds exactly that `'sha256-…'` source to `script-src` on the admin page
(`apps/api/src/plugins/staticAdmin.ts`), so no `'unsafe-inline'` is needed.

Editor authors build with `react`, `react-dom` and `@shapio/editor-sdk` marked external (see
[Custom field editors](#custom-field-editors)).

## Content and field editors

`src/features/Content` is the content UI: per-model lists (`/content/$modelKey`: columns from the model's
display config, search over the title field, filters using the API's operator allowlist, sort, pages, bulk
publish/unpublish/delete) and the entry form (`/content/$modelKey/$entryId?locale=`). Models are data: routes
carry a model's API key and resolve it from the live schema, so a model created a moment ago is editable at once.

The form is generated from the model (`src/fields/form`): one Zustand store per open form holds the values
(keyed by API key, like the admin API) and the baseline the server last returned; each field subscribes to its
own value. Saving sends only changed fields (the API's PUT is a patch). Autosave runs a moment after the last
change with the API's `autosave` flag (no revision, `required` not enforced); **Save** creates a revision and
validates everything; **Publish** is per locale and, when other published locales still serve older shared
values (`sharedOutdatedLocales`), offers to publish them too. A 409 (`CONTENT_VERSION_CONFLICT`,
`SCHEMA_CHANGED`) opens a dialog to reload and keep one's changes, or discard them. Server issues (422
`CONTENT_INVALID`) are JSON pointers in API keys and land on the field with the same path.

Built-in editors live in `src/fields/<Name>/`, keyed by catalogue ID in `src/fields/registry.ts` (the catalogue
itself, with option schemas, is `EDITOR_CATALOGUE` in `@shapio/schema`). Every editor gets the public contract
from `@shapio/editor-sdk` (`FieldEditorProps`); built-ins also get the field definition and the value's path.
Rich text is Tiptap's open-source core, configured to produce exactly the `shapio-richtext` v1 document the server
validates (`packages/schema/src/richtext/spec.ts`); `src/fields/RichTextField/richTextContract.test.ts` checks the
schema against the server validator, and `richTextDocument.ts` holds the `format.version` migration hook. Media
values are asset IDs (reads return asset views; the form keeps IDs and previews from the media query cache).

## Custom field editors

A project adds editors without rebuilding Shapio: **build, copy, list, restart.**

1. Write a React component against `@shapio/editor-sdk` and export it with `defineEditor` (see
   `examples/custom-editor`, a star rating for integer fields):

   ```tsx
   import { defineEditor, type FieldEditorProps } from '@shapio/editor-sdk';

   const StarRating = ({ inputId, labelId, value, onChange, onBlur, validation, field, context }: FieldEditorProps<'integer'>) => …;

   export const editor = defineEditor({ id: 'acme.starRating', dataTypes: ['integer'], component: StarRating });
   ```

2. Build one ES module with `react`, `react/jsx-runtime`, `react-dom` and `@shapio/editor-sdk` external (they
   resolve to the admin's own copies through the import map), and copy it to the project's
   `extensions/editors/`, e.g. `extensions/editors/star-rating.js`.
3. List the file in the project's `shapio.config.ts` (written by `create-shapio`):

   ```ts
   import { defineConfig } from '@shapio/cms/config';

   export const config = defineConfig({ hooks: {}, editors: ['star-rating.js'] });
   ```

   `editors` holds file names inside `extensions/editors/`. The config's keys are `hooks`, `routes`, `services`,
   `editors` and `jobs`; an unknown key fails startup with a message naming it.

4. Restart Shapio. Then choose the editor for a field in the model builder (editor ID `acme.starRating`, with any
   options); choosing and configuring it is live, like any modelling change.

The contract (`EDITOR_CONTRACT_VERSION`): the value (`null` when empty) and `onChange`, `onBlur`, the validation
messages, `readOnly`/`disabled`, the field's metadata (ID, API key, label, type, settings, editor options) and its
model's, the DOM ids to label and describe the control, and a limited context: the content locale, the entry ID,
`pickMedia()` (opens the media library) and `translate()`. Editors get no network client, session or secrets.
The server validates the value exactly as it does for the built-in editor, so a custom editor can never let an
invalid value through. Editors are styled by themselves (they are not part of the admin's Tailwind build); using
the admin's CSS variables (`var(--primary)`, `var(--border)`, `var(--muted-foreground)`…) follows light and dark
mode.

How it is served and loaded: the extension loader reads `shapio.config` at startup and passes `editors` to
`buildEditorManifest` (`apps/api/src/extensions/editorManifest.ts`), which checks the files; the API serves the manifest at `GET /api/admin/extensions/editors` and each
listed module at `GET /api/admin/extensions/editors/<file>?v=<hash>` (admins only; nothing else on disk is
reachable). `src/fields/runtime` imports every module once per session; an editor built for another contract
version, a module without an editor, a duplicate ID or a module that fails to load is skipped and the field falls
back to its built-in editor, as does a field whose custom editor throws while rendering (an error boundary).

## Conventions enforced by tests

`src/test/conventions.test.ts` fails on hard-coded user-facing text in JSX (text, `aria-label`, `title`,
`placeholder`, `alt`, `label`), raw hex colours, interpolated class names and default exports.
`src/test/translations.test.ts` fails on empty or unused translation keys. Translation keys are type-checked
(`src/app/i18next.d.ts`).

## End-to-end tests

`e2e/` drives the production build against the real API, run from source on a fresh database under
`BASE_PATH=/cms`: first-run setup, sign in/out, every settings screen, invitations and password reset (links
read from the console email transport in the server log), the SPA fallback for nested URLs, the import map,
and a phone-width shell. `e2e/content.spec.ts` runs against its own server: a `create-shapio` project with the
example custom editor built and installed (`e2e/content/projectServer.ts`), on its own database, and covers the
brief's page in two locales, autosave and Save, per-locale publishing, conflicts, history, the list and the
custom editor's server validation. Every screen is screenshotted in light and dark and checked with axe (no serious or
critical violations).

```sh
pnpm --filter @shapio/admin build
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @shapio/admin e2e
# Screenshots: apps/admin/e2e/.artifacts/screenshots (or SHAPIO_E2E_SCREENSHOTS=<dir>)
```

Needs Chromium for Playwright (`pnpm --filter @shapio/admin exec playwright install chromium`).
