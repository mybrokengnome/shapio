import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { devBaseHrefPlugin } from './build/devBaseHref.js';
import { sharedModulesPlugin } from './build/sharedModules.js';

/** Where the dev server mounts the admin: the same path the API serves the production build at. */
const DEV_BASE = '/admin/';

export default defineConfig(({ command }) => ({
  // Production: relative asset URLs. The API injects <base href="{BASE_PATH}/admin/"> at serve time, so one
  // build works under any BASE_PATH. Dev: mounted at /admin/ like production, /api proxied to the API.
  base: command === 'build' ? './' : DEV_BASE,
  plugins: [react(), tailwindcss(), sharedModulesPlugin(), devBaseHrefPlugin(DEV_BASE)],
  resolve: {
    conditions: ['@shapio/source'],
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4300' },
  },
  build: { outDir: 'dist', sourcemap: true },
}));
