import { ShapioApiError } from '@shapio/client';
import { useSessionStore } from '@/stores/session';
import { adminApi } from './client';

/**
 * The API reports CSRF failures as 403 FORBIDDEN with a CSRF message (@fastify/csrf-protection errors pass
 * through the generic error mapping); a dedicated code is matched too, should the API add one.
 */
const isCsrfRejection = (error: unknown) =>
  error instanceof ShapioApiError &&
  error.status === 403 &&
  (/csrf/i.test(error.code) || /csrf/i.test(error.message));

export const setCsrfToken = (token: string) => useSessionStore.getState().setCsrfToken(token);

const refreshCsrfToken = async () => {
  const { csrfToken } = await adminApi.auth.csrf();
  setCsrfToken(csrfToken);
};

/**
 * Runs a cookie-authenticated mutation with the session's CSRF token (delivered by login, setup and `me`).
 * If the server still rejects it as missing or stale, a fresh token is fetched and the call retried once.
 */
export const withCsrf = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    if (!isCsrfRejection(error)) {
      throw error;
    }
    await refreshCsrfToken();
    return call();
  }
};

/** The CSRF secret belongs to the session: forget the token whenever the session changes. */
export const resetCsrfToken = () => useSessionStore.getState().setCsrfToken(undefined);
