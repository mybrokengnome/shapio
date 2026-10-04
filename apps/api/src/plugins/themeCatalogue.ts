import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { ThemeCatalogue } from '../extensions/themeStylesheet.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Admin colour themes from the project (read at startup; docs/plans/themes.md). */
    themeCatalogue: ThemeCatalogue;
  }
}

/** The catalogue is built from the project config by the app (extensions/themeStylesheet.ts). */
export const themeCataloguePlugin = fp<{ catalogue: ThemeCatalogue }>(
  async (app: FastifyInstance, { catalogue }) => {
    app.decorate('themeCatalogue', catalogue);
  },
  { name: 'shapio-theme-catalogue' },
);
