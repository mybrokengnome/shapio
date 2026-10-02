import type { Plugin } from 'vite';

/**
 * In production the API injects `<base href>`; the dev server does the same so the router's basename and
 * the API URL (both derived from `document.baseURI`) behave identically in both.
 */
export const devBaseHrefPlugin = (baseHref: string): Plugin => ({
  name: 'shapio-dev-base-href',
  apply: 'serve',
  transformIndexHtml: () => [{ tag: 'base', attrs: { href: baseHref }, injectTo: 'head-prepend' }],
});
