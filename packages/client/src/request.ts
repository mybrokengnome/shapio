import { ShapioApiError } from './errors.js';
import { applySite } from './site.js';

/** Fetch's `credentials` mode (spelled out: the DOM lib type is not available to Node consumers). */
export type FetchCredentials = 'omit' | 'same-origin' | 'include';

export type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal };

export type RequestFn = <T>(path: string, options?: RequestOptions) => Promise<T>;

export type RequestConfig = {
  baseUrl: string;
  token: string | undefined;
  fetch: typeof globalThis.fetch;
  credentials: FetchCredentials | undefined;
  headers: (() => Readonly<Record<string, string>>) | undefined;
  /** The site key every request names (see site.ts); undefined: the credential's site, else the primary. */
  site: string | undefined;
};

const parseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** Builds the JSON request function every endpoint group uses. Non-2xx responses throw ShapioApiError. */
export const createRequest = ({
  baseUrl,
  token,
  fetch,
  credentials,
  headers,
  site,
}: RequestConfig): RequestFn => {
  const origin = baseUrl.replace(/\/+$/, '');
  return async <T>(
    requestPath: string,
    { method = 'GET', body, signal }: RequestOptions = {},
  ): Promise<T> => {
    const { path, headers: siteHeaders } = applySite(site, method, requestPath);
    const requestHeaders: Record<string, string> = {
      accept: 'application/json',
      ...siteHeaders,
      ...headers?.(),
    };
    if (token) {
      requestHeaders.authorization = `Bearer ${token}`;
    }
    if (body !== undefined) {
      requestHeaders['content-type'] = 'application/json';
    }
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: requestHeaders,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
      ...(credentials ? { credentials } : {}),
    });
    const parsed = await parseBody(response);
    if (!response.ok) {
      throw new ShapioApiError(response.status, parsed);
    }
    return parsed as T;
  };
};
