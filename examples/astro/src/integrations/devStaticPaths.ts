import type { AstroIntegration } from 'astro';
import { DEV_WINDOW_MS } from '../lib/snapshotResolver.js';

/**
 * `astro dev` caches each dynamic route's getStaticPaths result until the route module changes. Content comes
 * from Shapio, not from files, so an article (or a draft, in drafts mode) created after the dev server started
 * has no path and its page 404s.
 *
 * This integration clears that cache before a page request, at most once per DEV_WINDOW_MS (the window the
 * content reads reuse), so getStaticPaths runs again with fresh content. Every page of the starter is a dynamic
 * route (`/[locale]/…`), so every request counts as a page request except Astro's and Vite's own (`/_astro/`,
 * `/@vite`, `/@fs`, `/@id`, `/src/`, `/node_modules/`) and anything that looks like a file. It relies on an Astro
 * internal: Astro clears its route cache when the `astro:content-changed` event reaches the ssr and prerender
 * Vite environments (astro/dist/vite-plugin-app/createAstroServerApp.js, sent by
 * astro/dist/content/vite-plugin-content-virtual-mod.js). Dev only: `astro build` never runs
 * `astro:server:setup`, and the hook does nothing unless the command is `dev`.
 */

/** Path prefixes of Astro's and Vite's own dev requests (assets, modules, the client): never a page. */
export const TOOLING_PATH_PREFIXES = ['/_astro/', '/@vite', '/@fs', '/@id', '/src/', '/node_modules/'];

/** The Vite environments that run Astro's renderer and hold its route cache. */
const RENDER_ENVIRONMENTS = ['ssr', 'prerender'];

/** A last path segment with an extension (`favicon.svg`, `build.json`): a file, not a page. */
const looksLikeFile = (pathname: string) =>
  /\.[A-Za-z0-9]+$/.test(pathname.slice(pathname.lastIndexOf('/') + 1));

const isPageRequest = (pathname: string) =>
  !TOOLING_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix)) && !looksLikeFile(pathname);

/**
 * Whether a request should clear the route cache: a page request, when the last clear is at least
 * DEV_WINDOW_MS old.
 */
export const staticPathsRefresher = (now: () => number = Date.now) => {
  let lastClearAt: number | undefined;
  return (url: string | undefined): boolean => {
    if (!isPageRequest(new URL(url ?? '/', 'http://localhost').pathname)) {
      return false;
    }
    const at = now();
    if (lastClearAt !== undefined && at - lastClearAt < DEV_WINDOW_MS) {
      return false;
    }
    lastClearAt = at;
    return true;
  };
};

/** The dev server Astro hands `astro:server:setup` (Vite's; vite is not a direct dependency here). */
type DevServer = Parameters<NonNullable<AstroIntegration['hooks']['astro:server:setup']>>[0]['server'];

const clearRouteCache = (server: DevServer) => {
  for (const name of RENDER_ENVIRONMENTS) {
    server.environments[name]?.hot.send('astro:content-changed', {});
  }
};

export const devStaticPaths = (): AstroIntegration => {
  let isDev = false;
  return {
    name: 'dev-static-paths',
    hooks: {
      'astro:config:setup': ({ command }) => {
        isDev = command === 'dev';
      },
      'astro:server:setup': ({ server }) => {
        if (!isDev) {
          return;
        }
        const shouldClear = staticPathsRefresher();
        server.middlewares.use((request, _response, next) => {
          if (shouldClear(request.url)) {
            clearRouteCache(server);
          }
          next();
        });
      },
    },
  };
};
