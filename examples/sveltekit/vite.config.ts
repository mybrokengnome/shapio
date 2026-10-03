import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/**
 * Static output: `npm run build` prerenders every page to plain HTML in build/ (any static host: Cloudflare
 * Pages, Netlify, a bucket). 404.html is served for unknown paths by hosts that support it.
 */
export default defineConfig({
  plugins: [sveltekit({ adapter: adapter({ fallback: '404.html' }) })],
});
