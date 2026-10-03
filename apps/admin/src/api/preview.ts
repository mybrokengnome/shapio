import type { OpenPreviewInput } from '@shapio/client';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

/** The site's connections with a preview URL: whether the entry document can show a preview, and where. */
export const usePreviewTargets = () =>
  useQuery({
    queryKey: queryKeys.publishing.deployments.previewTargets,
    queryFn: () => adminApi.preview.targets(),
    staleTime: 60_000,
    meta: { silent: true },
  });

/** A fresh one-hour preview token for an entry and the URL that opens it on the site. */
export const openPreview = (input: OpenPreviewInput) => withCsrf(() => adminApi.preview.open(input));

/** Revokes a preview token the pane no longer uses (replaced or closed). */
export const revokePreviewToken = (id: string) => withCsrf(() => adminApi.preview.tokens.revoke(id));
