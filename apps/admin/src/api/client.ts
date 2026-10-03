import { createClient } from '@shapio/client';
import { currentSite } from '@/app/currentSite';
import { useSessionStore } from '@/stores/session';

/**
 * The API lives beside the admin: `<base href>` is `{BASE_PATH}/admin/`, so `..` is `{BASE_PATH}/`.
 * Same origin, so the session cookie travels with `same-origin` credentials and no CORS is involved.
 */
export const apiBaseUrl = () => new URL('..', document.baseURI).href;

export const CSRF_HEADER = 'x-csrf-token';

/**
 * Every request names this page load's site (the `Shapio-Site` header; `?site=` on delivery reads). With no
 * site in the URL and none remembered, nothing is named and the API answers for the primary site, which is
 * then the page's site (see app/currentSite). The site never changes during a page load.
 */
export const apiClient = createClient({
  baseUrl: apiBaseUrl(),
  credentials: 'same-origin',
  site: currentSite().key,
  headers: (): Record<string, string> => {
    const token = useSessionStore.getState().csrfToken;
    return token ? { [CSRF_HEADER]: token } : {};
  },
});

export const adminApi = apiClient.admin;
