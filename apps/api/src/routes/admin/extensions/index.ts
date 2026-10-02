import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { getEditorFile, listEditors } from '../../../controllers/editorManifest.js';
import * as schemas from './schemas.js';

/** /api/admin/extensions: what the project installed for the admin (custom field editors, ADR 0009). */
export const adminExtensionsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const admin = { preHandler: app.requireAdmin };

  // GET /editors: the editor manifest
  app.get('/editors', { ...admin, schema: schemas.listEditorsSchema }, listEditors);
  // GET /editors/:file: an editor module, imported by the admin at runtime
  app.get('/editors/:file', { ...admin, schema: schemas.getEditorFileSchema }, getEditorFile);
};
