import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { createDefinitionRoutes } from '../models/definitionRoutes.js';
import { builtinComponentsRoutes } from './builtin.js';

/** /api/admin/components: reusable components (no entries of their own), and the built-in ones. */
export const componentsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  await app.register(createDefinitionRoutes('component'));
  await app.register(builtinComponentsRoutes, { prefix: '/builtin' });
};
