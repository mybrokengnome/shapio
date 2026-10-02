import type { AppAuthConfig } from '../config/index.js';
import { APP_PRINCIPAL_CACHE_SIZE } from '../constants/appAuth.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import { deriveAppAuthKeys, type AppAuthKeys } from './keys.js';
import { createOAuthProviderRegistry, type OAuthProviderRegistry } from './oauth/index.js';
import type { OAuthEndpoints, OAuthProviderId } from './oauth/types.js';

/** Custom role IDs of a re-validated app user, or null when the account may no longer act. */
export type ResolvedAppUser = { roleIds: readonly string[] } | null;

/** A bounded map: the oldest entry goes first once it is full (insertion order = age). */
export type BoundedCache<V> = { get: (key: string) => V | undefined; set: (key: string, value: V) => void };

export const createBoundedCache = <V>(maxSize: number): BoundedCache<V> => {
  const entries = new Map<string, V>();
  return {
    get: (key) => entries.get(key),
    set: (key, value) => {
      entries.delete(key);
      entries.set(key, value);
      if (entries.size > maxSize) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) {
          entries.delete(oldest);
        }
      }
    },
  };
};

/** Everything the app-user services need besides the database. Built once per app; no HTTP objects. */
export type AppAuthRuntime = {
  config: AppAuthConfig;
  keys: AppAuthKeys;
  providers: OAuthProviderRegistry;
  urls: UrlBuilder;
  /** Where OAuth may send the browser back to (see `returnTargets`). */
  returnTargets: ReturnTargets;
  /** Re-validation results keyed by `${appUserId}:${permissionsVersion}`. */
  principals: BoundedCache<ResolvedAppUser>;
};

type AppAuthRuntimeOptions = {
  config: AppAuthConfig;
  urls: UrlBuilder;
  signingSecret: string;
  corsOrigins: readonly string[];
  /** Tests point providers at a local fake. */
  oauthEndpoints?: Partial<Record<OAuthProviderId, OAuthEndpoints>>;
};

/** Allowed OAuth return targets: exact web origins, and custom-scheme prefixes for native apps. */
export type ReturnTargets = { origins: ReadonlySet<string>; schemePrefixes: readonly string[] };

const isWebUrl = (value: string) => /^https?:/i.test(value);

/** APP_AUTH_RETURN_URLS when set; otherwise the origins in CORS_ORIGINS plus PUBLIC_URL's. */
const returnTargetsOf = (
  config: AppAuthConfig,
  corsOrigins: readonly string[],
  publicUrl: string,
): ReturnTargets => {
  if (!config.returnUrls) {
    return {
      origins: new Set([...corsOrigins.filter((origin) => origin !== '*'), publicUrl]),
      schemePrefixes: [],
    };
  }
  return {
    origins: new Set(config.returnUrls.filter(isWebUrl).map((entry) => new URL(entry).origin)),
    schemePrefixes: config.returnUrls.filter((entry) => !isWebUrl(entry)),
  };
};

export const createAppAuthRuntime = ({
  config,
  urls,
  signingSecret,
  corsOrigins,
  oauthEndpoints,
}: AppAuthRuntimeOptions): AppAuthRuntime => ({
  config,
  keys: deriveAppAuthKeys(signingSecret),
  providers: createOAuthProviderRegistry(config.oauth, oauthEndpoints),
  urls,
  returnTargets: returnTargetsOf(config, corsOrigins, urls.publicUrl),
  principals: createBoundedCache(APP_PRINCIPAL_CACHE_SIZE),
});
