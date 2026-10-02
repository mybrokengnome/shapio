import type { RequestFn } from '../request.js';
import type {
  CreateMediaFolderInput,
  CreateUploadInput,
  MediaAsset,
  MediaAssetPage,
  MediaAssetQuery,
  MediaFolder,
  MediaUsagePage,
  MoveMediaAssetsInput,
  MoveMediaAssetsResult,
  ReplaceUploadInput,
  UpdateMediaAssetInput,
  UpdateMediaFolderInput,
  UploadGrant,
} from './mediaTypes.js';
import { ADMIN_PATHS, withId } from './paths.js';
import { toQueryString } from './query.js';

/** The media library: folders, assets, and the two-step upload (grant, then confirm). */
export const createMediaApi = (request: RequestFn) => ({
  media: {
    folders: {
      /** The whole tree, flat: build it from `parentId`. */
      list: async () => (await request<{ items: MediaFolder[] }>(ADMIN_PATHS.mediaFolders)).items,
      create: (body: CreateMediaFolderInput) =>
        request<MediaFolder>(ADMIN_PATHS.mediaFolders, { method: 'POST', body }),
      /** Rename and/or move; 409 VERSION_CONFLICT when `expectedVersion` is stale. */
      update: (id: string, body: UpdateMediaFolderInput) =>
        request<MediaFolder>(withId(ADMIN_PATHS.mediaFolders, id), { method: 'PATCH', body }),
      /** Only empty folders: 409 FOLDER_NOT_EMPTY otherwise. */
      remove: (id: string) => request<void>(withId(ADMIN_PATHS.mediaFolders, id), { method: 'DELETE' }),
    },
    assets: {
      list: (query: MediaAssetQuery = {}) =>
        request<MediaAssetPage>(`${ADMIN_PATHS.mediaAssets}${toQueryString(query)}`),
      get: (id: string) => request<MediaAsset>(withId(ADMIN_PATHS.mediaAssets, id)),
      update: (id: string, body: UpdateMediaAssetInput) =>
        request<MediaAsset>(withId(ADMIN_PATHS.mediaAssets, id), { method: 'PATCH', body }),
      /** 409 MEDIA_IN_USE when content references the asset; owners may pass `force`. */
      remove: (id: string, { force = false }: { force?: boolean } = {}) =>
        request<void>(
          `${withId(ADMIN_PATHS.mediaAssets, id)}${toQueryString({ force: force || undefined })}`,
          {
            method: 'DELETE',
          },
        ),
      move: (body: MoveMediaAssetsInput) =>
        request<MoveMediaAssetsResult>(`${ADMIN_PATHS.mediaAssets}/move`, { method: 'POST', body }),
      /** "Used in": the entries that reference the asset. */
      usage: (id: string) => request<MediaUsagePage>(`${withId(ADMIN_PATHS.mediaAssets, id)}/usage`),
      /** An upload grant that replaces the asset's file and keeps its ID; confirm it like any upload. */
      replace: (id: string, body: ReplaceUploadInput) =>
        request<UploadGrant>(`${withId(ADMIN_PATHS.mediaAssets, id)}/replace`, { method: 'POST', body }),
    },
    uploads: {
      create: (body: CreateUploadInput) =>
        request<UploadGrant>(ADMIN_PATHS.mediaUploads, { method: 'POST', body }),
      /** Step 3: the server checks the stored bytes and records the asset (201 new, 200 replaced). */
      confirm: (grantId: string) =>
        request<MediaAsset>(`${withId(ADMIN_PATHS.mediaUploads, grantId)}/confirm`, { method: 'POST' }),
    },
  },
});

/** The form for step 2 of an upload: the grant's fields in order, then the file. */
export const buildUploadForm = (grant: UploadGrant, file: Blob, filename: string): FormData => {
  const form = new FormData();
  for (const [name, value] of Object.entries(grant.upload.fields)) {
    form.append(name, value);
  }
  form.append(grant.upload.fileField, file, filename);
  return form;
};
