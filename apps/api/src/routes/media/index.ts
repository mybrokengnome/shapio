import multipart from '@fastify/multipart';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { preHandlerAsyncHookHandler } from 'fastify';
import { getMediaFile, receiveUpload } from '../../controllers/mediaFiles.js';
import { declareSiteScope } from '../../plugins/siteResolution.js';
import { getMediaFileSchema, receiveUploadSchema } from './schemas.js';

/** /api/media: stored files (public at stable URLs, private only when signed) and local-driver uploads. */
export const mediaFilesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Network, not site (sites plan §H, G4). Files are fetched by storage key, whose asset ID is unique across
  // sites, from <img> tags on other origins that send no Shapio-Site header and no session, so a site route
  // would resolve every file to the primary site. Private files are authorised by their signature, not by a
  // principal; signed URLs are only minted by site-scoped reads of the asset, so the site boundary is
  // enforced where the signature is issued. Uploads are authorised by the grant, which carries its site.
  declareSiteScope(app, 'network');
  // Scoped to this plugin: only the upload route parses multipart bodies.
  await app.register(multipart);

  // Public files are what pages embed by the dozen, so unsigned requests get their own, higher limit
  // (MEDIA_RATE_LIMIT_MAX). Signed (private) URLs count against the global limit like any other request.
  const globalLimit = app.rateLimit();
  const publicFileLimit = app.rateLimit({
    max: app.config.http.mediaRateLimitMax,
    timeWindow: app.config.http.rateLimitWindowMs,
  });
  const fileRateLimit: preHandlerAsyncHookHandler = async function fileRateLimit(request, reply) {
    const signed = (request.query as { signature?: unknown }).signature !== undefined;
    await (signed ? globalLimit : publicFileLimit).call(this, request, reply);
  };

  // GET /f/<storage key>[?expires=&signature=] (HEAD too)
  app.get(
    '/f/*',
    { schema: getMediaFileSchema, config: { rateLimit: false }, preHandler: fileRateLimit },
    getMediaFile,
  );
  // POST /uploads/:grantId: multipart form (fields from the grant, then `file`); authorised by the
  // grant's signature, never by a session, so it needs no CSRF token and works like an S3 presigned POST.
  app.post(
    '/uploads/:grantId',
    {
      schema: receiveUploadSchema,
      config: {
        csrf: false,
        audit: { exempt: 'stores bytes for an upload grant; the asset is audited on confirm (media.upload)' },
      },
    },
    receiveUpload,
  );
};
