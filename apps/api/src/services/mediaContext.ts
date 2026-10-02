import type { UrlBuilder } from '../helpers/publicUrl.js';
import type { MediaStorage } from '../media/types.js';
import type { PermissionEvaluator } from '../permissions/types.js';
import type { ActorContext } from './actorContext.js';

export type MediaLimits = { maxUploadBytes: number; allowedTypes: readonly string[] };

/** What the media services need for one request: who is acting, where bytes live, and the limits. */
export type MediaServiceContext = ActorContext & {
  storage: MediaStorage;
  urls: UrlBuilder;
  signingSecret: string;
  permissions: PermissionEvaluator;
  limits: MediaLimits;
};
