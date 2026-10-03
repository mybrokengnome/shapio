import { MEDIA_EVENTS, MEDIA_JOB_MAX_ATTEMPTS, MEDIA_RELOCATE_JOB } from '../constants/media.js';
import { db } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import { writeOutboxEvent } from '../jobs/outbox.js';
import { enqueueJob } from '../jobs/queue.js';
import type { MediaVisibility } from '../media/keys.js';
import { enqueuePurge } from '../media/purge.js';
import type { StorageDriver } from '../media/types.js';
import * as mediaAssetsRepository from '../repositories/mediaAssets.js';
import type { MediaAssetCursor, MediaAssetFilter, MediaAssetPatch } from '../repositories/mediaAssets.js';
import * as mediaFoldersRepository from '../repositories/mediaFolders.js';
import * as mediaReferencesRepository from '../repositories/mediaReferences.js';
import * as mediaVariantsRepository from '../repositories/mediaVariants.js';
import type { SiteRef } from './actorContext.js';
import { getOwnerRoleId, isOwnerActor } from './adminUsers.js';
import { recordAudit } from './audit.js';
import type { MediaServiceContext } from './mediaContext.js';
import { toAssetViewOne, toAssetViews, type MediaAssetView } from './mediaViews.js';

const DEFAULT_PAGE_SIZE = 50;

const notFound = () => new AppError(404, 'NOT_FOUND', 'Media asset not found');

/** A folder an asset goes into must be on the asset's site; another site's folder reads as missing. */
const assertFolderOnSite = async (site: SiteRef, folderId: string | null | undefined) => {
  if (folderId && !(await mediaFoldersRepository.findById(site.id, folderId))) {
    throw new AppError(400, 'FOLDER_NOT_FOUND', 'The folder does not exist');
  }
};

const encodeCursor = (cursor: MediaAssetCursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');

const decodeCursor = (value: string): MediaAssetCursor => {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<MediaAssetCursor>;
    if (
      typeof parsed.createdAt === 'string' &&
      typeof parsed.id === 'string' &&
      !Number.isNaN(Date.parse(parsed.createdAt))
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // Reported below.
  }
  throw new AppError(400, 'INVALID_CURSOR', 'The cursor is not valid');
};

export type ListAssetsInput = MediaAssetFilter & { cursor?: string; limit?: number };

/** The site's assets, newest first, keyset-paginated. */
export const listAssets = async (
  context: MediaServiceContext,
  input: ListAssetsInput,
): Promise<{ items: MediaAssetView[]; nextCursor: string | null }> => {
  const limit = input.limit ?? DEFAULT_PAGE_SIZE;
  const rows = await mediaAssetsRepository.list(
    context.site.id,
    {
      ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
      ...(input.mimeType !== undefined ? { mimeType: input.mimeType.toLowerCase() } : {}),
      ...(input.search !== undefined ? { search: input.search } : {}),
    },
    input.cursor ? decodeCursor(input.cursor) : undefined,
    limit + 1,
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: await toAssetViews(context, page),
    nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.cursor_at, id: last.id }) : null,
  };
};

export const getAsset = async (context: MediaServiceContext, id: string): Promise<MediaAssetView> => {
  const asset = await mediaAssetsRepository.findLiveOnSite(context.site.id, id);
  if (!asset) {
    throw notFound();
  }
  return toAssetViewOne(context, asset);
};

export type UpdateAssetInput = {
  expectedVersion: number;
  alt?: string;
  caption?: string;
  filename?: string;
  focalPoint?: { x: number; y: number } | null;
  folderId?: string | null;
  visibility?: MediaVisibility;
};

const toPatch = (input: UpdateAssetInput): MediaAssetPatch => ({
  ...(input.alt !== undefined ? { alt: input.alt } : {}),
  ...(input.caption !== undefined ? { caption: input.caption } : {}),
  ...(input.filename !== undefined ? { original_filename: input.filename } : {}),
  ...(input.focalPoint !== undefined
    ? { focal_x: input.focalPoint?.x ?? null, focal_y: input.focalPoint?.y ?? null }
    : {}),
  ...(input.folderId !== undefined ? { folder_id: input.folderId } : {}),
  ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
});

/**
 * Metadata edits with optimistic concurrency. A visibility change needs `media.manage`, is audited and
 * takes effect at once on Shapio's routes; a job then moves the objects under the new prefix (so a CDN
 * exposing only `public/` stops serving a newly private asset).
 */
