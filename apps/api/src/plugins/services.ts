import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { AppConfig } from '../config/index.js';
import type { Database } from '../db/index.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import type { PermissionEvaluator } from '../permissions/types.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: Database;
    permissions: PermissionEvaluator;
    /** The only way to build absolute URLs (PUBLIC_URL + BASE_PATH). */
    urls: UrlBuilder;
  }
}

type ServicesPluginOptions = {
  config: AppConfig;
  db: Database;
  permissions: PermissionEvaluator;
  urls: UrlBuilder;
};

/** Exposes config, the database, the permission evaluator and the URL builder to plugins and routes. */
export const servicesPlugin = fp<ServicesPluginOptions>(
  async (app: FastifyInstance, { config, db, permissions, urls }) => {
    app.decorate('config', config);
    app.decorate('urls', urls);
    app.decorate('db', db);
    app.decorate('permissions', permissions);
  },
  { name: 'shapio-services' },
);
