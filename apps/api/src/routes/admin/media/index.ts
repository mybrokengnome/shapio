import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  confirmUpload,
  createFolder,
  createReplaceUpload,
  createUpload,
  deleteAsset,
  deleteFolder,
  getAsset,
  getAssetUsage,
  listAssets,
  listFolders,
  moveAssets,
  updateAsset,
  updateFolder,
} from '../../../controllers/media.js';
import * as schemas from './schemas.js';

const NOT_AUDITED =
  'media library organisation (folders, metadata, moves) is recorded by media.* outbox events, not audited';
const GRANT_ONLY =
  'issues an upload grant only; the change is audited on confirm (media.upload / media.replace)';

/** /api/admin/media: the media library (folders, assets, uploads, usage). */
export const adminMediaRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const reader = { preHandler: app.requireGlobalPermission('media.read') };
  const writer = { preHandler: app.requireGlobalPermission('media.write') };
  const manager = { preHandler: app.requireGlobalPermission('media.manage') };

  // GET /folders: the whole tree, flat
  app.get('/folders', { ...reader, schema: schemas.listFoldersSchema }, listFolders);
  // POST /folders
  app.post(
    '/folders',
    { ...writer, schema: schemas.createFolderSchema, config: { audit: { exempt: NOT_AUDITED } } },
    createFolder,
  );
  // PATCH /folders/:id: rename or move (expectedVersion)
  app.patch(
    '/folders/:id',
    { ...writer, schema: schemas.updateFolderSchema, config: { audit: { exempt: NOT_AUDITED } } },
    updateFolder,
  );
  // DELETE /folders/:id: only when empty
  app.delete(
    '/folders/:id',
    { ...manager, schema: schemas.deleteFolderSchema, config: { audit: { action: 'media.folder.delete' } } },
    deleteFolder,
  );

  // GET /assets?folder=&mimeType=&search=&cursor=&limit=
  app.get('/assets', { ...reader, schema: schemas.listAssetsSchema }, listAssets);
  // POST /assets/move: bulk move into a folder (null = root)
  app.post(
    '/assets/move',
    { ...writer, schema: schemas.moveAssetsSchema, config: { audit: { exempt: NOT_AUDITED } } },
    moveAssets,
  );
  // GET /assets/:id
  app.get('/assets/:id', { ...reader, schema: schemas.getAssetSchema }, getAsset);
  // GET /assets/:id/usage: "used in"
  app.get('/assets/:id/usage', { ...reader, schema: schemas.assetUsageSchema }, getAssetUsage);
  // PATCH /assets/:id: alt, caption, focal point, file name, folder, visibility (expectedVersion).
  // Only visibility changes are audited (and need media.manage); the rest is not audited.
  app.patch(
    '/assets/:id',
    {
      ...writer,
      schema: schemas.updateAssetSchema,
      config: { audit: { action: 'media.visibility.change' } },
    },
    updateAsset,
  );
  // DELETE /assets/:id[?force=true]: 409 MEDIA_IN_USE when content references it; owners may force
  app.delete(
    '/assets/:id',
    { ...manager, schema: schemas.deleteAssetSchema, config: { audit: { action: 'media.delete' } } },
    deleteAsset,
  );
  // POST /assets/:id/replace: an upload grant that replaces the file, keeping the asset ID
  app.post(
    '/assets/:id/replace',
    { ...writer, schema: schemas.createReplaceUploadSchema, config: { audit: { exempt: GRANT_ONLY } } },
    createReplaceUpload,
  );

  // POST /uploads: step 1, an upload grant with instructions (presigned POST to S3, or Shapio's form route)
  app.post(
    '/uploads',
    { ...writer, schema: schemas.createUploadSchema, config: { audit: { exempt: GRANT_ONLY } } },
    createUpload,
  );
  // POST /uploads/:id/confirm: step 3, verify the stored bytes and record the asset
  app.post(
    '/uploads/:id/confirm',
    { ...writer, schema: schemas.confirmUploadSchema, config: { audit: { action: 'media.upload' } } },
    confirmUpload,
  );
};
