import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

/**
 * Only this site and Shapio may frame its pages (Shapio's preview pane shows /preview/ beside the document):
 * sent by `vite dev` and `vite preview`, and written to build/_headers for hosts that read it (Cloudflare
 * Pages, Netlify); set the same header on any other host. The origin is PUBLIC_SHAPIO_URL, else SHAPIO_URL.
 */
const frameAncestors = (env: Record<string, string>) => {
  const shapio = originOf(env.PUBLIC_SHAPIO_URL || env.SHAPIO_URL || 'http://localhost:4300');
  return `frame-ancestors 'self'${shapio ? ` ${shapio}` : ''}`;
};

/**
 * Sets the policy on every response of `vite dev` and `vite preview` (registered before SvelteKit's own
 * middleware, which answers prerendered pages itself), and emits `_headers` into the client output, which
 * adapter-static copies into build/.
 */
const frameAncestorsPlugin = (policy: string): Plugin => {
  const setHeader = (server: { middlewares: Connect.Server }) => {
    server.middlewares.use((_request, response, next) => {
      response.setHeader('Content-Security-Policy', policy);
      next();
    });
  };
  return {
    name: 'shapio-frame-ancestors',
    configureServer: setHeader,
    configurePreviewServer: setHeader,
    generateBundle() {
      if (this.environment.name === 'client') {
        this.emitFile({
          type: 'asset',
          fileName: '_headers',
          source: `/*\n  Content-Security-Policy: ${policy}\n`,
        });
      }
    },
  };
};

/**
 * Static output: `npm run build` prerenders every page to plain HTML in build/ (any static host: Cloudflare
 * Pages, Netlify, a bucket). 404.html is served for unknown paths by hosts that support it.
 */
export default defineConfig(({ mode }) => {
  const policy = frameAncestors({ ...loadEnv(mode, process.cwd(), ''), ...process.env } as Record<
    string,
    string
  >);
  return {
    plugins: [frameAncestorsPlugin(policy), sveltekit({ adapter: adapter({ fallback: '404.html' }) })],
  };
});
