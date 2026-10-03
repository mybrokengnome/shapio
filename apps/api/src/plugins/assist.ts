import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { createAssistRuntime, type AssistRuntime } from '../assist/runtime.js';
import type { AssistConfig } from '../config/assist.js';
import type { HostResolver } from '../publishing/outbound/ssrf.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The model provider for editor assists; undefined when assist is off (AI_PROVIDER unset). */
    assist: AssistRuntime | undefined;
  }
}

type AssistPluginOptions = { config: AssistConfig; resolve: HostResolver };

/** Decorates `app.assist` (plan agentic-ecosystem §A0). Nothing is contacted at startup. */
export const assistPlugin = fp<AssistPluginOptions>(
  async (app: FastifyInstance, options) => {
    app.decorate('assist', createAssistRuntime(options.config, options.resolve));
  },
  { name: 'shapio-assist' },
);
