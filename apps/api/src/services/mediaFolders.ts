import { db } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import { isUniqueViolation } from '../helpers/pgErrors.js';
import * as mediaAssetsRepository from '../repositories/mediaAssets.js';
import * as mediaFoldersRepository from '../repositories/mediaFolders.js';
import type { MediaFolderRow } from '../repositories/mediaFolders.js';
import type { SiteActorContext, SiteRef } from './actorContext.js';
import { recordAudit } from './audit.js';

export type MediaFolderView = {
  id: string;
  parentId: string | null;
  name: string;
  assetCount: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

const toView = (row: MediaFolderRow, assetCount: number): MediaFolderView => ({
  id: row.id,
  parentId: row.parent_id,
  name: row.name,
  assetCount,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const notFound = () => new AppError(404, 'NOT_FOUND', 'Folder not found');

const nameTaken = (error: unknown) =>
  new AppError(409, 'FOLDER_NAME_TAKEN', 'A folder with this name already exists here', undefined, {
    cause: error,
  });

const SIBLING_NAME_CONSTRAINT = 'media_folders_sibling_name_uq';

/** The parent must be a folder of the same site; another site's folder reads as missing. */
const assertParentExists = async (site: SiteRef, parentId: string | null | undefined) => {
  if (parentId && !(await mediaFoldersRepository.findById(site.id, parentId))) {
    throw new AppError(400, 'FOLDER_NOT_FOUND', 'The parent folder does not exist');
  }
};

/** The site's whole folder tree as a flat list (clients build the tree from `parentId`). */
export const listFolders = async (site: SiteRef): Promise<MediaFolderView[]> =>
  (await mediaFoldersRepository.listWithCounts(site.id)).map((row) =>
    toView(row, Number(row.asset_count ?? 0)),
  );

export const createFolder = async (
  site: SiteRef,
  createdBy: string | null,
  input: { name: string; parentId?: string | null },
): Promise<MediaFolderView> => {
  await assertParentExists(site, input.parentId);
  try {
    const row = await mediaFoldersRepository.insert({
      site_id: site.id,
      name: input.name.trim(),
      parent_id: input.parentId ?? null,
      created_by: createdBy,
    });
    return toView(row, 0);
  } catch (error) {
    throw isUniqueViolation(error, SIBLING_NAME_CONSTRAINT) ? nameTaken(error) : error;
  }
};

/** Rename and/or move a folder. Moving a folder under itself or a descendant is rejected. */
export const updateFolder = async (
  site: SiteRef,
  id: string,
  input: { expectedVersion: number; name?: string; parentId?: string | null },
): Promise<MediaFolderView> => {
  await assertParentExists(site, input.parentId);
  try {
    return await db.transaction().execute(async (trx) => {
      if (
        input.parentId &&
        (await mediaFoldersRepository.listAncestorIds(input.parentId, trx)).includes(id)
      ) {
        throw new AppError(
          400,
          'FOLDER_CYCLE',
          'A folder cannot be moved into itself or one of its subfolders',
        );
      }
      const row = await mediaFoldersRepository.updateIfVersion(
        site.id,
        id,
        input.expectedVersion,
        {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.parentId !== undefined ? { parent_id: input.parentId } : {}),
        },
        trx,
      );
      if (!row) {
        if (!(await mediaFoldersRepository.findById(site.id, id, trx))) {
          throw notFound();
        }
        throw new AppError(409, 'VERSION_CONFLICT', 'The folder changed since you loaded it', {
          expectedVersion: input.expectedVersion,
        });
      }
      return toView(row, await mediaAssetsRepository.countLiveInFolder(id, trx));
    });
  } catch (error) {
    throw isUniqueViolation(error, SIBLING_NAME_CONSTRAINT) ? nameTaken(error) : error;
  }
};

/** Only empty folders (no subfolders, no live assets) can be deleted. */
export const deleteFolder = async (context: SiteActorContext, id: string): Promise<void> => {
  await db.transaction().execute(async (trx) => {
    const folder = await mediaFoldersRepository.findById(context.site.id, id, trx);
    if (!folder) {
      throw notFound();
    }
    const assetCount = await mediaAssetsRepository.countLiveInFolder(id, trx);
    if (assetCount > 0 || (await mediaFoldersRepository.hasChildren(id, trx))) {
      throw new AppError(409, 'FOLDER_NOT_EMPTY', 'Move or delete what is in this folder first', {
        assetCount,
      });
    }
    await mediaFoldersRepository.deleteById(context.site.id, id, trx);
    await recordAudit(trx, {
      ...context,
      action: 'media.folder.delete',
      target: { type: 'media_folder', id },
      metadata: { name: folder.name, parentId: folder.parent_id },
    });
  });
};
