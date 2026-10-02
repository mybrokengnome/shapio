import { createClient } from '@shapio/client';
import { useSessionStore } from '@/stores/session';

/**
 * The API lives beside the admin: `<base href>` is `{BASE_PATH}/admin/`, so `..` is `{BASE_PATH}/`.
 * Same origin, so the session cookie travels with `same-origin` credentials and no CORS is involved.
 */
export const apiBaseUrl = () => new URL('..', document.baseURI).href;

export const CSRF_HEADER = 'x-csrf-token';

export const apiClient = createClient({
  baseUrl: apiBaseUrl(),
  credentials: 'same-origin',
  headers: (): Record<string, string> => {
    const token = useSessionStore.getState().csrfToken;
    return token ? { [CSRF_HEADER]: token } : {};
  },
});

export const adminApi = apiClient.admin;
