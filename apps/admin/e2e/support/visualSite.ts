import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

const VISUAL_SCRIPT = join(import.meta.dirname, '../../../../packages/visual/dist/visual.iife.js');

/**
 * A stand-in site on a second origin (another port), for the preview pane: `/preview/` renders an entry with
 * `shapioAttr`-style attributes and runs @shapio/visual's plain-script build (counting refreshes on screen);
 * `/plain/` is the same page without the SDK. It answers with `frame-ancestors` for Shapio's origin, as the
 * starters do. Needs `pnpm build` (the visual package's dist).
 */
export const startVisualSite = async (shapioOrigin: string) => {
  const script = readFileSync(VISUAL_SCRIPT, 'utf8');
  const page = (withSdk: boolean) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Fake site</title>
    ${withSdk ? '<script src="/visual.js"></script>' : ''}
  </head>
  <body style="font-family: sans-serif; color: #0f172a; background: #ffffff; margin: 2rem">
    <main>
      <h1 id="title">Preview of the draft</h1>
      <p id="body">The body of the story.</p>
      <p id="refreshes">Refreshed 0 times</p>
    </main>
    <script>
      const id = new URLSearchParams(location.search).get('id') || '';
      for (const [element, path] of [['title', 'title'], ['body', 'body']]) {
        const node = document.getElementById(element);
        node.setAttribute('data-shapio-entry', id);
        node.setAttribute('data-shapio-path', path);
      }
      let refreshes = 0;
      if (window.ShapioVisual) {
        window.ShapioVisual.initVisualEditing({
          origin: ${JSON.stringify(shapioOrigin)},
          onRefresh: () => {
            refreshes += 1;
            document.getElementById('refreshes').textContent = 'Refreshed ' + refreshes + ' times';
          },
        });
      }
    </script>
  </body>
</html>`;
  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    if (path === '/visual.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(script);
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': `frame-ancestors ${shapioOrigin}`,
    });
    response.end(page(path !== '/plain/'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};
