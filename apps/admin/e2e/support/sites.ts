import { expect, type APIRequestContext } from '@playwright/test';
import { ADMIN_API } from './session';

/**
 * Admin API calls on one site (the `Shapio-Site` header), with the session of the given request context.
 * Without a site key, the API answers for the primary site.
 */
export const siteApi = (request: APIRequestContext, siteKey?: string) => {
  const siteHeader: Record<string, string> = siteKey ? { 'shapio-site': siteKey } : {};
  const csrf = async () =>
    ((await (await request.get(`${ADMIN_API}/auth/csrf`)).json()) as { csrfToken: string }).csrfToken;
  const fetch = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, data?: unknown) =>
    request.fetch(`${ADMIN_API}${path}`, {
      method,
      headers: { ...siteHeader, ...(method === 'GET' ? {} : { 'x-csrf-token': await csrf() }) },
      ...(data === undefined ? {} : { data }),
    });
  const send = async <T>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    data?: unknown,
  ): Promise<T> => {
    const response = await fetch(method, path, data);
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true);
    return (response.status() === 204 ? undefined : await response.json()) as T;
  };
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetch('GET', path);
    expect(response.ok(), `GET ${path}: ${await response.text()}`).toBe(true);
    return (await response.json()) as T;
  };
  return { fetch, send, get };
};
