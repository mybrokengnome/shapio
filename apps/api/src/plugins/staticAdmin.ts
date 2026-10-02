import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { UrlBuilder } from '../helpers/publicUrl.js';

type StaticAdminOptions = { distPath: string | undefined; urls: UrlBuilder };

export const ADMIN_PATH = '/admin/';

/**
 * Injects `<base href>` so the admin, built with relative asset URLs (Vite `base: './'`), works under
 * any BASE_PATH without a rebuild. The SPA router reads its basename from `document.baseURI`.
 */
export const injectBaseHref = (html: string, baseHref: string): string =>
  html.replace(/<head(\s[^>]*)?>/i, (head) => `${head}\n    <base href="${baseHref}" />`);

/** The last path segment has an extension (`app-abc.js`, `logo.svg`): a file request, not an SPA route. */
export const looksLikeFile = (url: string): boolean => {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return /\.[A-Za-z0-9]+$/.test(path.slice(path.lastIndexOf('/') + 1));
};

const IMPORT_MAP_PATTERN = /<script type="importmap">([\s\S]*?)<\/script>/gi;

/**
 * CSP source expressions (`'sha256-…'`) for the inline import map(s) in the admin's index.html. The import
 * map shares React with runtime-loaded editors (ADR 0009) and must be inline (browsers don't load external
 * import maps); hashing it keeps `script-src` free of `'unsafe-inline'`.
 */
export const importMapHashes = (html: string): string[] =>
  [...html.matchAll(IMPORT_MAP_PATTERN)].map(
    ([, content]) =>
      `'sha256-${createHash('sha256')
        .update(content ?? '')
        .digest('base64')}'`,
  );

/** Adds sources to the `script-src` directive of a CSP header value (creating the directive if absent). */
export const addScriptSources = (csp: string, sources: readonly string[]): string => {
  if (sources.length === 0) {
    return csp;
  }
  const directives = csp
    .split(';')
    .map((directive) => directive.trim())
    .filter(Boolean);
  const index = directives.findIndex((directive) => /^script-src(\s|$)/i.test(directive));
  if (index === -1) {
    return [...directives, `script-src 'self' ${sources.join(' ')}`].join(';');
  }
  directives[index] = `${directives[index]} ${sources.join(' ')}`;
  return directives.join(';');
};

/**
 * Serves the prebuilt admin SPA at `${BASE_PATH}/admin/` with an SPA fallback, and redirects the bare
 * `${BASE_PATH}/` to it. Without a build (development before `vite build`), nothing is served here.
 */
export const staticAdminPlugin = fp<StaticAdminOptions>(
  async (app: FastifyInstance, { distPath, urls }) => {
    const indexFile = distPath ? join(distPath, 'index.html') : undefined;
    if (!distPath || !indexFile || !existsSync(indexFile)) {
      app.log.info('admin bundle not found; the admin UI is not served (run the Vite dev server instead)');
      return;
    }
    const adminPrefix = urls.withBasePath(ADMIN_PATH);
    const indexHtml = injectBaseHref(readFileSync(indexFile, 'utf8'), adminPrefix);
    const scriptHashes = importMapHashes(indexHtml);
    const sendIndex = async (_request: FastifyRequest, reply: FastifyReply) => {
      // Helmet has set the CSP header by now (onRequest); allow exactly this page's inline import map.
      const csp = reply.getHeader('content-security-policy');
      if (typeof csp === 'string') {
        void reply.header('content-security-policy', addScriptSources(csp, scriptHashes));
      }
      return reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8').send(indexHtml);
    };

    await app.register(async (admin) => {
      await admin.register(fastifyStatic, {
        root: distPath,
        prefix: adminPrefix,
        index: false,
        wildcard: false,
        decorateReply: false,
        // Vite emits content-hashed file names under assets/, so they can be cached forever.
        setHeaders: (reply, path) => {
          if (path.includes(`${join('/', 'assets', '/')}`)) {
            void reply.header('cache-control', 'public, max-age=31536000, immutable');
          }
        },
      });
      // Client-side routes (anything under the admin prefix that is not a file) get the SPA shell. A missing
      // file (a stale hashed asset, a typo) is a 404, not HTML served with a 200 as JavaScript or CSS.
      admin.get(`${adminPrefix}*`, async (request, reply) =>
        looksLikeFile(request.url) ? reply.callNotFound() : sendIndex(request, reply),
      );
      admin.get(adminPrefix, sendIndex);
    });
    app.get(urls.withBasePath('/admin'), async (_request, reply) => reply.redirect(adminPrefix, 301));
    app.get(urls.withBasePath('/'), async (_request, reply) => reply.redirect(adminPrefix, 302));
    if (urls.basePath !== '') {
      app.get(urls.basePath, async (_request, reply) => reply.redirect(adminPrefix, 302));
    }
  },
  { name: 'shapio-static-admin' },
);
