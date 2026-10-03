import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import { previewTemplateOrigin } from '../publishing/previewUrl.js';
import * as deploymentConnectionsRepository from '../repositories/deploymentConnections.js';

/** How long the admin's frame sources are reused before connections are read again. */
export const PREVIEW_FRAME_SOURCES_TTL_MS = 10_000;

type FrameSourcesOptions = {
  db: Kysely<DB>;
  urls: UrlBuilder;
  /** GraphiQL is framed by the API explorer (same origin, one path) when it is served. */
  playgroundEnabled: boolean;
  ttlMs?: number;
  now?: () => number;
};

/**
 * The admin page's CSP `frame-src` sources: the GraphQL playground's exact URL (when served) and the origin of
 * every enabled connection's preview URL template, on every site (the admin shell is not site-scoped). Shapio's
 * own origin is never listed: a framed page on it could script the admin. Templates whose origin depends on a
 * variable are left out (they open in a new tab).
 *
 * Read again at most every `ttlMs` (a short TTL rather than a notification: it works across instances, and
 * the admin page only reads its CSP when it loads anyway; the preview pane offers a reload when a new
 * connection's frame is blocked).
 */
export const createPreviewFrameSources = ({
  db,
  urls,
  playgroundEnabled,
  ttlMs = PREVIEW_FRAME_SOURCES_TTL_MS,
  now = Date.now,
}: FrameSourcesOptions) => {
  const ownOrigin = new URL(urls.publicUrl).origin;
  const fixed = playgroundEnabled ? [urls.absoluteUrl('/api/graphql/playground')] : [];
  let cached: { at: number; sources: readonly string[] } | undefined;
  return async (): Promise<readonly string[]> => {
    if (cached && now() - cached.at < ttlMs) {
      return cached.sources;
    }
    const rows = await deploymentConnectionsRepository.listPreviewTemplates(db);
    const origins = new Set<string>();
    for (const row of rows) {
      const origin = row.preview_url_template ? previewTemplateOrigin(row.preview_url_template) : undefined;
      if (origin && origin !== ownOrigin) {
        origins.add(origin);
      }
    }
    cached = { at: now(), sources: [...fixed, ...[...origins].sort()] };
    return cached.sources;
  };
};
