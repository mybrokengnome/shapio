import { createAdminApi } from './admin/index.js';
import { createAppAuthApi } from './appAuth/index.js';
import { createDeliveryClient } from './deliveryClient.js';
import type { NextCacheOptions } from './nextCache.js';
import { createRequest, type FetchCredentials } from './request.js';
import { resolveWorkspaceOption } from './site.js';
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
   * The workspace key (instances with several workspaces). Delivery reads send it as `?site=`, every other
   * request as the `Shapio-Site` header (the spellings every server version reads). Leave it out to use the
   * token's workspace, else the primary workspace. A workspace token only ever reads its own workspace:
   * naming another one is refused (403 `SITE_MISMATCH`).
   */
  workspace?: string;
  /** The older name of `workspace`. Both set to different keys throws. */
  site?: string;
  /**
   * Next.js data-cache options for delivery reads (`delivery.*`, `site.get`), e.g. `{ cache: 'force-cache' }`.
   * Under Next the reads are tagged for `revalidateTag` whether or not this is set; the cache mode is only
   * passed when asked for, and reads pinned to a snapshot are always `force-cache`. Set it outside Next to send
   * the same fetch options; `false` sends none. A read's own `next` option overrides this one.
   */
  next?: NextCacheOptions | false;
  /**
   * Drafts mode, for a website's development server: every delivery read asks for drafts
   * (`publicationState=draft`) instead of published content, and under Next is never cached or tagged. Needs
   * a delivery token whose role grants Read drafts (the server refuses others with 403 `DRAFTS_FORBIDDEN`);
   * never set it on a production build. Reads pinned to a `snapshot` are refused. `snapshots` is unaffected.
   */
  drafts?: boolean;
  /**
   * The schema version this client was built against: the `SCHEMA_VERSION` token `shapio types generate`
   * writes next to the types (`<schemaId>:<version>`). Every read then answers in that version's shape (its
   * route keys, API IDs, and field types) after the schema moves on; fields removed since read `null` (`[]`
   * for lists). Delivery reads send it as `?schemaVersion=`, every other request as the
   * `Shapio-Schema-Version` header. Leave it out to read today's schema.
   *
   * Needs server 0.9.0 or later: an older server refuses the query parameter with 400 (an unknown query
   * parameter), on purpose, so a client never silently gets a shape it was not built for. The server may
   * answer 400 `SCHEMA_VERSION_INVALID`, `SCHEMA_VERSION_FOREIGN` (a token from another instance),
   * `SCHEMA_VERSION_AHEAD`, or `LENS_QUERY_UNSUPPORTED` (a filter or sort on a field whose storage changed);
   * 409 `SCHEMA_VERSION_UNAVAILABLE` or `LENS_UNCOVERED`; 422 `LENS_WRITE_UNSUPPORTED` on a write. GraphQL
   * mutations are refused (400) while a schema version is named.
   */
  schemaVersion?: string;
};

export const createClient = ({
  baseUrl,
  token,
  fetch = globalThis.fetch,
  credentials,
  headers,
  workspace,
  site: siteOption,
  next,
  drafts,
  schemaVersion,
}: ShapioClientOptions) => {
  const site = resolveWorkspaceOption({ workspace, site: siteOption }, 'createClient');
  const request = createRequest({ baseUrl, token, fetch, credentials, headers, site, schemaVersion });
  // The transport names the schema version on every request (query on delivery reads, header elsewhere).
  const reads = createDeliveryClient(request, { site, next, ...(drafts !== undefined ? { drafts } : {}) });

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
    delivery: reads.delivery,
    /** The workspace as delivery sees it: key, name and SEO defaults (`GET /api/site`). */
    workspace: reads.workspace,
    /** The older name of `workspace`. */
    site: reads.site,
    admin: createAdminApi(request),
    /** Publication snapshots and the diff between two (incremental builds). */
    snapshots: reads.snapshots,
    /** End users of your websites and apps: sign-up, sign-in, tokens, OAuth. */
    appAuth: createAppAuthApi(request, baseUrl),
  };
};

export type ShapioClient = ReturnType<typeof createClient>;