export const updateAsset = async (
  context: MediaServiceContext,
  id: string,
  input: UpdateAssetInput,
): Promise<MediaAssetView> => {
  const current = await mediaAssetsRepository.findLiveOnSite(context.site.id, id);
  if (!current) {
    throw notFound();
  }
  const visibilityChanged = input.visibility !== undefined && input.visibility !== current.visibility;
  if (visibilityChanged && !(await context.permissions.canPerform(context.actor, 'media.manage'))) {
    throw new AppError(403, 'FORBIDDEN', 'Your role does not allow media.manage (changing visibility)');
  }
  await assertFolderOnSite(context.site, input.folderId);
  const updated = await db.transaction().execute(async (trx) => {
    const row = await mediaAssetsRepository.updateIfVersion(
      context.site.id,
      id,
      input.expectedVersion,
      toPatch(input),
      trx,
    );
    if (!row) {
      throw new AppError(409, 'VERSION_CONFLICT', 'The asset changed since you loaded it', {
        expectedVersion: input.expectedVersion,
      });
    }
    if (visibilityChanged) {
      await recordAudit(trx, {
        ...context,
        action: 'media.visibility.change',
        target: { type: 'media_asset', id },
        metadata: { from: current.visibility, to: row.visibility, filename: row.original_filename },
      });
      await enqueueJob(
        {
          type: MEDIA_RELOCATE_JOB,
          payload: { assetId: id },
          idempotencyKey: `${MEDIA_RELOCATE_JOB}:${id}:${row.version}`,
          maxAttempts: MEDIA_JOB_MAX_ATTEMPTS,
        },
        trx,
      );
    }
    await writeOutboxEvent(trx, {
      type: MEDIA_EVENTS.updated,
      siteId: context.site.id,
      aggregateType: 'media_asset',
      aggregateId: id,
      payload: { assetId: id, fields: Object.keys(input).filter((key) => key !== 'expectedVersion') },
    });
    return row;
  });
  return toAssetViewOne(context, updated);
};

/**
 * Deletes an asset unless content uses it (409 MEDIA_IN_USE with the usage count). Owners may `force` it,
 * which drops the references; content then holds a dangling ID. The row is kept (soft delete) for history;
 * its objects are purged by a job.
 */
export const deleteAsset = async (
  context: MediaServiceContext,
  id: string,
  force: boolean,
): Promise<void> => {
  await db.transaction().execute(async (trx) => {
    const asset = await mediaAssetsRepository.lockOnSite(context.site.id, id, trx);
    if (!asset || asset.deleted_at !== null) {
      throw notFound();
    }
    const usageCount = await mediaReferencesRepository.countForAsset(id, trx);
    if (usageCount > 0 && !force) {
      throw new AppError(409, 'MEDIA_IN_USE', 'This asset is used by content; remove it there first', {
        usageCount,
      });
    }
    if (usageCount > 0 && !isOwnerActor(context.actor, await getOwnerRoleId(trx))) {
      throw new AppError(403, 'FORBIDDEN', 'Only owners can delete media that content still uses');
    }
    await mediaReferencesRepository.deleteForAsset(id, trx);
    const variantKeys = await mediaVariantsRepository.deleteForAsset(id, trx);
    await mediaAssetsRepository.update(id, { deleted_at: new Date() }, trx);
    const driver = asset.storage_driver as StorageDriver;
    await enqueuePurge(
      trx,
      [asset.storage_key, ...variantKeys].map((key) => ({ driver, key })),
    );
    await recordAudit(trx, {
      ...context,
      action: 'media.delete',
      target: { type: 'media_asset', id },
      metadata: {
        filename: asset.original_filename,
        checksumSha256: asset.checksum_sha256,
        force,
        usageCount,
      },
    });
    await writeOutboxEvent(trx, {
      type: MEDIA_EVENTS.deleted,
      siteId: context.site.id,
      aggregateType: 'media_asset',
      aggregateId: id,
      payload: { assetId: id },
    });
  });
};

/**
 * Moves the site's assets into one of its folders (null = root). Unknown, deleted or other sites' IDs are
 * skipped and reported.
 */
export const moveAssets = async (
  site: SiteRef,
  assetIds: readonly string[],
  folderId: string | null,
): Promise<{ moved: string[]; skipped: string[] }> => {
  await assertFolderOnSite(site, folderId);
  const unique = [...new Set(assetIds)];
  const moved = await mediaAssetsRepository.moveToFolder(site.id, unique, folderId);
  const movedSet = new Set(moved);
  return { moved, skipped: unique.filter((id) => !movedSet.has(id)) };
};

export type MediaUsageView = {
  entryId: string;
  modelId: string;
  fieldId: string;
  locale: string;
  state: 'draft' | 'published';
  since: Date;
};

const MAX_USAGES = 500;

type MediaUsages = { items: MediaUsageView[]; total: number };

/** The entry heads that reference an asset already found (references are written per site by content). */
const loadUsages = async (id: string): Promise<MediaUsages> => {
  const [rows, total] = await Promise.all([
    mediaReferencesRepository.listForAsset(id, MAX_USAGES),
    mediaReferencesRepository.countForAsset(id),
  ]);
  return {
    items: rows.map((row) => ({
      entryId: row.entry_id,
      modelId: row.model_id,
      fieldId: row.field_id,
      locale: row.locale,
      state: row.state as MediaUsageView['state'],
      since: row.created_at,
    })),
    total,
  };
};

/** "Used in": the entry heads that reference one of the site's assets; another site's asset is not found. */
export const listUsagesOnSite = async (site: SiteRef, id: string): Promise<MediaUsages> => {
  if (!(await mediaAssetsRepository.findLiveOnSite(site.id, id))) {
    throw notFound();
  }
  return loadUsages(id);
};
