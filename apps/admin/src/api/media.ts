import type {
  CreateMediaFolderInput,
  MediaAsset,
  MediaAssetQuery,
  MoveMediaAssetsInput,
  UpdateMediaAssetInput,
  UpdateMediaFolderInput,
} from '@shapio/client';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

const silent = { silent: true } as const;

export const MEDIA_PAGE_SIZE = 48;
/** How often an asset whose variants are still being made is re-read. */
const PROCESSING_POLL_MS = 2000;

const isProcessing = (asset: MediaAsset) =>
  asset.status === 'processing' || asset.variants.some((variant) => variant.status === 'pending');

export const useMediaFolders = () =>
  useQuery({ queryKey: queryKeys.media.folders, queryFn: () => adminApi.media.folders.list() });

/** Newest first, a page at a time; refreshed while anything shown is still processing. */
export const useMediaAssets = (query: Omit<MediaAssetQuery, 'cursor' | 'limit'>) =>
  useInfiniteQuery({
    queryKey: queryKeys.media.assets(query),
    queryFn: ({ pageParam }) =>
      adminApi.media.assets.list({
        ...query,
        limit: MEDIA_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: (state) =>
      state.state.data?.pages.some((page) => page.items.some(isProcessing)) ? PROCESSING_POLL_MS : false,
  });

export const useMediaAsset = (id: string | undefined) =>
  useQuery({
    queryKey: queryKeys.media.asset(id ?? ''),
    queryFn: () => adminApi.media.assets.get(id ?? ''),
    enabled: id !== undefined,
    refetchInterval: (state) =>
      state.state.data && isProcessing(state.state.data) ? PROCESSING_POLL_MS : false,
  });

export const useMediaUsage = (id: string | undefined) =>
  useQuery({
    queryKey: queryKeys.media.usage(id ?? ''),
    queryFn: () => adminApi.media.assets.usage(id ?? ''),
    enabled: id !== undefined,
    meta: silent,
  });

const useInvalidateMedia = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
};

export const useUpdateMediaAsset = () => {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateMedia();
  return useMutation({
    mutationKey: ['media', 'assets', 'update'],
    meta: silent,
    mutationFn: ({ id, input }: { id: string; input: UpdateMediaAssetInput }) =>
      withCsrf(() => adminApi.media.assets.update(id, input)),
    onSuccess: (asset) => {
      queryClient.setQueryData(queryKeys.media.asset(asset.id), asset);
      return invalidate();
    },
  });
};

/** 409 MEDIA_IN_USE comes back to the caller (the delete dialog explains it), so no toast here. */
export const useDeleteMediaAsset = () => {
  const invalidate = useInvalidateMedia();
  return useMutation({
    mutationKey: ['media', 'assets', 'delete'],
    meta: silent,
    mutationFn: ({ id, force }: { id: string; force: boolean }) =>
      withCsrf(() => adminApi.media.assets.remove(id, { force })),
    onSuccess: invalidate,
  });
};

export const useMoveMediaAssets = () => {
  const invalidate = useInvalidateMedia();
  return useMutation({
    mutationKey: ['media', 'assets', 'move'],
    mutationFn: (input: MoveMediaAssetsInput) => withCsrf(() => adminApi.media.assets.move(input)),
    onSettled: invalidate,
  });
};

export const useCreateMediaFolder = () => {
  const invalidate = useInvalidateMedia();
  return useMutation({
    mutationKey: ['media', 'folders', 'create'],
    meta: silent,
    mutationFn: (input: CreateMediaFolderInput) => withCsrf(() => adminApi.media.folders.create(input)),
    onSuccess: invalidate,
  });
};

export const useUpdateMediaFolder = () => {
  const invalidate = useInvalidateMedia();
  return useMutation({
    mutationKey: ['media', 'folders', 'update'],
    meta: silent,
    mutationFn: ({ id, input }: { id: string; input: UpdateMediaFolderInput }) =>
      withCsrf(() => adminApi.media.folders.update(id, input)),
    onSuccess: invalidate,
  });
};

export const useDeleteMediaFolder = () => {
  const invalidate = useInvalidateMedia();
  return useMutation({
    mutationKey: ['media', 'folders', 'delete'],
    mutationFn: (id: string) => withCsrf(() => adminApi.media.folders.remove(id)),
    onSettled: invalidate,
  });
};
