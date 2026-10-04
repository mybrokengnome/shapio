import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** The project's extension themes, for the admin's theme menu. */
export const listThemes = async (request: FastifyRequest) => ({ items: request.server.themeCatalogue.items });

let stylesheetEtag: { stylesheet: string; etag: string } | undefined;

const etagOf = (stylesheet: string) => {
  if (stylesheetEtag?.stylesheet !== stylesheet) {
    stylesheetEtag = {
      stylesheet,
      etag: `"${createHash('sha256').update(stylesheet).digest('base64url').slice(0, 22)}"`,
    };
  }
  return stylesheetEtag.etag;
};

/**
 * Their CSS, linked render-blocking from the admin's index.html (empty without extension themes). Public:
 * it holds colours only, and the signed-out screens render in the chosen theme too. Revalidated on each
 * load (it changes only with a restart), so a changed theme shows without a stale cache.
 */
export const getThemeStylesheet = async (request: FastifyRequest, reply: FastifyReply) => {
  const { stylesheet } = request.server.themeCatalogue;
  const etag = etagOf(stylesheet);
  void reply.header('etag', etag).header('cache-control', 'no-cache').type('text/css; charset=utf-8');
  if (request.headers['if-none-match'] === etag) {
    return reply.code(304).send();
  }
  return reply.send(stylesheet);
};
