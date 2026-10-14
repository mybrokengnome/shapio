import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { escapeHtml } from '@shapio/schema';
import type { PLAYGROUND_THEMES } from '../../../constants/graphql.js';

/**
 * GraphiQL for admins (`/api/graphql/playground`), served entirely by Shapio: the vendored GraphiQL 3 and
 * React 18 browser builds (scripts/vendorGraphiql.mjs) plus a small bootstrap script. No CDN, no inline
 * script (the CSP allows same-origin scripts only). The bootstrap fetches the session's CSRF token, which
 * every GraphQL request from a cookie session must carry.
 */
export type PlaygroundAsset = { body: Buffer; contentType: string };

const VENDOR_FILES: Readonly<Record<string, string>> = {
  'graphiql.min.js': 'text/javascript; charset=utf-8',
  'graphiql.min.css': 'text/css; charset=utf-8',
  'react.production.min.js': 'text/javascript; charset=utf-8',
  'react-dom.production.min.js': 'text/javascript; charset=utf-8',
};

/** `vendor/graphiql` next to `dist/` in the published package, or at the package root in the repository. */
const findVendorDir = (): string | undefined =>
  [
    resolve(import.meta.dirname, '../vendor/graphiql'),
    resolve(import.meta.dirname, '../../../../vendor/graphiql'),
  ].find((path) => existsSync(resolve(path, 'graphiql.min.js')));

const BOOTSTRAP = `(() => {
  const root = document.getElementById('graphiql');
  const endpoint = root.dataset.endpoint;
  const csrfUrl = root.dataset.csrf;
  const props = { shouldPersistHeaders: false };
  if (root.dataset.query) {
    props.query = root.dataset.query;
  }
  if (root.dataset.theme) {
    props.forcedTheme = root.dataset.theme;
  }
  // GraphiQL's CodeMirror editors render bare textareas; name them for screen readers, on every tab.
  const name = (textarea, label) => {
    if (textarea && textarea.getAttribute('aria-label') !== label) {
      textarea.setAttribute('aria-label', label);
    }
  };
  const labelEditors = () => {
    name(root.querySelector('.graphiql-query-editor textarea'), 'Query');
    root.querySelectorAll('.graphiql-editor-tool .graphiql-editor').forEach((editor, index) => {
      name(editor.querySelector('textarea'), index === 0 ? 'Variables' : 'Headers');
    });
    name(root.querySelector('.result-window textarea'), 'Response');
  };
  const start = (csrfToken) => {
    const fetcher = GraphiQL.createFetcher({ url: endpoint, headers: { 'x-csrf-token': csrfToken } });
    ReactDOM.createRoot(root).render(React.createElement(GraphiQL, { ...props, fetcher }));
    new MutationObserver(labelEditors).observe(root, { childList: true, subtree: true });
  };
  fetch(csrfUrl, { credentials: 'same-origin' })
    .then((response) => {
      if (!response.ok) {
        throw new Error('Sign in to the Shapio admin first (' + response.status + ')');
      }
      return response.json();
    })
    .then((body) => start(body.csrfToken))
    .catch((error) => {
      root.textContent = String(error.message || error);
    });
})();
`;

const THEMED = [
  '.graphiql-container',
  '.CodeMirror-info',
  '.CodeMirror-lint-tooltip',
  '.graphiql-dialog',
  '.graphiql-tooltip',
  '[data-radix-popper-content-wrapper]',
];
const themed = (theme: 'light' | 'dark') =>
  THEMED.map((selector) => `body.graphiql-${theme} ${selector}`).join(',\n');

/**
 * Page layout, and GraphiQL's palette adjusted to WCAG AA: every text color (syntax highlighting, links,
 * secondary text) reaches 4.5:1 on the backgrounds it is drawn on, in both themes (GraphiQL's own light
 * palette is 2.3–4.3:1 there), and links in the docs are underlined so they don't rely on color alone.
 */
const STYLE = `html, body, #graphiql { height: 100%; margin: 0; }
${themed('light')} {
  --alpha-secondary: 0.9;
  --color-primary: 320, 95%, 38%;
  --color-secondary: 242, 51%, 56%;
  --color-tertiary: 188, 100%, 25%;
  --color-info: 208, 100%, 37%;
  --color-success: 158, 60%, 27%;
  --color-warning: 36, 100%, 28%;
  --color-error: 13, 93%, 38%;
}
${themed('dark')} {
  --alpha-secondary: 0.9;
  --color-primary: 338, 100%, 77%;
  --color-secondary: 243, 100%, 83%;
  --color-error: 13, 100%, 72%;
}
.graphiql-doc-explorer a { text-decoration: underline; }`;

export const loadPlaygroundAssets = (): Map<string, PlaygroundAsset> => {
  const assets = new Map<string, PlaygroundAsset>();
  assets.set('playground.js', {
    body: Buffer.from(BOOTSTRAP),
    contentType: 'text/javascript; charset=utf-8',
  });
  assets.set('playground.css', { body: Buffer.from(STYLE), contentType: 'text/css; charset=utf-8' });
  const dir = findVendorDir();
  if (dir) {
    for (const [file, contentType] of Object.entries(VENDOR_FILES)) {
      assets.set(file, { body: readFileSync(resolve(dir, file)), contentType });
    }
  }
  return assets;
};

export type PlaygroundTheme = (typeof PLAYGROUND_THEMES)[number];

/**
 * What the page opens with: `query` fills the editor (a new tab unless one already holds it) and `theme`
 * fixes GraphiQL's light or dark theme (the admin passes its look's variant); both optional.
 */
export type PlaygroundOptions = { query?: string; theme?: PlaygroundTheme };

const dataAttribute = (name: string, value: string | undefined) =>
  value === undefined || value === '' ? '' : ` data-${name}="${escapeHtml(value)}"`;

/** The playground page; `assetsPath` and the URLs are absolute paths (BASE_PATH included). */
export const renderPlaygroundPage = (
  urls: { assets: string; endpoint: string; csrf: string },
  options: PlaygroundOptions = {},
): string => {
  const asset = (file: string) => escapeHtml(`${urls.assets}/${file}`);
  const extra = dataAttribute('query', options.query) + dataAttribute('theme', options.theme);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shapio GraphQL</title>
<link rel="stylesheet" href="${asset('graphiql.min.css')}">
<link rel="stylesheet" href="${asset('playground.css')}">
</head>
<body>
<div id="graphiql" data-endpoint="${escapeHtml(urls.endpoint)}" data-csrf="${escapeHtml(urls.csrf)}"${extra}>Loading…</div>
<script src="${asset('react.production.min.js')}"></script>
<script src="${asset('react-dom.production.min.js')}"></script>
<script src="${asset('graphiql.min.js')}"></script>
<script src="${asset('playground.js')}"></script>
</body></html>`;
};
