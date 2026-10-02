import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { createContentHooks, type ContentHooks } from '../content/hooks.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Content lifecycle hook points (ADR 0009), with the project's hooks registered (extensions/hooks.ts). */
    contentHooks: ContentHooks;
  }
}

export const contentHooksPlugin = fp<{ hooks?: ContentHooks }>(
  async (app: FastifyInstance, { hooks }) => {
    app.decorate('contentHooks', hooks ?? createContentHooks());
  },
  { name: 'shapio-content-hooks' },
);
