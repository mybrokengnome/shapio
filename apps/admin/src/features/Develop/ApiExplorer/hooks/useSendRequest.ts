import { useMutation } from '@tanstack/react-query';
import { apiBaseUrl } from '@/api/client';

export type ExplorerResponse = {
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  durationMs: number;
  /** The parsed JSON body, or the text when it is not JSON. */
  body: unknown;
  text: string;
};

/** An absolute URL on this Shapio instance for a path like `/api/content/articles?locale=en`. */
export const absoluteApiUrl = (path: string) => new URL(path.replace(/^\//, ''), apiBaseUrl()).href;

const parseBody = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

type SendVariables = { operationId: string; path: string; token: string };

/**
 * Sends a delivery request the way a site would: no admin cookie (`credentials: 'omit'`), the pasted token
 * as a bearer token when there is one (anonymous otherwise), nothing cached.
 */
export const useSendRequest = () =>
  useMutation({
    mutationKey: ['develop', 'explorer', 'send'],
    mutationFn: async ({ path, token }: SendVariables): Promise<ExplorerResponse> => {
      const url = absoluteApiUrl(path);
      const started = performance.now();
      const response = await fetch(url, {
        headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        credentials: 'omit',
        cache: 'no-store',
      });
      const text = await response.text();
      return {
        url,
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        durationMs: Math.round(performance.now() - started),
        body: parseBody(text),
        text,
      };
    },
  });
