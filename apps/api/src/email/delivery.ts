import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import type { EmailTransport } from './types.js';

/** What an email job needs. Passed explicitly: the dedicated worker process has no Fastify instance. */
export type EmailDeliveryDependencies = {
  database: Kysely<DB>;
  urls: UrlBuilder;
  transport: EmailTransport;
};

/** Admin SPA routes that read the token from the URL fragment (never sent to a server or its logs). */
export const ADMIN_LINK_PATHS = {
  acceptInvitation: '/admin/accept-invitation',
  resetPassword: '/admin/reset-password',
} as const;

export const tokenLink = (urls: UrlBuilder, path: string, token: string): string =>
  `${urls.absoluteUrl(path)}#token=${encodeURIComponent(token)}`;
