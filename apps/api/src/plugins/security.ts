import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { AppConfig } from '../config/index.js';
import { isAdminFileRequest } from './staticAdmin.js';

const CORS_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

type SecurityPluginOptions = {
  http: AppConfig['http'];
  httpsPublicUrl: boolean;
  /** Media storage origins (S3 bucket, CDN) the admin shows images from and uploads to (media/origins.ts). */
  mediaOrigins?: readonly string[];
  /** The admin's prefix (`${BASE_PATH}/admin/`): its files are not rate limited, the page and the API are. */
  adminPrefix: string;
};

/**
 * Baseline HTTP hardening: security headers, CORS (off unless origins are configured; the admin and API
 * share one origin, so CORS is only for the user's own sites and apps), a global rate limit keyed by the
 * client IP (which honours TRUST_PROXY), and @fastify/sensible's httpErrors.
 * The rate-limit store is in memory, so with several instances each counts on its own (documented: put a
 * shared limiter in front for strict limits; ADR 0008).
 */
export const securityPlugin = fp<SecurityPluginOptions>(
  async (app: FastifyInstance, { http, httpsPublicUrl, mediaOrigins = [], adminPrefix }) => {
    await app.register(sensible);
    // HSTS and upgrade-insecure-requests only make sense when Shapio is reached over HTTPS; on a plain-HTTP
    // install (LAN, local) they would break the admin.
    await app.register(helmet, {
      global: true,
      hsts: httpsPublicUrl,
      contentSecurityPolicy: {
        directives: {
          upgradeInsecureRequests: httpsPublicUrl ? [] : null,
          // Media: thumbnails and previews (blob: for files about to be uploaded) and direct-to-bucket uploads.
          imgSrc: ["'self'", 'data:', 'blob:', ...mediaOrigins],
          mediaSrc: ["'self'", 'blob:', ...mediaOrigins],
          connectSrc: ["'self'", ...mediaOrigins],
        },
      },
    });
    // Sites and apps authenticate with bearer tokens, never the admin cookie, so credentials stay off:
    // allowing them would let a script on a listed origin read the admin API with an editor's session.
    await app.register(cors, {
      origin: http.corsOrigins.length > 0 ? http.corsOrigins : false,
      credentials: false,
      // The delivery API takes app-user updates and deletes, not only GET and POST.
      methods: CORS_METHODS,
    });
    await app.register(rateLimit, {
      global: true,
      max: http.rateLimitMax,
      timeWindow: http.rateLimitWindowMs,
      // A few quick admin reloads would otherwise use up the limit on the bundle and leave the admin blank.
      allowList: (request) => isAdminFileRequest(request.url, adminPrefix),
    });
  },
  { name: 'shapio-security' },
);
