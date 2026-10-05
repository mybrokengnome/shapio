import { createAdminApi } from './admin/index.js';
import { createAppAuthApi } from './appAuth/index.js';
import { createDeliveryApi } from './delivery.js';
import { createRequest, type FetchCredentials } from './request.js';
import { createSiteApi } from './siteDelivery.js';
import { createSnapshotsApi } from './snapshots.js';
import type { HealthResponse, ReadyResponse, VersionResponse } from './types.js';

export type ShapioClientOptions = {
  /** Base URL of the Shapio server including any BASE_PATH, e.g. `https://cms.example.com/cms`. */
  baseUrl: string;
  /** API token sent as a bearer token. */
  token?: string;
  /** Defaults to the global fetch; injectable for tests and custom agents. */
  fetch?: typeof globalThis.fetch;
  /** Fetch credentials mode. The admin uses `same-origin` so its session cookie is sent. */
  credentials?: FetchCredentials;
  /** Extra headers computed per request (the admin's CSRF token). */
  headers?: () => Readonly<Record<string, string>>;
  /**
   * The site key (multi-site instances). Delivery reads send it as `?site=`, every other request as the
   * `Shapio-Site` header. Leave it out to use the token's site, else the primary site. A site token only
   * ever reads its own site: naming another one is refused (403 `SITE_MISMATCH`).
   */
  site?: string;
};

export const createClient = ({
  baseUrl,
  token,
  fetch = globalThis.fetch,
  credentials,
  headers,
  site,
}: ShapioClientOptions) => {
  const request = createRequest({ baseUrl, token, fetch, credentials, headers, site });

  return {
    /**
     * Any Shapio route, e.g. the delivery API. Delivery paths use the model's route key: a collection's
     * plural API ID (`request('/api/content/articles')`, `/api/content/articles/<id>`), a singleton's API ID
     * (`/api/content/homepage`). The admin API (`admin.*`) always uses the singular API ID.
     */
    request,
    system: {
      health: (signal?: AbortSignal) => request<HealthResponse>('/api/health', signal ? { signal } : {}),
      ready: (signal?: AbortSignal) => request<ReadyResponse>('/api/ready', signal ? { signal } : {}),
      version: (signal?: AbortSignal) => request<VersionResponse>('/api/version', signal ? { signal } : {}),
    },
    /** Published content (the delivery API), typed by the caller. */
    delivery: createDeliveryApi(request),
    /** The site as delivery sees it: key, name and SEO defaults (`GET /api/site`). */
    site: createSiteApi(request),
    admin: createAdminApi(request),
    /** Publication snapshots and the diff between two (incremental builds). */
    snapshots: createSnapshotsApi(request),
    /** End users of your sites and apps: sign-up, sign-in, tokens, OAuth. */
    appAuth: createAppAuthApi(request, baseUrl),
  };
};

export type ShapioClient = ReturnType<typeof createClient>;
