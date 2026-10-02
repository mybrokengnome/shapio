import type { UploadGrant } from '@shapio/client';

/**
 * Where to send a grant's bytes. Shapio's own upload route (local storage) is addressed through the API the
 * admin already talks to, which keeps it same-origin even when the admin runs on the Vite dev server or
 * PUBLIC_URL differs from the address in the browser. Bucket URLs (presigned POST) are used as given.
 */
export const resolveUploadUrl = (grant: UploadGrant, apiBaseUrl: string): string => {
  const ownRoute = `/api/media/uploads/${encodeURIComponent(grant.grantId)}`;
  const url = new URL(grant.upload.url);
  return url.pathname.endsWith(ownRoute) ? new URL(ownRoute.slice(1), apiBaseUrl).href : grant.upload.url;
};
