# @shapio/visual

Visual editing for sites built on [Shapio](https://github.com/mybrokengnome/shapio): mark the elements that show
a field, run one script on the preview page, and in Shapio's preview pane a click on the page focuses that field
in the document. Saves re-render the page. No dependencies, no framework required.

```sh
npm install @shapio/visual
```

```tsx
import { initVisualEditing, shapioAttr } from '@shapio/visual';

// Anywhere a field is rendered (published pages may carry the attributes too):
<h1 {...shapioAttr(article, 'title')}>{article.title}</h1>
<h2 {...shapioAttr(page, `sections/${index}/heading`)}>{section.heading}</h2>

// On the preview page, once:
initVisualEditing({ origin: 'https://cms.example.com', onRefresh: () => renderDraft() });
```

- `shapioAttr(entry, path, locale?)` returns `data-shapio-entry`, `data-shapio-path` and `data-shapio-locale` as
  an object to spread. `entry` is a delivery item (`{ id, locale }`) or an entry ID; `path` uses API IDs, with
  list positions and nested fields after slashes.
- `initVisualEditing({ origin, onRefresh? })` runs only inside a frame on a URL with `?shapio-visual=1`. It
  outlines marked elements on hover, posts the clicked field to the parent window with `origin` as the target
  (the only origin it talks to), and on a refresh request from that origin calls `onRefresh`, or reloads the
  page when there is none. It returns a function that turns it off.
- Plain script: `dist/visual.iife.js` (`@shapio/visual/global`) exposes `window.ShapioVisual`, and starts by
  itself when its `<script>` tag has `data-shapio-origin="https://cms.example.com"`.

The site also sends `Content-Security-Policy: frame-ancestors 'self' https://cms.example.com`, so only it and
Shapio can frame its pages. The full guide, including the security model:
[Visual editing](https://github.com/mybrokengnome/shapio/blob/main/documentation/visual-editing.md).

Apache-2.0.
