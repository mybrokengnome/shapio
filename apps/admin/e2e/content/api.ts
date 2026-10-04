import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { createPng } from '../support/png';

/**
 * Admin API calls for the content suite's fixtures (models, locales, media), made with a page's request
 * context so they share its session cookie. The UI under test is never used to set up its own fixtures.
 */
export type AdminApi = ReturnType<typeof adminApiFor>;

export const adminApiFor = (request: APIRequestContext, base: string) => {
  const csrf = async () =>
    ((await (await request.get(`${base}/auth/csrf`)).json()) as { csrfToken: string }).csrfToken;
  const send = async <T>(method: 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown): Promise<T> => {
    const response = await request.fetch(`${base}${path}`, {
      method,
      headers: { 'x-csrf-token': await csrf() },
      ...(data === undefined ? {} : { data }),
    });
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true);
    return (response.status() === 204 ? undefined : await response.json()) as T;
  };
  const get = async <T>(path: string): Promise<T> => {
    const response = await request.get(`${base}${path}`);
    expect(response.ok(), `GET ${path}: ${await response.text()}`).toBe(true);
    return (await response.json()) as T;
  };
  return {
    get,
    send,
    /** The raw response, for asserting failures. */
    put: async (path: string, data: unknown) =>
      request.fetch(`${base}${path}`, { method: 'PUT', headers: { 'x-csrf-token': await csrf() }, data }),
    createLocale: (code: string, label: string) => send('POST', '/locales', { code, label }),
    /** Belongs to the request's site unless `scope` is `network` (shared with all sites). */
    createDefinition: (category: 'models' | 'components', definition: unknown, scope?: 'network') =>
      send<{ status: string }>('POST', `/${category}`, scope ? { definition, scope } : { definition }),
    /** Uploads a PNG through the same grant → upload → confirm flow as the admin. */
    uploadPng: async (filename: string, width: number, height: number) => {
      const bytes = createPng(width, height);
      const grant = await send<{ grantId: string; upload: { url: string; fields: Record<string, string> } }>(
        'POST',
        '/media/uploads',
        { filename, mimeType: 'image/png', sizeBytes: bytes.length },
      );
      const uploaded = await request.post(grant.upload.url, {
        headers: { 'x-csrf-token': await csrf() },
        multipart: { ...grant.upload.fields, file: { name: filename, mimeType: 'image/png', buffer: bytes } },
      });
      expect(uploaded.ok(), await uploaded.text()).toBe(true);
      return send<{ id: string }>('POST', `/media/uploads/${grant.grantId}/confirm`);
    },
  };
};

export const id = () => randomUUID();
