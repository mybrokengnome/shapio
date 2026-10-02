/**
 * The ONLY place Shapio builds absolute URLs (media, preview, OAuth callbacks, emails, OpenAPI servers,
 * redirects). Everything derives from PUBLIC_URL (the origin) and BASE_PATH (the sub-path), so Shapio
 * works on any domain, port or sub-path without a reverse proxy rewriting links. ESLint forbids
 * building `http(s)://` strings anywhere else in apps/api/src.
 */
export type UrlBuilder = {
  /** Origin without a trailing slash, e.g. `https://cms.example.com`. */
  readonly publicUrl: string;
  /** `''` at the root, otherwise `/cms`. */
  readonly basePath: string;
  /** App-relative path → path on this server: `/api/ready` → `/cms/api/ready`. For routes and Location headers. */
  withBasePath: (path: string) => string;
  /** App-relative path → absolute URL: `/api/ready` → `https://cms.example.com/cms/api/ready`. */
  absoluteUrl: (path: string) => string;
  /** A request's raw URL (already including BASE_PATH) → absolute URL on the public origin. For redirects. */
  originUrl: (rawUrl: string) => string;
};

export class InvalidUrlPathError extends Error {
  constructor(path: string) {
    super(`Expected an app-relative path starting with a single "/", got ${JSON.stringify(path)}`);
    this.name = 'InvalidUrlPathError';
  }
}

const assertRelativePath = (path: string): void => {
  // `//host` would be protocol-relative: an open redirect waiting to happen.
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new InvalidUrlPathError(path);
  }
};

export const createUrlBuilder = ({
  publicUrl,
  basePath,
}: {
  publicUrl: string;
  basePath: string;
}): UrlBuilder => {
  const origin = publicUrl.replace(/\/+$/, '');
  const withBasePath = (path: string) => {
    assertRelativePath(path);
    return `${basePath}${path}`;
  };
  return {
    publicUrl: origin,
    basePath,
    withBasePath,
    absoluteUrl: (path) => `${origin}${withBasePath(path)}`,
    originUrl: (rawUrl) => {
      const safe = rawUrl.startsWith('/') ? rawUrl.replace(/^\/+/, '/') : '/';
      return `${origin}${safe}`;
    },
  };
};

type LoopbackTarget = { port: number; basePath: string; https: boolean };

/**
 * URL of this server on the loopback interface (for health probes from inside the host or container),
 * which deliberately bypasses PUBLIC_URL.
 */
export const loopbackUrl = ({ port, basePath, https }: LoopbackTarget, path: string): string => {
  assertRelativePath(path);
  return `${https ? 'https' : 'http'}://127.0.0.1:${port}${basePath}${path}`;
};
