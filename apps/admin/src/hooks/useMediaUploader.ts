import { buildUploadForm, type MediaAsset, type MediaVisibility, type UploadGrant } from '@shapio/client';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { adminApi, apiBaseUrl } from '@/api/client';
import { withCsrf } from '@/api/csrf';
import { queryKeys } from '@/api/queryKeys';
import { i18next } from '@/app/i18n';
import { logError } from '@/helpers/reportError';
import { resolveUploadUrl } from '@/helpers/resolveUploadUrl';
import { uploadWithProgress } from '@/helpers/uploadWithProgress';
import { useMediaUploadsStore, type UploadItem } from '@/stores/mediaUploads';

const FALLBACK_MIME_TYPE = 'application/octet-stream';

type UploadTarget = Pick<UploadItem, 'file' | 'folderId' | 'visibility' | 'replaceAssetId'>;

const requestGrant = (item: UploadTarget): Promise<UploadGrant> => {
  const details = {
    filename: item.file.name,
    mimeType: item.file.type || FALLBACK_MIME_TYPE,
    sizeBytes: item.file.size,
  };
  return withCsrf(() =>
    item.replaceAssetId
      ? adminApi.media.assets.replace(item.replaceAssetId, details)
      : adminApi.media.uploads.create({ ...details, folderId: item.folderId, visibility: item.visibility }),
  );
};

/** Grant, send (with progress), confirm: one file into the library. Throws when any step fails. */
const uploadFile = async (
  item: UploadTarget,
  onProgress: (progress: number) => void,
  onConfirming: () => void,
): Promise<MediaAsset> => {
  const grant = await requestGrant(item);
  await uploadWithProgress({
    url: resolveUploadUrl(grant, apiBaseUrl()),
    form: buildUploadForm(grant, item.file, item.file.name),
    onProgress,
  });
  onConfirming();
  return withCsrf(() => adminApi.media.uploads.confirm(grant.grantId));
};

/** What an editor gets back from `uploadOne`: the new asset's ID and its library alt text. */
export type UploadedMedia = { id: string; alt: string | null };

type EnqueueOptions = { folderId: string | null; visibility: MediaVisibility; replaceAssetId?: string };

/**
 * The upload flow, the same for local disk and S3: ask for a grant, send the form to the grant's URL
 * (with progress), then confirm so the server checks the bytes and records the asset. A failed upload stays
 * in the queue with its error; retrying starts again with a fresh grant (grants are single-use).
 */
export const useMediaUploader = () => {
  const queryClient = useQueryClient();
  const { add, update, remove } = useMediaUploadsStore.getState();

  const run = useCallback(
    async (item: UploadItem) => {
      update(item.id, { status: 'uploading', progress: 0, error: undefined });
      try {
        const asset = await uploadFile(
          item,
          (progress) => update(item.id, { progress }),
          () => update(item.id, { status: 'confirming' }),
        );
        update(item.id, { status: 'done', assetId: asset.id });
        if (item.replaceAssetId) {
          toast.success(i18next.t('media.upload.replaced', { name: item.file.name }));
        }
      } catch (error) {
        logError(error, `uploading ${item.file.name}`);
        update(item.id, { status: 'failed', error });
      } finally {
        await queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
      }
    },
    [queryClient, update],
  );

  const enqueue = useCallback(
    (files: readonly File[], options: EnqueueOptions) => {
      for (const file of files) {
        const item: UploadItem = {
          id: crypto.randomUUID(),
          file,
          folderId: options.folderId,
          visibility: options.visibility,
          replaceAssetId: options.replaceAssetId,
          status: 'uploading',
          progress: 0,
          error: undefined,
          assetId: undefined,
        };
        add(item);
        void run(item);
      }
    },
    [add, run],
  );

  const retry = useCallback(
    (id: string) => {
      const item = useMediaUploadsStore.getState().items.find((candidate) => candidate.id === id);
      if (item) {
        void run(item);
      }
    },
    [run],
  );

  /**
   * One file uploaded outside the queue (a file dropped into rich text): resolves with the new asset, or
   * rejects so the caller can undo its placeholder. Public, in the root folder.
   */
  const uploadOne = useCallback(
    async (file: File): Promise<UploadedMedia> => {
      try {
        const asset = await uploadFile(
          { file, folderId: null, visibility: 'public', replaceAssetId: undefined },
          () => undefined,
          () => undefined,
        );
        queryClient.setQueryData(queryKeys.media.asset(asset.id), asset);
        return { id: asset.id, alt: asset.alt || null };
      } finally {
        await queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
      }
    },
    [queryClient],
  );

  return { enqueue, retry, dismiss: remove, uploadOne };
};
