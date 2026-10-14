import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { ThemeCatalog } from '../extensions/themeStylesheet.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Admin color themes from the project (read at startup; docs/plans/themes.md). */
    themeCatalog: ThemeCatalog;
  }
}

/** The catalog is built from the project config by the app (extensions/themeStylesheet.ts). */
export const themeCatalogPlugin = fp<{ catalog: ThemeCatalog }>(
  async (app: FastifyInstance, { catalog }) => {
    app.decorate('themeCatalog', catalog);
  },
  { name: 'shapio-theme-catalog' },
);
