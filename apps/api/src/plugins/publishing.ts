import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { PublishingRuntime } from '../publishing/runtime.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Publishing services' shared dependencies (package H): secret encryption, outbound policy, clock. */
    publishing: PublishingRuntime;
  }
}

export const publishingPlugin = fp<{ runtime: PublishingRuntime }>(
  async (app: FastifyInstance, { runtime }) => {
    app.decorate('publishing', runtime);
  },
  { name: 'shapio-publishing' },
);
